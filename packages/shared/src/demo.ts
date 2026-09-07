/**
 * Browser-only demo backend. When the frontends are deployed as a static site
 * with no API (e.g. GitHub Pages), they fall back to this in-memory + localStorage
 * engine so the whole flow is still tappable on a phone: create a delivery, watch
 * a mock drone fly the pickup -> dropoff polyline, see it in the GCS.
 *
 * Because the customer app and GCS are served from the same origin, they share
 * localStorage, so an order created in one shows up as a live drone in the other.
 *
 * This intentionally mirrors the real server: one drone, one active mission,
 * constant cruise speed, linear battery drain. It is NOT imported by the Node
 * API (it uses browser globals) — only the frontends load it.
 */
import type {
  CreateOrderInput,
  DroneCommand,
  DroneState,
  DroneTelemetry,
  LatLng,
  Mission,
  Order,
  TelemetryEvent,
} from './index.js';
import { DEFAULT_MAP_CENTER } from './index.js';
import { SIM, bearingDegrees, pathLengthMeters, pointAlongPath } from './index.js';

const PREFIX = 'drone-demo:';
const K = {
  orders: `${PREFIX}orders`,
  missions: `${PREFIX}missions`,
  telemetry: `${PREFIX}telemetry`,
  command: `${PREFIX}command`,
  start: `${PREFIX}start`,
  engine: `${PREFIX}engine`,
  rev: `${PREFIX}rev`,
  seeded: `${PREFIX}seeded`,
} as const;

const ENGINE_STALE_MS = 1500;
const DRONE_ID = 'drone-1';

// A sample delivery used to seed liveliness when someone opens the demo cold.
const SAMPLE_PICKUP: LatLng = { lat: -6.9147, lng: 107.6098 };
const SAMPLE_DROPOFF: LatLng = { lat: -6.8915, lng: 107.6107 };

function now(): number {
  return Date.now();
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${now()}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / disabled — demo just won't persist */
  }
}

function bumpRev(): void {
  write(K.rev, read<number>(K.rev, 0) + 1);
}

interface EngineState {
  missionId: string | null;
  distanceTraveled: number;
  pathLength: number;
  battery: number;
  state: DroneState;
  position: LatLng;
  heading: number;
  lastCommandTs: number;
  lastStartTs: number;
}

/**
 * One shared engine per browser tab. Multiple tabs coordinate through a
 * heartbeat in localStorage so only one tab actually advances the simulation.
 */
class DemoBackend {
  private readonly id = uuid();
  private engine: EngineState = {
    missionId: null,
    distanceTraveled: 0,
    pathLength: 0,
    battery: 100,
    state: 'idle',
    position: DEFAULT_MAP_CENTER,
    heading: 0,
    lastCommandTs: 0,
    lastStartTs: 0,
  };
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    this.seedIfEmpty();
    this.timer = setInterval(() => this.tick(), SIM.TICK_MS);
  }

  createOrder(input: CreateOrderInput): Order {
    const iso = new Date().toISOString();
    const order: Order = {
      id: uuid(),
      customerName: input.customerName,
      packageDescription: input.packageDescription,
      pickup: input.pickup,
      dropoff: input.dropoff,
      status: 'in_flight',
      createdAt: iso,
      updatedAt: iso,
    };
    const mission: Mission = {
      id: uuid(),
      orderId: order.id,
      droneId: DRONE_ID,
      path: [input.pickup, input.dropoff],
      status: 'in_flight',
      createdAt: iso,
      updatedAt: iso,
    };
    order.missionId = mission.id;

    const orders = read<Order[]>(K.orders, []);
    write(K.orders, [order, ...orders]);
    const missions = read<Mission[]>(K.missions, []);
    write(K.missions, [mission, ...missions]);
    // Signal the (possibly other-tab) engine to start flying this mission.
    write(K.start, { missionId: mission.id, ts: now() });
    bumpRev();
    return order;
  }

  sendCommand(command: DroneCommand): void {
    write(K.command, { command, ts: now() });
  }

  listOrders(): Order[] {
    return read<Order[]>(K.orders, []);
  }

  listMissions(): Mission[] {
    return read<Mission[]>(K.missions, []);
  }

  telemetry(): DroneTelemetry {
    return read<DroneTelemetry>(K.telemetry, this.snapshot());
  }

  private seedIfEmpty(): void {
    if (read<boolean>(K.seeded, false)) return;
    write(K.seeded, true);
    if (read<Order[]>(K.orders, []).length === 0) {
      this.createOrder({
        customerName: 'Demo',
        packageDescription: 'Sample package',
        pickup: SAMPLE_PICKUP,
        dropoff: SAMPLE_DROPOFF,
      });
    }
  }

  private isLeader(): boolean {
    const engine = read<{ id: string; ts: number } | null>(K.engine, null);
    if (!engine || now() - engine.ts > ENGINE_STALE_MS || engine.id === this.id) {
      write(K.engine, { id: this.id, ts: now() });
      return true;
    }
    return false;
  }

  private tick(): void {
    if (!this.isLeader()) return;

    this.applyPendingStart();
    this.applyPendingCommand();

    if (this.engine.state === 'in_flight') {
      this.advance();
      this.drain();
      if (this.engine.distanceTraveled >= this.engine.pathLength) {
        this.engine.distanceTraveled = this.engine.pathLength;
        this.engine.state = 'landed';
        this.completeMission();
      }
    } else if (this.engine.state === 'returning') {
      const mission = this.currentMission();
      if (mission) {
        const home = mission.path[0];
        const step = (SIM.CRUISE_SPEED_MPS * SIM.TICK_MS) / 1000;
        const { position, heading } = pointAlongPath(
          [this.engine.position, home],
          step,
        );
        const remaining = pathLengthMeters([this.engine.position, home]);
        this.engine.position = position;
        this.engine.heading = heading;
        this.drain();
        if (remaining <= step) {
          this.engine.position = home;
          this.engine.state = 'landed';
        }
      }
    }

    write(K.telemetry, this.snapshot());
    bumpRev();
  }

  private applyPendingStart(): void {
    const start = read<{ missionId: string; ts: number } | null>(K.start, null);
    if (!start || start.ts <= this.engine.lastStartTs) return;
    const mission = this.listMissions().find((m) => m.id === start.missionId);
    if (!mission) return;
    this.engine = {
      ...this.engine,
      missionId: mission.id,
      distanceTraveled: 0,
      pathLength: pathLengthMeters(mission.path),
      battery: 100,
      state: 'in_flight',
      position: mission.path[0],
      heading:
        mission.path.length > 1
          ? bearingDegrees(mission.path[0], mission.path[1])
          : 0,
      lastStartTs: start.ts,
    };
  }

  private applyPendingCommand(): void {
    const cmd = read<{ command: DroneCommand; ts: number } | null>(
      K.command,
      null,
    );
    if (!cmd || cmd.ts <= this.engine.lastCommandTs) return;
    this.engine.lastCommandTs = cmd.ts;
    switch (cmd.command) {
      case 'hold':
        if (this.engine.state === 'in_flight') this.engine.state = 'hold';
        break;
      case 'resume':
        if (this.engine.state === 'hold') this.engine.state = 'in_flight';
        break;
      case 'rtl':
        this.engine.state = 'returning';
        break;
    }
  }

  private advance(): void {
    const mission = this.currentMission();
    if (!mission) return;
    const step = (SIM.CRUISE_SPEED_MPS * SIM.TICK_MS) / 1000;
    this.engine.distanceTraveled += step;
    const { position, heading } = pointAlongPath(
      mission.path,
      this.engine.distanceTraveled,
    );
    this.engine.position = position;
    this.engine.heading = heading;
  }

  private drain(): void {
    this.engine.battery = Math.max(
      0,
      this.engine.battery - SIM.BATTERY_DRAIN_PER_SEC * (SIM.TICK_MS / 1000),
    );
  }

  private completeMission(): void {
    const missionId = this.engine.missionId;
    if (!missionId) return;
    const missions = this.listMissions().map((m) =>
      m.id === missionId
        ? { ...m, status: 'completed' as const, updatedAt: new Date().toISOString() }
        : m,
    );
    write(K.missions, missions);
    const mission = missions.find((m) => m.id === missionId);
    if (mission) {
      const orders = this.listOrders().map((o) =>
        o.id === mission.orderId
          ? { ...o, status: 'delivered' as const, updatedAt: new Date().toISOString() }
          : o,
      );
      write(K.orders, orders);
    }
  }

  private currentMission(): Mission | undefined {
    if (!this.engine.missionId) return undefined;
    return this.listMissions().find((m) => m.id === this.engine.missionId);
  }

  private snapshot(): DroneTelemetry {
    const flying =
      this.engine.state === 'in_flight' || this.engine.state === 'returning';
    return {
      droneId: DRONE_ID,
      missionId: this.engine.missionId ?? undefined,
      position: this.engine.position,
      altitudeMeters:
        this.engine.state === 'idle' || this.engine.state === 'landed'
          ? 0
          : SIM.CRUISE_ALTITUDE_M,
      batteryPercent: Math.round(this.engine.battery * 10) / 10,
      headingDegrees: Math.round(this.engine.heading),
      groundSpeedMps: flying ? SIM.CRUISE_SPEED_MPS : 0,
      state: this.engine.state,
      missionProgress:
        this.engine.pathLength === 0
          ? 0
          : Math.min(1, this.engine.distanceTraveled / this.engine.pathLength),
      timestamp: new Date().toISOString(),
    };
  }
}

let backend: DemoBackend | null = null;
function getBackend(): DemoBackend {
  if (!backend) {
    backend = new DemoBackend();
    backend.start();
  }
  return backend;
}

/** Subscribe to demo events by polling localStorage for revision changes. */
export function subscribeDemo(
  onEvent: (event: TelemetryEvent) => void,
): () => void {
  const be = getBackend();
  let lastRev = -1;
  let lastTelemetryTs = '';
  let lastOrders = '';
  let lastMissions = '';

  const poll = (): void => {
    const rev = read<number>(K.rev, 0);
    if (rev === lastRev) return;
    lastRev = rev;

    const telemetry = be.telemetry();
    if (telemetry.timestamp !== lastTelemetryTs) {
      lastTelemetryTs = telemetry.timestamp;
      onEvent({ type: 'telemetry', data: telemetry });
    }
    const ordersRaw = localStorage.getItem(K.orders) ?? '[]';
    if (ordersRaw !== lastOrders) {
      lastOrders = ordersRaw;
      for (const order of be.listOrders()) onEvent({ type: 'order', data: order });
    }
    const missionsRaw = localStorage.getItem(K.missions) ?? '[]';
    if (missionsRaw !== lastMissions) {
      lastMissions = missionsRaw;
      for (const mission of be.listMissions()) {
        onEvent({ type: 'mission', data: mission });
      }
    }
  };

  // Prime immediately, then poll.
  onEvent({ type: 'telemetry', data: be.telemetry() });
  const interval = setInterval(poll, 300);
  return () => clearInterval(interval);
}

export const demoBackend = {
  createOrder: (input: CreateOrderInput): Order => getBackend().createOrder(input),
  listOrders: (): Order[] => getBackend().listOrders(),
  listMissions: (): Mission[] => getBackend().listMissions(),
  sendCommand: (command: DroneCommand): void => getBackend().sendCommand(command),
};
