# PX4 SITL runbook — run the real drone adapter on your laptop

This is the **exact, do-tonight** checklist to fly the delivery app against **PX4 SITL**
(software-in-the-loop) instead of the mock. The `Px4DroneAdapter`
(`services/api/src/drone/px4Adapter.ts`) is already implemented and merged; this
runbook is what you run on the PC to see a real PX4 vehicle move in the GCS.

Scope reminder: this is a **book-and-watch GCS** for package delivery. It is **not**
Mission Planner/QGC — no param tree, no full mission editor, no arm/mode panel. No
MAVROS. No ArduPilot.

**What the app does with PX4:** an order's pickup→dropoff becomes a MAVLink mission
(takeoff → pickup waypoint → dropoff waypoint → land), uploaded and started on the
vehicle; PX4 telemetry is mapped into the same SSE/types the GCS already renders; and
Hold / Resume / RTL are sent as MAVLink actions.

---

## 0. Prerequisites (one-time)

- **Node ≥ 20** and this repo cloned, deps installed (`npm install`).
- **PX4-Autopilot** SITL able to run on your machine. If you don't have it yet:
  ```bash
  git clone https://github.com/PX4/PX4-Autopilot.git --recursive
  cd PX4-Autopilot
  # follow PX4's "Setup Developer Environment" for your OS (Ubuntu/macOS)
  ```
- (Optional, debug only) **MAVProxy** if you like a text console: `pip install MAVProxy`.

---

## 1. Start PX4 SITL

From the `PX4-Autopilot` checkout, start any SITL target. Pick one:

```bash
# Gazebo (nice visuals, needs a GPU/desktop)
make px4_sitl gz_x500

# OR jMAVSim (lighter)
make px4_sitl jmavsim

# OR fully headless (CI / no GPU)
HEADLESS=1 make px4_sitl gz_x500
```

Wait until the PX4 shell prints `INFO [commander] Ready for takeoff!` (it has a
simulated GPS lock and is armable).

**MAVLink endpoint:** PX4 SITL exposes the offboard/SDK MAVLink API on **UDP 14540**
(the same endpoint MAVSDK uses) and a GCS link on 14550. Our adapter connects to
**`udp://0.0.0.0:14540`** by default — no PX4 config changes needed.

> If you also run QGroundControl, it grabs 14550 for viewing; that's fine and
> independent of the app on 14540.

---

## 2. (Optional) MAVProxy as a debug sidecar

Purely to *observe* — the app does not need it. Attach MAVProxy to the **GCS** port
(14550) so it doesn't compete with the API on 14540:

```bash
mavproxy.py --master=udp:127.0.0.1:14550 --console
# then e.g.  status   /   mode   /   wp list
```

Do **not** point MAVProxy at 14540 while the API is using it.

---

## 3. Point the API at SITL and run all three apps

The adapter is selected by an env flag; `mock` stays the default. Run the whole stack
with PX4 selected:

```bash
# from the repo root
DRONE_ADAPTER=px4 npm run dev
```

That starts the API (PX4 adapter), the customer app (`:5173`), and the GCS (`:5174`).

Relevant env vars (all optional except the flag):

| Env | Default | Meaning |
| --- | --- | --- |
| `DRONE_ADAPTER` | `mock` | `px4` to use the real MAVLink adapter |
| `PX4_MAVLINK_URL` | `udp://0.0.0.0:14540` | MAVLink UDP endpoint to bind/connect |
| `PX4_MISSION_ALTITUDE` | `30` | Cruise altitude (m, relative) for the uploaded mission |
| `PX4_CONNECT_TIMEOUT_MS` | `8000` | How long to wait for the PX4 heartbeat before falling back to mock |

**Fallback:** if PX4 can't be reached within the timeout, the API logs a warning and
**falls back to the mock** so nothing breaks. You'll see this in the API log:
`PX4 SITL not reachable … falling back to mock`.

Prefer to run only the API against PX4 (and the two frontends separately)?

```bash
DRONE_ADAPTER=px4 npm run dev:api
npm run dev:customer   # in another shell
npm run dev:gcs        # in another shell
```

---

## 4. Verify customer → GCS shows real telemetry

1. Confirm the backend is PX4:
   ```bash
   curl -s http://localhost:4000/drone/info
   # -> {"adapter":"px4","droneId":"px4-1"}
   ```
   The GCS panel also shows **“Backend: PX4 SITL (px4-1)”** (not “mock”).
2. Open the **GCS** at http://localhost:5174 — you should already see live telemetry
   (battery/altitude/heading/speed) streaming from PX4, drone state `idle`/`landed`.
3. Open the **customer app** at http://localhost:5173 and **Request delivery**
   (pickup/dropoff are prefilled). This uploads + starts the mission on PX4.
4. Watch the **GCS**: PX4 arms, takes off, flies pickup → dropoff, and the marker moves
   with **real SITL telemetry**; mission progress climbs; state goes
   `in_flight` → … → `landed` (delivered) at the dropoff.
5. Try the flight commands (real MAVLink actions):
   - **Hold** → `MAV_CMD_DO_PAUSE_CONTINUE(0)` (PX4 loiters)
   - **Resume** → `MAV_CMD_DO_PAUSE_CONTINUE(1)`
   - **RTL** → `MAV_CMD_NAV_RETURN_TO_LAUNCH`

You can cross-check any of this in the PX4 console (or the optional MAVProxy).

---

## 5. Troubleshooting

- **HUD says “mock”, log says “falling back to mock”.** PX4 heartbeat not seen on 14540.
  Check SITL is running, that nothing else owns 14540, and that `PX4_MAVLINK_URL`
  matches your setup. Increase `PX4_CONNECT_TIMEOUT_MS` if SITL is slow to boot.
- **Connected, but the mission won't start / vehicle won't arm.** PX4 needs to be
  armable (GPS lock, no preflight failsafes). Watch the PX4 shell for the reject reason;
  `commander check` helps. Lower/raise `PX4_MISSION_ALTITUDE` if geofence/altitude
  limits complain.
- **Different SITL port.** Some setups stream to 14550/18570 instead. Set
  `PX4_MAVLINK_URL=udp://0.0.0.0:<port>` accordingly. The adapter learns PX4's reply
  address from the first packet, so binding the port PX4 streams to is what matters.
- **Two GCS fighting.** If QGC is bound to 14540, move it to 14550 or close it.

---

## How it connects (for reference)

The adapter is a thin MAVLink/UDP client (`node-mavlink`, pure TypeScript — no
`mavsdk_server` binary): it binds the UDP port, waits for the autopilot `HEARTBEAT`
(component 1) to adopt it as the command target, sends a 1 Hz GCS heartbeat, and maps
`GLOBAL_POSITION_INT` / `VFR_HUD` / `SYS_STATUS` / `EXTENDED_SYS_STATE` /
`MISSION_CURRENT` / `MISSION_ITEM_REACHED` into `DroneTelemetry`. Mission upload uses the
standard `MISSION_COUNT` → `MISSION_REQUEST(_INT)` → `MISSION_ITEM_INT` → `MISSION_ACK`
handshake. See `services/api/src/drone/px4Adapter.ts`.
