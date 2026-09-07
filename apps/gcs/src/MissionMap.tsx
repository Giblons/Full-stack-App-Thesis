import { useEffect } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import type { DroneTelemetry, LatLng, Mission } from '@drone/shared';
import { DEFAULT_MAP_CENTER } from '@drone/shared';
import { droneIcon, pinIcon } from './icons.js';

function FollowDrone({
  position,
  enabled,
}: {
  position: LatLng | null;
  enabled: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (enabled && position) {
      map.panTo([position.lat, position.lng], { animate: true });
    }
  }, [enabled, position, map]);
  return null;
}

export function MissionMap({
  mission,
  telemetry,
  follow,
}: {
  mission: Mission | null;
  telemetry: DroneTelemetry | null;
  follow: boolean;
}) {
  const center = mission?.path[0] ?? telemetry?.position ?? DEFAULT_MAP_CENTER;
  const pickup = mission?.path[0];
  const dropoff = mission ? mission.path[mission.path.length - 1] : undefined;

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={14}
      className="map"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {mission && (
        <Polyline
          positions={mission.path.map((p) => [p.lat, p.lng])}
          pathOptions={{ color: '#4338ca', weight: 3, dashArray: '6 8' }}
        />
      )}

      {pickup && (
        <Marker position={[pickup.lat, pickup.lng]} icon={pinIcon('P', '#0ea5e9')}>
          <Popup>Pickup</Popup>
        </Marker>
      )}
      {dropoff && (
        <Marker
          position={[dropoff.lat, dropoff.lng]}
          icon={pinIcon('D', '#10b981')}
        >
          <Popup>Dropoff</Popup>
        </Marker>
      )}

      {telemetry && (
        <Marker
          position={[telemetry.position.lat, telemetry.position.lng]}
          icon={droneIcon(telemetry.headingDegrees)}
        >
          <Popup>
            {telemetry.droneId} · {telemetry.state}
          </Popup>
        </Marker>
      )}

      <FollowDrone position={telemetry?.position ?? null} enabled={follow} />
    </MapContainer>
  );
}
