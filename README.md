# Full-stack-App-Thesis

**Master's thesis product — Muhammad Rizky Permana**

A Gojek/Grab-style full-stack application for **autonomous drone package delivery**,
paired with a web-based **Ground Control Station (GCS)** to command the drone and
watch live telemetry.

Two audiences, one system:

- **Customer** books a delivery ("send this package from A to B") and tracks its status,
  the same way you'd book a ride on Gojek/Grab.
- **Operator** watches and controls the drone from the GCS: a map with the drone's live
  position, the mission path, battery/status, and flight commands (Hold / Resume / RTL).

> This is the *delivery* product and is distinct from the author's SAR UAV-swarm work.
> The thesis writing happens later; **this repository is the software**.

---

## What this first slice is (and isn't)

This PR is a deliberately thin, end-to-end slice: **one customer → one package → one
drone → one delivery, all visible in the GCS.**

**In scope**

- Create a delivery request in the customer app.
- The API turns it into a *mission* (pickup → dropoff polyline) and dispatches a drone.
- A **mock drone** flies the polyline; telemetry streams to the GCS over SSE.
- The GCS shows the drone moving on a map, the mission path, battery/state, and
  Hold/Resume/RTL controls.

**Out of scope (intentionally)**

- No marketplace, payments, driver/fleet matching, or multi-tenant auth.
- No persistence (in-memory store) and no real hardware/PX4 in this PR.

### Real vs. mock

| Piece | Status | Notes |
| --- | --- | --- |
| Customer app (book & track) | **Real** | Vite + React UI, talks to the API. |
| API (orders → missions, telemetry fan-out) | **Real** | Fastify, in-memory store, SSE stream. |
| GCS (map, drone marker, mission path, telemetry, controls) | **Real** | Vite + React + Leaflet, live SSE. |
| Shared domain types | **Real** | `Order`, `Mission`, `DroneTelemetry`, … |
| The drone itself | **Mock** | `MockDroneAdapter` flies the polyline at a constant cruise speed with linear battery drain. |
| Flight commands (Hold/Resume/RTL) | **Mock** | They nudge the simulated drone; not yet MAVLink actions. |
| Persistence | **Mock** | In-memory; restart clears all data. |
| PX4 SITL / MAVSDK | **Not wired yet** | Interface is scaffolded — see [`docs/px4-sitl.md`](docs/px4-sitl.md). |

The drone is hidden behind a `DroneAdapter` interface. Swapping the mock for a real
PX4/MAVSDK-backed adapter is the main follow-up and does not touch the API routes or
either frontend.

---

## Architecture

```
apps/customer   ─POST /orders──▶  services/api  ──startMission()──▶  DroneAdapter (mock)
     ▲                               │  │                                   │
     └────GET /orders (poll)─────────┘  │                                   │ telemetry
                                        │                                   ▼
apps/gcs   ◀──SSE /telemetry/stream──── └───────────────  fan-out event bus ◀┘
```

- **`packages/shared`** — TypeScript domain types shared by every workspace, so the
  customer app, GCS, and API all speak the same language.
- **`services/api`** — Fastify. Orders + mission dispatch. Owns the drone adapter and a
  Server-Sent-Events (SSE) stream that pushes telemetry/mission/order updates to the GCS.
- **`apps/customer`** — Vite + React. Book a delivery, poll order status. Ugly is fine.
- **`apps/gcs`** — Vite + React + Leaflet. The product: map, drone marker, mission path,
  battery/status, Hold/RTL placeholders. Not a QGroundControl clone.

Ports: API `4000`, customer `5173`, GCS `5174`.

---

## Run it locally

Requires **Node.js ≥ 20** (developed on Node 22). One stack, run with npm scripts.

```bash
npm install
npm run dev
```

`npm run dev` builds the shared types then starts all three apps together
(via `concurrently`). Then open:

- Customer app → <http://localhost:5173>
- GCS → <http://localhost:5174>

**Try the happy path:**

1. In the **customer app**, fill in a package and pickup/dropoff coordinates
   (prefilled with two points in Bandung) and click **Request delivery**.
2. The order appears in the list and moves `requested → in_flight → delivered`.
3. Open the **GCS** — you'll see the drone marker fly along the dashed mission path
   from **P** (pickup) to **D** (dropoff), with live battery/altitude/speed and a
   mission-progress readout. Try **Hold**, **Resume**, and **RTL**.

### Other scripts

```bash
npm run build       # type-check + build every workspace
npm run typecheck   # type-check only
npm run dev:api     # run just the API
npm run dev:customer
npm run dev:gcs
```

There is also a [`docker-compose.yml`](docker-compose.yml) that runs the same three
services in containers (`docker compose up`), for environments where that's preferred.

### Configuration

Both frontends default to `http://localhost:4000` for the API. Override with a
`VITE_API_BASE` env var if you host the API elsewhere.

---

## How PX4 SITL plugs in later

The whole point of the `DroneAdapter` interface is to make the mock removable. In short:

1. Run PX4 SITL (e.g. `make px4_sitl gz_x500`) so a simulated vehicle exposes MAVLink.
2. Implement `Px4DroneAdapter` (using **MAVSDK**) that uploads the mission as real
   waypoints, arms/takes off, and translates MAVLink telemetry into `DroneTelemetry`.
3. Map GCS commands (Hold/Resume/RTL) to MAVSDK `Action` calls.
4. Swap which adapter `services/api` constructs — nothing else changes.

Full walkthrough: [`docs/px4-sitl.md`](docs/px4-sitl.md).

---

## Repository layout

```
apps/
  customer/     book-and-track web UI
  gcs/          web Ground Control Station (map + telemetry + controls)
services/
  api/          orders + mission dispatch + telemetry stream + drone adapter
packages/
  shared/       shared domain types (Order, Mission, DroneTelemetry, …)
docs/
  px4-sitl.md   how PX4 SITL + MAVSDK/MAVLink will plug in
```
