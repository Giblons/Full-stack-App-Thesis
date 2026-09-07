import { EventEmitter } from 'node:events';
import { SIM } from '@drone/shared';
import type {
  DroneCommand,
  DroneState,
  DroneTelemetry,
  LatLng,
  Mission,
} from '@drone/shared';
import { common, minimal, type MavLinkPacket } from 'node-mavlink';
import type { DroneAdapter } from './adapter.js';
import { UdpMavlink } from './mavlinkUdp.js';

export interface Px4Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error?: (msg: string) => void;
}

export interface Px4Options {
  /** MAVLink endpoint, e.g. udp://0.0.0.0:14540 (the port MAVSDK uses too). */
  url?: string;
  /** Cruise altitude (relative, meters) for the uploaded mission. */
  missionAltitude?: number;
  logger?: Px4Logger;
}

// PX4 custom flight-mode encoding (custom_mode is (main<<16)|(sub<<24)).
const PX4_MAIN_AUTO = 4;
const PX4_SUB_AUTO_TAKEOFF = 2;
const PX4_SUB_AUTO_LOITER = 3;
const PX4_SUB_AUTO_MISSION = 4;
const PX4_SUB_AUTO_RTL = 5;
const PX4_SUB_AUTO_LAND = 6;

const noopLogger: Px4Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Real drone adapter backed by PX4 (SITL first, hardware later) over MAVLink.
 *
 * Implements the same `DroneAdapter` interface as `MockDroneAdapter`, so the
 * API routes, SSE stream, customer app, and GCS are unchanged. It:
 *   - connects to a PX4 MAVLink UDP endpoint and waits for the autopilot heartbeat
 *   - maps PX4 telemetry into the shared `DroneTelemetry` type
 *   - uploads a pickup -> dropoff mission (takeoff, waypoints, land) from an order
 *   - maps Hold / Resume / RTL to MAVLink commands
 *
 * See docs/px4-sitl-runbook.md for how to run PX4 SITL and point the API at it.
 */
export class Px4DroneAdapter implements DroneAdapter {
  readonly kind = 'px4' as const;
  droneId = 'px4-1';

  private readonly emitter = new EventEmitter();
  private readonly link: UdpMavlink;
  private readonly logger: Px4Logger;
  private readonly bindHost: string;
  private readonly bindPort: number;
  private readonly missionAltitude: number;

  private targetSystem = 1;
  private targetComponent = 1;
  private haveTarget = false;
  private publishTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  // Latest telemetry pieces, cached from incoming messages.
  private position: LatLng = { lat: 0, lng: 0 };
  private altitudeMeters = 0;
  private headingDegrees = 0;
  private groundSpeedMps = 0;
  private batteryPercent = 100;
  private armed = false;
  private customMode = 0;
  private landedState = 0;
  private missionSeq = 0;
  private missionTotal = 0;

  private activeMissionId: string | undefined;
  private lastMissionItemSeq = 0;
  private missionCompleteFired = false;

  constructor(options: Px4Options = {}) {
    const url = options.url ?? 'udp://0.0.0.0:14540';
    const parsed = parseUdpUrl(url);
    this.bindHost = parsed.host;
    this.bindPort = parsed.port;
    this.missionAltitude = options.missionAltitude ?? 30;
    this.logger = options.logger ?? noopLogger;
    this.link = new UdpMavlink();
    this.emitter.setMaxListeners(50);

    this.link.on('packet', (packet) => this.onPacket(packet));
    this.link.on('error', (err) =>
      this.logger.warn(`MAVLink link error: ${(err as Error).message}`),
    );
  }

  /** Bind the socket and resolve once the autopilot heartbeat is seen. */
  async connect(timeoutMs = 8000): Promise<void> {
    await this.link.bind(this.bindPort, this.bindHost);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.emitter.off('target', onTarget);
        reject(new Error(`no PX4 heartbeat within ${timeoutMs}ms`));
      }, timeoutMs);
      const onTarget = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.emitter.once('target', onTarget);
    });

    // Announce ourselves as a GCS so PX4 keeps streaming and accepts commands.
    this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), 1000);
    void this.sendHeartbeat();

    this.publishTimer = setInterval(() => this.publish(), SIM.TICK_MS);
    this.publish();
  }

  async startMission(mission: Mission): Promise<void> {
    this.activeMissionId = mission.id;
    this.missionCompleteFired = false;

    const items = this.buildMissionItems(mission);
    this.lastMissionItemSeq = items.length - 1;

    await this.uploadMission(items);
    await this.arm();
    // Give PX4 a moment to register the arm before starting the mission.
    await delay(600);
    await this.sendCommand(common.MavCmd.MISSION_START, 0, this.lastMissionItemSeq);
    this.logger.info(`PX4 mission started (${items.length} items)`);
  }

  async command(command: DroneCommand): Promise<void> {
    switch (command) {
      case 'hold':
        await this.sendCommand(common.MavCmd.DO_PAUSE_CONTINUE, 0);
        break;
      case 'resume':
        await this.sendCommand(common.MavCmd.DO_PAUSE_CONTINUE, 1);
        break;
      case 'rtl':
        await this.sendCommand(common.MavCmd.NAV_RETURN_TO_LAUNCH);
        break;
    }
  }

  getTelemetry(): DroneTelemetry {
    return {
      droneId: this.droneId,
      missionId: this.activeMissionId,
      position: this.position,
      altitudeMeters: Math.round(this.altitudeMeters * 10) / 10,
      batteryPercent: Math.round(this.batteryPercent * 10) / 10,
      headingDegrees: Math.round(this.headingDegrees),
      groundSpeedMps: Math.round(this.groundSpeedMps * 10) / 10,
      state: this.deriveState(),
      missionProgress:
        this.missionTotal > 1
          ? Math.min(1, this.missionSeq / (this.missionTotal - 1))
          : 0,
      timestamp: new Date().toISOString(),
    };
  }

  onTelemetry(listener: (telemetry: DroneTelemetry) => void): () => void {
    this.emitter.on('telemetry', listener);
    return () => this.emitter.off('telemetry', listener);
  }

  onMissionComplete(listener: (missionId: string) => void): () => void {
    this.emitter.on('mission-complete', listener);
    return () => this.emitter.off('mission-complete', listener);
  }

  async close(): Promise<void> {
    if (this.publishTimer) clearInterval(this.publishTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await this.link.close();
  }

  // --- incoming message handling -------------------------------------------

  private onPacket(packet: MavLinkPacket): void {
    switch (packet.header.msgid) {
      case minimal.Heartbeat.MSG_ID: {
        const hb = packet.protocol.data(packet.payload, minimal.Heartbeat);
        // Adopt the first autopilot (component 1) as our command target.
        if (!this.haveTarget && packet.header.compid === 1) {
          this.targetSystem = packet.header.sysid;
          this.targetComponent = packet.header.compid;
          this.droneId = `px4-${this.targetSystem}`;
          this.haveTarget = true;
          this.emitter.emit('target');
        }
        if (packet.header.compid === 1) {
          this.armed =
            (hb.baseMode & minimal.MavModeFlag.SAFETY_ARMED) !== 0;
          this.customMode = hb.customMode;
        }
        break;
      }
      case common.GlobalPositionInt.MSG_ID: {
        const p = packet.protocol.data(packet.payload, common.GlobalPositionInt);
        this.position = { lat: p.lat / 1e7, lng: p.lon / 1e7 };
        this.altitudeMeters = p.relativeAlt / 1000;
        if (p.hdg !== 65535) this.headingDegrees = p.hdg / 100;
        this.groundSpeedMps = Math.hypot(p.vx, p.vy) / 100;
        break;
      }
      case common.VfrHud.MSG_ID: {
        const v = packet.protocol.data(packet.payload, common.VfrHud);
        this.groundSpeedMps = v.groundspeed;
        this.headingDegrees = (v.heading + 360) % 360;
        break;
      }
      case common.SysStatus.MSG_ID: {
        const s = packet.protocol.data(packet.payload, common.SysStatus);
        if (s.batteryRemaining >= 0) this.batteryPercent = s.batteryRemaining;
        break;
      }
      case common.ExtendedSysState.MSG_ID: {
        const e = packet.protocol.data(packet.payload, common.ExtendedSysState);
        this.landedState = e.landedState;
        break;
      }
      case common.MissionCurrent.MSG_ID: {
        const m = packet.protocol.data(packet.payload, common.MissionCurrent);
        this.missionSeq = m.seq;
        if (m.total > 0) this.missionTotal = m.total;
        break;
      }
      case common.MissionItemReached.MSG_ID: {
        const r = packet.protocol.data(packet.payload, common.MissionItemReached);
        if (
          !this.missionCompleteFired &&
          this.activeMissionId &&
          r.seq >= this.lastMissionItemSeq
        ) {
          this.missionCompleteFired = true;
          this.emitter.emit('mission-complete', this.activeMissionId);
        }
        break;
      }
      default:
        break;
    }
  }

  private deriveState(): DroneState {
    const main = (this.customMode >> 16) & 0xff;
    const sub = (this.customMode >> 24) & 0xff;
    if (!this.armed) {
      return this.landedState === common.MavLandedState.IN_AIR
        ? 'hold'
        : 'idle';
    }
    if (main === PX4_MAIN_AUTO) {
      switch (sub) {
        case PX4_SUB_AUTO_LOITER:
          return 'hold';
        case PX4_SUB_AUTO_RTL:
          return 'returning';
        case PX4_SUB_AUTO_LAND:
          return this.landedState === common.MavLandedState.ON_GROUND
            ? 'landed'
            : 'returning';
        case PX4_SUB_AUTO_MISSION:
        case PX4_SUB_AUTO_TAKEOFF:
          return 'in_flight';
        default:
          return 'in_flight';
      }
    }
    return 'in_flight';
  }

  private publish(): void {
    this.emitter.emit('telemetry', this.getTelemetry());
  }

  // --- outgoing commands ----------------------------------------------------

  private async sendHeartbeat(): Promise<void> {
    const hb = new minimal.Heartbeat();
    hb.type = minimal.MavType.GCS;
    hb.autopilot = minimal.MavAutopilot.INVALID;
    hb.baseMode = 0 as minimal.MavModeFlag;
    hb.customMode = 0;
    hb.systemStatus = minimal.MavState.ACTIVE;
    await this.link.send(hb);
  }

  private async sendCommand(
    command: common.MavCmd,
    param1 = 0,
    param2 = 0,
    param3 = 0,
    param4 = 0,
    param5 = 0,
    param6 = 0,
    param7 = 0,
  ): Promise<void> {
    const cmd = new common.CommandLong();
    cmd.targetSystem = this.targetSystem;
    cmd.targetComponent = this.targetComponent;
    cmd.command = command;
    cmd.confirmation = 0;
    cmd._param1 = param1;
    cmd._param2 = param2;
    cmd._param3 = param3;
    cmd._param4 = param4;
    cmd._param5 = param5;
    cmd._param6 = param6;
    cmd._param7 = param7;
    await this.link.send(cmd);
  }

  private async arm(): Promise<void> {
    await this.sendCommand(common.MavCmd.COMPONENT_ARM_DISARM, 1);
  }

  private buildMissionItems(mission: Mission): common.MissionItemInt[] {
    const pickup = mission.path[0];
    const dropoff = mission.path[mission.path.length - 1];
    const alt = this.missionAltitude;

    const mk = (
      seq: number,
      command: common.MavCmd,
      point: LatLng,
      z: number,
    ): common.MissionItemInt => {
      const item = new common.MissionItemInt();
      item.targetSystem = this.targetSystem;
      item.targetComponent = this.targetComponent;
      item.seq = seq;
      item.frame = common.MavFrame.GLOBAL_RELATIVE_ALT_INT;
      item.command = command;
      item.current = seq === 0 ? 1 : 0;
      item.autocontinue = 1;
      item.param1 = 0;
      item.param2 = command === common.MavCmd.NAV_WAYPOINT ? 1 : 0; // accept radius
      item.param3 = 0;
      item.param4 = NaN; // yaw: use default heading behaviour
      item.x = Math.round(point.lat * 1e7);
      item.y = Math.round(point.lng * 1e7);
      item.z = z;
      item.missionType = common.MavMissionType.MISSION;
      return item;
    };

    return [
      mk(0, common.MavCmd.NAV_TAKEOFF, pickup, alt),
      mk(1, common.MavCmd.NAV_WAYPOINT, pickup, alt),
      mk(2, common.MavCmd.NAV_WAYPOINT, dropoff, alt),
      mk(3, common.MavCmd.NAV_LAND, dropoff, 0),
    ];
  }

  private uploadMission(items: common.MissionItemInt[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.link.off('packet', onPacket);
        reject(new Error('mission upload timed out'));
      }, 15000);

      const onPacket = (packet: MavLinkPacket): void => {
        if (
          packet.header.msgid === common.MissionRequestInt.MSG_ID ||
          packet.header.msgid === common.MissionRequest.MSG_ID
        ) {
          const req = packet.protocol.data(
            packet.payload,
            packet.header.msgid === common.MissionRequestInt.MSG_ID
              ? common.MissionRequestInt
              : common.MissionRequest,
          );
          const item = items[req.seq];
          if (item) void this.link.send(item);
        } else if (packet.header.msgid === common.MissionAck.MSG_ID) {
          const ack = packet.protocol.data(packet.payload, common.MissionAck);
          clearTimeout(timer);
          this.link.off('packet', onPacket);
          if (ack.type === common.MavMissionResult.ACCEPTED) resolve();
          else reject(new Error(`mission rejected (result ${ack.type})`));
        }
      };

      this.link.on('packet', onPacket);

      const count = new common.MissionCount();
      count.targetSystem = this.targetSystem;
      count.targetComponent = this.targetComponent;
      count.count = items.length;
      count.missionType = common.MavMissionType.MISSION;
      void this.link.send(count);
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseUdpUrl(url: string): { host: string; port: number } {
  // Accept udp://host:port (host optional -> bind all interfaces).
  const m = /^udp:\/\/([^:]*):(\d+)$/.exec(url.trim());
  if (!m) return { host: '0.0.0.0', port: 14540 };
  return { host: m[1] || '0.0.0.0', port: Number(m[2]) };
}
