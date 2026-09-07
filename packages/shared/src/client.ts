/**
 * A single client the frontends use to talk to "the backend", whichever it is:
 *
 *  - `live`  — a real hosted API (Fastify) over HTTP + Server-Sent Events.
 *  - `demo`  — an in-browser mock (see demo.ts) used when no API URL is set,
 *              so a static deploy (e.g. GitHub Pages) is still fully usable.
 *
 * Frontends pass their Vite env in (apiUrl + dev) so this stays framework-agnostic.
 */
import type {
  CreateOrderInput,
  DroneCommand,
  Mission,
  Order,
  TelemetryEvent,
} from './index.js';
import { demoBackend, subscribeDemo } from './demo.js';

export interface DeliveryClient {
  readonly mode: 'live' | 'demo';
  readonly apiUrl: string | null;
  createOrder(input: CreateOrderInput): Promise<Order>;
  listOrders(): Promise<Order[]>;
  listMissions(): Promise<Mission[]>;
  sendCommand(command: DroneCommand): Promise<void>;
  /** Stream telemetry/mission/order updates. Returns an unsubscribe function. */
  subscribe(onEvent: (event: TelemetryEvent) => void): () => void;
}

export interface ClientOptions {
  /** Base URL of the hosted API (VITE_API_URL). Empty/undefined -> see `dev`. */
  apiUrl?: string | null;
  /** True in `vite dev`; when there's no apiUrl we default to a local API. */
  dev?: boolean;
}

class HttpDeliveryClient implements DeliveryClient {
  readonly mode = 'live' as const;
  constructor(readonly apiUrl: string) {}

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const res = await fetch(`${this.apiUrl}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
    return res.json() as Promise<Order>;
  }

  async listOrders(): Promise<Order[]> {
    const res = await fetch(`${this.apiUrl}/orders`);
    if (!res.ok) throw new Error(`Failed to load orders (${res.status})`);
    return res.json() as Promise<Order[]>;
  }

  async listMissions(): Promise<Mission[]> {
    const res = await fetch(`${this.apiUrl}/missions`);
    if (!res.ok) throw new Error(`Failed to load missions (${res.status})`);
    return res.json() as Promise<Mission[]>;
  }

  async sendCommand(command: DroneCommand): Promise<void> {
    const res = await fetch(`${this.apiUrl}/drone/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    if (!res.ok) throw new Error(`Command failed (${res.status})`);
  }

  subscribe(onEvent: (event: TelemetryEvent) => void): () => void {
    const source = new EventSource(`${this.apiUrl}/telemetry/stream`);
    source.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data) as TelemetryEvent);
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => source.close();
  }
}

class DemoDeliveryClient implements DeliveryClient {
  readonly mode = 'demo' as const;
  readonly apiUrl = null;

  async createOrder(input: CreateOrderInput): Promise<Order> {
    return demoBackend.createOrder(input);
  }
  async listOrders(): Promise<Order[]> {
    return demoBackend.listOrders();
  }
  async listMissions(): Promise<Mission[]> {
    return demoBackend.listMissions();
  }
  async sendCommand(command: DroneCommand): Promise<void> {
    demoBackend.sendCommand(command);
  }
  subscribe(onEvent: (event: TelemetryEvent) => void): () => void {
    return subscribeDemo(onEvent);
  }
}

export function createClient(options: ClientOptions = {}): DeliveryClient {
  const url = options.apiUrl?.trim();
  if (url) return new HttpDeliveryClient(url.replace(/\/$/, ''));
  if (options.dev) return new HttpDeliveryClient('http://localhost:4000');
  return new DemoDeliveryClient();
}
