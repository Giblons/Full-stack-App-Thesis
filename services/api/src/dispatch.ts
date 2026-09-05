import { EventEmitter } from 'node:events';
import type {
  DroneCommand,
  DroneTelemetry,
  Order,
  TelemetryEvent,
} from '@drone/shared';
import { store } from './store.js';
import { MockDroneAdapter } from './drone/mockAdapter.js';
import type { DroneAdapter } from './drone/adapter.js';

/**
 * Wires customer orders to a drone. Owns the (single) drone adapter and a
 * fan-out event bus that the SSE route uses to push updates to the GCS.
 */
class DispatchService {
  private readonly adapter: DroneAdapter = new MockDroneAdapter();
  private readonly bus = new EventEmitter();

  constructor() {
    this.bus.setMaxListeners(100);

    this.adapter.onTelemetry((telemetry) => {
      this.syncMissionAndOrder(telemetry);
      this.emit({ type: 'telemetry', data: telemetry });
    });

    this.adapter.onMissionComplete((missionId) => {
      const mission = store.updateMission(missionId, { status: 'completed' });
      if (mission) {
        this.emit({ type: 'mission', data: mission });
        const order = store.updateOrder(mission.orderId, {
          status: 'delivered',
        });
        if (order) this.emit({ type: 'order', data: order });
      }
    });
  }

  /** Turn a freshly-created order into a mission and start flying it. */
  async dispatch(order: Order): Promise<Order> {
    const mission = store.createMission({
      orderId: order.id,
      droneId: this.adapter.droneId,
      path: [order.pickup, order.dropoff],
      status: 'in_flight',
    });

    const updated = store.updateOrder(order.id, {
      status: 'in_flight',
      missionId: mission.id,
    })!;

    await this.adapter.startMission(mission);

    this.emit({ type: 'order', data: updated });
    this.emit({ type: 'mission', data: mission });
    return updated;
  }

  async command(command: DroneCommand): Promise<void> {
    await this.adapter.command(command);
  }

  currentTelemetry(): DroneTelemetry {
    return this.adapter.getTelemetry();
  }

  /** Subscribe to the event bus. Returns an unsubscribe function. */
  subscribe(listener: (event: TelemetryEvent) => void): () => void {
    this.bus.on('event', listener);
    return () => this.bus.off('event', listener);
  }

  private emit(event: TelemetryEvent): void {
    this.bus.emit('event', event);
  }

  private syncMissionAndOrder(telemetry: DroneTelemetry): void {
    if (!telemetry.missionId) return;
    const mission = store.getMission(telemetry.missionId);
    if (!mission) return;
    // Mark the order in_flight the first time we see movement (idempotent).
    if (
      telemetry.state === 'in_flight' &&
      mission.status === 'in_flight'
    ) {
      const order = store.getOrder(mission.orderId);
      if (order && order.status !== 'in_flight') {
        const updated = store.updateOrder(order.id, { status: 'in_flight' });
        if (updated) this.emit({ type: 'order', data: updated });
      }
    }
  }
}

export const dispatch = new DispatchService();
