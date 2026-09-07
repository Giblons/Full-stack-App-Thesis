import type { DroneAdapter } from './adapter.js';
import { MockDroneAdapter } from './mockAdapter.js';
import { Px4DroneAdapter, type Px4Logger } from './px4Adapter.js';

/**
 * Select the drone adapter from the environment:
 *
 *   DRONE_ADAPTER=mock   (default) — simulated drone, no external deps
 *   DRONE_ADAPTER=px4              — real MAVLink/PX4 SITL adapter
 *
 * When `px4` is selected but SITL can't be reached within the timeout, we log a
 * warning and fall back to the mock so the app (and the customer → GCS demo)
 * still works. This keeps the mock as the safe default/fallback.
 *
 * PX4 tuning env: PX4_MAVLINK_URL (default udp://0.0.0.0:14540),
 * PX4_MISSION_ALTITUDE (m, default 30), PX4_CONNECT_TIMEOUT_MS (default 8000).
 */
export async function createDroneAdapter(logger: Px4Logger): Promise<DroneAdapter> {
  const kind = (process.env.DRONE_ADAPTER ?? 'mock').toLowerCase();

  if (kind === 'px4') {
    const url = process.env.PX4_MAVLINK_URL ?? 'udp://0.0.0.0:14540';
    const missionAltitude = Number(process.env.PX4_MISSION_ALTITUDE ?? 30);
    const timeout = Number(process.env.PX4_CONNECT_TIMEOUT_MS ?? 8000);
    const px4 = new Px4DroneAdapter({ url, missionAltitude, logger });
    try {
      await px4.connect(timeout);
      logger.info(`Drone adapter: px4 (${url}, droneId=${px4.droneId})`);
      return px4;
    } catch (err) {
      logger.warn(
        `PX4 SITL not reachable at ${url} (${(err as Error).message}); falling back to mock`,
      );
      await px4.close();
      return new MockDroneAdapter();
    }
  }

  logger.info('Drone adapter: mock');
  return new MockDroneAdapter();
}
