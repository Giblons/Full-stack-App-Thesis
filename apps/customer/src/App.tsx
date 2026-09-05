import { useEffect, useState } from 'react';
import type { CreateOrderInput, Order, OrderStatus } from '@drone/shared';
import { client } from './api.js';

const DEMO_PICKUP = { lat: -6.9147, lng: 107.6098 }; // Bandung Alun-Alun
const DEMO_DROPOFF = { lat: -6.8915, lng: 107.6107 }; // ITB campus area

const STATUS_LABELS: Record<OrderStatus, string> = {
  requested: 'Requested',
  assigned: 'Assigned',
  in_flight: 'In flight',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function App() {
  const [customerName, setCustomerName] = useState('Rizky');
  const [packageDescription, setPackageDescription] = useState('Documents');
  const [pickup, setPickup] = useState(DEMO_PICKUP);
  const [dropoff, setDropoff] = useState(DEMO_DROPOFF);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    try {
      setOrders(await client.listOrders());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const input: CreateOrderInput = {
      customerName,
      packageDescription,
      pickup,
      dropoff,
    };
    try {
      await client.createOrder(input);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <header>
        <h1>🚁 Drone Delivery</h1>
        <p className="subtitle">Book a package delivery. Ugly but it works.</p>
        <span className={`mode mode-${client.mode}`}>
          {client.mode === 'demo'
            ? 'Demo mode — runs entirely in your browser'
            : 'Live — connected to API'}
        </span>
      </header>

      <form className="card" onSubmit={onSubmit}>
        <h2>New delivery request</h2>
        <label>
          Your name
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            required
          />
        </label>
        <label>
          Package
          <input
            value={packageDescription}
            onChange={(e) => setPackageDescription(e.target.value)}
            required
          />
        </label>

        <fieldset>
          <legend>Pickup</legend>
          <CoordInput value={pickup} onChange={setPickup} />
        </fieldset>
        <fieldset>
          <legend>Dropoff</legend>
          <CoordInput value={dropoff} onChange={setDropoff} />
        </fieldset>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Requesting…' : 'Request delivery'}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="hint">
          Watch the flight in the Ground Control Station (the GCS app).
        </p>
      </form>

      <section className="card">
        <h2>Your deliveries</h2>
        {orders.length === 0 && <p className="muted">No orders yet.</p>}
        <ul className="orders">
          {orders.map((o) => (
            <li key={o.id}>
              <div>
                <strong>{o.packageDescription}</strong>
                <span className="muted"> for {o.customerName}</span>
              </div>
              <div className="row">
                <span className={`badge status-${o.status}`}>
                  {STATUS_LABELS[o.status]}
                </span>
                <code className="muted">{o.id.slice(0, 8)}</code>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CoordInput({
  value,
  onChange,
}: {
  value: { lat: number; lng: number };
  onChange: (v: { lat: number; lng: number }) => void;
}) {
  return (
    <div className="coords">
      <label>
        lat
        <input
          type="number"
          step="any"
          value={value.lat}
          onChange={(e) => onChange({ ...value, lat: Number(e.target.value) })}
        />
      </label>
      <label>
        lng
        <input
          type="number"
          step="any"
          value={value.lng}
          onChange={(e) => onChange({ ...value, lng: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
