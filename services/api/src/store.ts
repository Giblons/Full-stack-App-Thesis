import { randomUUID } from 'node:crypto';
import type { Mission, Order } from '@drone/shared';

/**
 * Trivial in-memory store. The thin slice only needs one customer / one
 * package / one drone / one delivery, so persistence is deliberately omitted.
 * Swap for a real database (Postgres/Prisma) when the scope grows.
 */
class Store {
  private readonly orders = new Map<string, Order>();
  private readonly missions = new Map<string, Mission>();

  createOrder(
    input: Omit<Order, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'missionId'>,
  ): Order {
    const now = new Date().toISOString();
    const order: Order = {
      id: randomUUID(),
      status: 'requested',
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    this.orders.set(order.id, order);
    return order;
  }

  updateOrder(id: string, patch: Partial<Order>): Order | undefined {
    const existing = this.orders.get(id);
    if (!existing) return undefined;
    const updated: Order = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.orders.set(id, updated);
    return updated;
  }

  getOrder(id: string): Order | undefined {
    return this.orders.get(id);
  }

  listOrders(): Order[] {
    return [...this.orders.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  createMission(input: Omit<Mission, 'id' | 'createdAt' | 'updatedAt'>): Mission {
    const now = new Date().toISOString();
    const mission: Mission = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    this.missions.set(mission.id, mission);
    return mission;
  }

  updateMission(id: string, patch: Partial<Mission>): Mission | undefined {
    const existing = this.missions.get(id);
    if (!existing) return undefined;
    const updated: Mission = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.missions.set(id, updated);
    return updated;
  }

  getMission(id: string): Mission | undefined {
    return this.missions.get(id);
  }

  listMissions(): Mission[] {
    return [...this.missions.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
}

export const store = new Store();
