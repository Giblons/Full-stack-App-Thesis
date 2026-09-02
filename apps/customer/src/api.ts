import type { CreateOrderInput, Order } from '@drone/shared';

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  'http://localhost:4000';

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const res = await fetch(`${API_BASE}/orders`, {
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

export async function listOrders(): Promise<Order[]> {
  const res = await fetch(`${API_BASE}/orders`);
  if (!res.ok) throw new Error(`Failed to load orders (${res.status})`);
  return res.json() as Promise<Order[]>;
}
