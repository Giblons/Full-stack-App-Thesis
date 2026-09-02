import { EventEmitter } from 'node:events';
import type {
  DroneCommand,
  DroneState,
  DroneTelemetry,
  Mission,
} from '@drone/shared';
import type { DroneAdapter } from './adapter.js';
import { bearingDegrees, pathLengthMeters, pointAlongPath } from '../geo.js';

const TICK_MS = 500;
const CRUISE_SPEED_MPS = 12; // ~43 km/h, a plausible delivery-drone cruise
const CRUISE_ALTITUDE_M = 60;
const BATTERY_DRAIN_PER_SEC = 0.15; // %/s while flying

/**
 * A fake drone that flies the mission polyline from pickup to dropoff so the
 * GCS shows a live-looking drone with no real hardware or PX4 in the loop.
 *
 * It is deliberately simple: constant cruise speed, linear battery drain, and
 * straight-line interpolation between waypoints. The moment PX4 SITL is wired
 * up, replace this class with a MAVSDK-backed DroneAdapter (same interface).
 */
export class MockDroneAdapter implements DroneAdapter {
  readonly droneId: string;

  private readonly emitter = new EventEmitter();
  private mission: Mission | null = null;
  private timer: NodeJS.Timeout | null = null;

  private distanceTraveled = 0;
  private pathLength = 0;
  private battery = 100;
  private state: DroneState = 'idle';
  private position: DroneTelemetry['position'];
  private heading = 0;

  constructor(droneId = 'drone-1', home = { lat: -6.9147, lng: 107.6098 }) {
    this.droneId = droneId;
    this.position = home;
    this.emitter.setMaxListeners(50);
  }

  async startMission(mission: Mission): Promise<void> {
    this.mission = mission;
    this.pathLength = pathLengthMeters(mission.path);
    this.distanceTraveled = 0;
    this.battery = 100;
    this.state = 'in_flight';
    this.position = mission.path[0];
    this.heading =
      mission.path.length > 1
        ? bearingDegrees(mission.path[0], mission.path[1])
        : 0;

    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
    this.publish();
  }

  async command(command: DroneCommand): Promise<void> {
    switch (command) {
      case 'hold':
        if (this.state === 'in_flight') this.state = 'hold';
        break;
      case 'resume':
        if (this.state === 'hold') this.state = 'in_flight';
        break;
      case 'rtl':
        this.state = 'returning';
        break;
    }
    this.publish();
  }

  getTelemetry(): DroneTelemetry {
    return {
      droneId: this.droneId,
      missionId: this.mission?.id,
      position: this.position,
      altitudeMeters: this.state === 'idle' || this.state === 'landed' ? 0 : CRUISE_ALTITUDE_M,
      batteryPercent: Math.round(this.battery * 10) / 10,
      headingDegrees: Math.round(this.heading),
      groundSpeedMps:
        this.state === 'in_flight' || this.state === 'returning'
          ? CRUISE_SPEED_MPS
          : 0,
      state: this.state,
      missionProgress:
        this.pathLength === 0
          ? 0
          : Math.min(1, this.distanceTraveled / this.pathLength),
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

  private tick(): void {
    if (!this.mission) return;

    if (this.state === 'in_flight') {
      this.advance(this.mission.path);
      this.drainBattery();

      if (this.distanceTraveled >= this.pathLength) {
        this.distanceTraveled = this.pathLength;
        this.state = 'landed';
        this.position = this.mission.path[this.mission.path.length - 1];
        this.publish();
        const missionId = this.mission.id;
        this.emitter.emit('mission-complete', missionId);
        return;
      }
    } else if (this.state === 'returning') {
      // Fly back toward the launch point (start of the path).
      const home = this.mission.path[0];
      const returnPath = [this.position, home];
      const len = pathLengthMeters(returnPath);
      const step = (CRUISE_SPEED_MPS * TICK_MS) / 1000;
      const { position, heading } = pointAlongPath(returnPath, step);
      this.position = position;
      this.heading = heading;
      this.drainBattery();
      if (len <= step) {
        this.state = 'landed';
        this.position = home;
      }
    }

    this.publish();
  }

  private advance(path: DroneTelemetry['position'][] | Mission['path']): void {
    const step = (CRUISE_SPEED_MPS * TICK_MS) / 1000;
    this.distanceTraveled += step;
    const { position, heading } = pointAlongPath(
      path as Mission['path'],
      this.distanceTraveled,
    );
    this.position = position;
    this.heading = heading;
  }

  private drainBattery(): void {
    this.battery = Math.max(
      0,
      this.battery - BATTERY_DRAIN_PER_SEC * (TICK_MS / 1000),
    );
  }

  private publish(): void {
    this.emitter.emit('telemetry', this.getTelemetry());
  }
}
