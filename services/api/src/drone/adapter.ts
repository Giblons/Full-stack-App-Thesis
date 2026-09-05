import type { DroneCommand, DroneTelemetry, Mission } from '@drone/shared';

/**
 * Abstraction over "the thing that flies". The API talks only to this
 * interface, so the mock source used in this thin slice can later be swapped
 * for a PX4 SITL / MAVSDK-backed implementation without touching the routes.
 *
 * See docs/px4-sitl.md for how the real adapter will plug in.
 */
export interface DroneAdapter {
  /** Stable identifier for the drone this adapter controls. */
  readonly droneId: string;

  /** Upload + start executing a mission (pickup -> dropoff polyline). */
  startMission(mission: Mission): Promise<void>;

  /** Issue a flight command (hold / resume / return-to-launch). */
  command(command: DroneCommand): Promise<void>;

  /** Current telemetry snapshot. */
  getTelemetry(): DroneTelemetry;

  /** Subscribe to telemetry updates. Returns an unsubscribe function. */
  onTelemetry(listener: (telemetry: DroneTelemetry) => void): () => void;

  /** Fired once per mission when the drone reaches the dropoff. */
  onMissionComplete(listener: (missionId: string) => void): () => void;
}
