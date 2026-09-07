import L from 'leaflet';

export function droneIcon(headingDegrees: number): L.DivIcon {
  return L.divIcon({
    className: 'drone-icon',
    html: `<div class="drone-marker" style="transform: rotate(${headingDegrees}deg)">🚁</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export function pinIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: 'pin-icon',
    html: `<div class="pin-marker" style="background:${color}"><span>${label}</span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
  });
}
