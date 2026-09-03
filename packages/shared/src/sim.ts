/**
 * Simulation constants shared by the server-side mock drone adapter and the
 * browser-side demo engine, so both "fly" the same way.
 */
export const SIM = {
  /** Update cadence in milliseconds. */
  TICK_MS: 500,
  /** Cruise ground speed (~43 km/h), a plausible delivery-drone cruise. */
  CRUISE_SPEED_MPS: 12,
  /** Cruise altitude in meters. */
  CRUISE_ALTITUDE_M: 60,
  /** Battery drain per second while flying, in percent. */
  BATTERY_DRAIN_PER_SEC: 0.15,
} as const;
