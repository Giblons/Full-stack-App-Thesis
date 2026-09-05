import type { LatLng } from './index.js';

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance between two points in meters (haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from point a to point b, in degrees (0..360). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Total length of a polyline in meters. */
export function pathLengthMeters(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += haversineMeters(path[i - 1], path[i]);
  }
  return total;
}

/** Linear interpolation between two coordinates. */
function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

export interface PointAlongPath {
  position: LatLng;
  /** Heading toward the next vertex, in degrees. */
  heading: number;
}

/**
 * Return the position `distance` meters along `path`, clamped to the endpoints.
 * Good enough for the mock: treats each segment as a straight line.
 */
export function pointAlongPath(path: LatLng[], distance: number): PointAlongPath {
  if (path.length === 0) {
    return { position: { lat: 0, lng: 0 }, heading: 0 };
  }
  if (path.length === 1 || distance <= 0) {
    return {
      position: path[0],
      heading: path.length > 1 ? bearingDegrees(path[0], path[1]) : 0,
    };
  }

  let remaining = distance;
  for (let i = 1; i < path.length; i += 1) {
    const segLen = haversineMeters(path[i - 1], path[i]);
    if (remaining <= segLen || i === path.length - 1) {
      const t = segLen === 0 ? 1 : Math.min(1, remaining / segLen);
      return {
        position: lerp(path[i - 1], path[i], t),
        heading: bearingDegrees(path[i - 1], path[i]),
      };
    }
    remaining -= segLen;
  }

  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  return { position: last, heading: bearingDegrees(prev, last) };
}
