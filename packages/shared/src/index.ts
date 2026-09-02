/**
 * Shared domain types for the drone delivery thesis product.
 *
 * These types are the contract between the customer app, the GCS, and the API.
 * Keep them framework-agnostic so every workspace can import them.
 */

/** A WGS84 coordinate. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Lifecycle of a customer delivery order. */
export type OrderStatus =
  | 'requested' // created by the customer, not yet dispatched
  | 'assigned' // a drone + mission have been assigned
  | 'in_flight' // drone is executing the mission
  | 'delivered' // package dropped at the dropoff point
  | 'cancelled';

/** A customer's request to move one package from pickup to dropoff. */
export interface Order {
  id: string;
  customerName: string;
  packageDescription: string;
  pickup: LatLng;
  dropoff: LatLng;
  status: OrderStatus;
  missionId?: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/** Payload the customer app sends to create an order. */
export interface CreateOrderInput {
  customerName: string;
  packageDescription: string;
  pickup: LatLng;
  dropoff: LatLng;
}

/** Lifecycle of a flight mission. */
export type MissionStatus =
  | 'pending'
  | 'in_flight'
  | 'completed'
  | 'aborted';

/**
 * A mission is the flight plan derived from an order. In this thin slice the
 * path is a simple two-point polyline (pickup -> dropoff); later, PX4/MAVSDK
 * can replace this with a real uploaded mission with waypoints.
 */
export interface Mission {
  id: string;
  orderId: string;
  droneId: string;
  path: LatLng[];
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
}

/** High-level drone state, loosely mirroring MAVLink flight modes. */
export type DroneState =
  | 'idle'
  | 'in_flight'
  | 'hold'
  | 'returning' // return-to-launch (RTL)
  | 'landed';

/** A single telemetry sample for one drone. */
export interface DroneTelemetry {
  droneId: string;
  missionId?: string;
  position: LatLng;
  altitudeMeters: number;
  batteryPercent: number;
  headingDegrees: number;
  groundSpeedMps: number;
  state: DroneState;
  /** Fraction of the current mission path completed, 0..1. */
  missionProgress: number;
  timestamp: string;
}

/** Commands the GCS can issue to a drone. Placeholders in the mock adapter. */
export type DroneCommand = 'hold' | 'resume' | 'rtl';

/** Server-sent event envelope pushed over the telemetry stream. */
export type TelemetryEvent =
  | { type: 'telemetry'; data: DroneTelemetry }
  | { type: 'mission'; data: Mission }
  | { type: 'order'; data: Order };

/** Default demo coordinates (Bandung, Indonesia) used to seed the map view. */
export const DEFAULT_MAP_CENTER: LatLng = { lat: -6.9147, lng: 107.6098 };
