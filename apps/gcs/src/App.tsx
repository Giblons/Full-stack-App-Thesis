import { useEffect, useMemo, useState } from 'react';
import type {
  DroneTelemetry,
  Mission,
  Order,
  TelemetryEvent,
} from '@drone/shared';
import { client } from './api.js';
import { MissionMap } from './MissionMap.js';

export function App() {
  const [telemetry, setTelemetry] = useState<DroneTelemetry | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [connected, setConnected] = useState(false);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    client.listMissions().then(setMissions).catch(() => undefined);
    client.listOrders().then(setOrders).catch(() => undefined);

    const close = client.subscribe((event: TelemetryEvent) => {
      setConnected(true);
      if (event.type === 'telemetry') {
        setTelemetry(event.data);
      } else if (event.type === 'mission') {
        setMissions((prev) => upsert(prev, event.data));
      } else if (event.type === 'order') {
        setOrders((prev) => upsert(prev, event.data));
      }
    });
    return close;
  }, []);

  // The mission currently being flown, if any, else the most recent one.
  const activeMission = useMemo<Mission | null>(() => {
    if (telemetry?.missionId) {
      const m = missions.find((x) => x.id === telemetry.missionId);
      if (m) return m;
    }
    return missions[0] ?? null;
  }, [missions, telemetry]);

  const activeOrder = useMemo<Order | null>(() => {
    if (!activeMission) return null;
    return orders.find((o) => o.id === activeMission.orderId) ?? null;
  }, [orders, activeMission]);

  return (
    <div className="gcs">
      <aside className="panel">
        <div className="brand">
          <h1>Ground Control Station</h1>
          <div className="brand-status">
            <span className={`link ${connected ? 'up' : 'down'}`}>
              {connected ? '● telemetry live' : '○ connecting…'}
            </span>
            <span className={`mode mode-${client.mode}`}>
              {client.mode === 'demo' ? 'demo' : 'live'}
            </span>
          </div>
        </div>

        <TelemetryPanel telemetry={telemetry} />

        <div className="controls">
          <h3>Flight commands</h3>
          <div className="btn-row">
            <button onClick={() => client.sendCommand('hold')}>Hold</button>
            <button onClick={() => client.sendCommand('resume')}>Resume</button>
            <button className="danger" onClick={() => client.sendCommand('rtl')}>
              RTL
            </button>
          </div>
          <label className="follow">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />
            Follow drone
          </label>
          <p className="mock-note">
            Mock adapter — commands nudge the simulated drone. Wire PX4/MAVSDK
            for real flight.
          </p>
        </div>

        <MissionPanel mission={activeMission} order={activeOrder} />
      </aside>

      <main className="map-wrap">
        <MissionMap
          mission={activeMission}
          telemetry={telemetry}
          follow={follow}
        />
      </main>
    </div>
  );
}

function TelemetryPanel({ telemetry }: { telemetry: DroneTelemetry | null }) {
  if (!telemetry) {
    return (
      <div className="telemetry">
        <p className="muted">No telemetry yet. Create a delivery to launch.</p>
      </div>
    );
  }
  const battery = telemetry.batteryPercent;
  const batteryColor =
    battery > 50 ? '#10b981' : battery > 20 ? '#f59e0b' : '#ef4444';
  return (
    <div className="telemetry">
      <div className="drone-id">
        {telemetry.droneId}
        <span className={`state state-${telemetry.state}`}>
          {telemetry.state}
        </span>
      </div>

      <div className="battery">
        <div className="battery-label">
          <span>Battery</span>
          <span>{battery.toFixed(0)}%</span>
        </div>
        <div className="battery-bar">
          <div
            className="battery-fill"
            style={{ width: `${battery}%`, background: batteryColor }}
          />
        </div>
      </div>

      <dl className="stats">
        <Stat label="Altitude" value={`${telemetry.altitudeMeters} m`} />
        <Stat label="Speed" value={`${telemetry.groundSpeedMps} m/s`} />
        <Stat label="Heading" value={`${telemetry.headingDegrees}°`} />
        <Stat
          label="Progress"
          value={`${Math.round(telemetry.missionProgress * 100)}%`}
        />
      </dl>
    </div>
  );
}

function MissionPanel({
  mission,
  order,
}: {
  mission: Mission | null;
  order: Order | null;
}) {
  if (!mission) {
    return (
      <div className="mission">
        <h3>Mission</h3>
        <p className="muted">No mission dispatched.</p>
      </div>
    );
  }
  return (
    <div className="mission">
      <h3>Mission</h3>
      <dl className="stats">
        <Stat label="Mission" value={mission.id.slice(0, 8)} />
        <Stat label="Status" value={mission.status} />
        {order && <Stat label="Package" value={order.packageDescription} />}
        {order && <Stat label="Customer" value={order.customerName} />}
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function upsert<T extends { id: string }>(items: T[], next: T): T[] {
  const idx = items.findIndex((i) => i.id === next.id);
  if (idx === -1) return [next, ...items];
  const copy = items.slice();
  copy[idx] = next;
  return copy;
}
