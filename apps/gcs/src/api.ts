import type { DroneCommand, Mission, Order, TelemetryEvent } from '@drone/shared';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  'http://localhost:4000';

export async function listMissions(): Promise<Mission[]> {
  const res = await fetch(`${API_BASE}/missions`);
  if (!res.ok) throw new Error(`Failed to load missions (${res.status})`);
  return res.json() as Promise<Mission[]>;
}

export async function listOrders(): Promise<Order[]> {
  const res = await fetch(`${API_BASE}/orders`);
  if (!res.ok) throw new Error(`Failed to load orders (${res.status})`);
  return res.json() as Promise<Order[]>;
}

export async function sendCommand(command: DroneCommand): Promise<void> {
  const res = await fetch(`${API_BASE}/drone/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  if (!res.ok) throw new Error(`Command failed (${res.status})`);
}

/** Open the telemetry SSE stream. Returns a cleanup function. */
export function openTelemetryStream(
  onEvent: (event: TelemetryEvent) => void,
): () => void {
  const source = new EventSource(`${API_BASE}/telemetry/stream`);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as TelemetryEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => source.close();
}
