# PX4 SITL + MAVSDK/MAVLink integration plan

This document describes how the **mock** drone in this repository is replaced by a
real (simulated, then physical) drone. Nothing here is required to run the thin
slice — it flies a mock by default.

> **Status: implemented.** A real `Px4DroneAdapter`
> (`services/api/src/drone/px4Adapter.ts`) now exists behind the `DroneAdapter`
> interface, selected with `DRONE_ADAPTER=px4`. For the exact laptop steps to run PX4
> SITL and verify it, see **[`px4-sitl-runbook.md`](px4-sitl-runbook.md)**. The rest of
> this file is the design rationale.

## The seam: `DroneAdapter`

The API never talks to a drone directly. It talks to a single interface:

```ts
// services/api/src/drone/adapter.ts
export interface DroneAdapter {
  readonly droneId: string;
  startMission(mission: Mission): Promise<void>;
  command(command: DroneCommand): Promise<void>;   // 'hold' | 'resume' | 'rtl'
  getTelemetry(): DroneTelemetry;
  onTelemetry(listener: (t: DroneTelemetry) => void): () => void;
  onMissionComplete(listener: (missionId: string) => void): () => void;
}
```

Today the concrete implementation is `MockDroneAdapter`, which interpolates a position
along the pickup→dropoff polyline. Tomorrow it's a `Px4DroneAdapter` backed by MAVSDK.
**The API routes, the SSE stream, the customer app, and the GCS do not change** — only
the class that `services/api/src/dispatch.ts` instantiates.

## Step 1 — Run PX4 SITL

PX4 SITL (Software In The Loop) runs the real PX4 flight stack on your machine with a
simulated vehicle and physics. A typical setup:

```bash
# Clone + build PX4 (one-time)
git clone https://github.com/PX4/PX4-Autopilot.git --recursive
cd PX4-Autopilot

# Launch SITL with the Gazebo x500 quadcopter
make px4_sitl gz_x500
```

PX4 SITL exposes MAVLink (typically UDP `udpin://0.0.0.0:14540` for offboard/GCS APIs).
You can point QGroundControl at it to sanity-check the sim independently of this app.

> In a CI/VM without a GPU, use a headless simulator (e.g. `jmavsim`, or Gazebo headless)
> or the `none` PX4 target. The mock exists precisely so this repo doesn't *require* SITL
> to boot.

## Step 2 — Implement `Px4DroneAdapter` with MAVSDK

[MAVSDK](https://mavsdk.mavlink.io/) provides a clean async API over MAVLink. Use the
Node/TypeScript bindings, or run `mavsdk_server` and talk to it over gRPC.

Responsibilities of the adapter:

| DroneAdapter method | MAVSDK / MAVLink mapping |
| --- | --- |
| `startMission(mission)` | Convert `mission.path` (LatLng[]) into `MissionItem`s, `mission.upload_mission()`, then `action.arm()` + `mission.start_mission()`. |
| `command('hold')` | `action.hold()` (pauses at current position). |
| `command('resume')` | `mission.start_mission()` again / clear hold. |
| `command('rtl')` | `action.return_to_launch()`. |
| `getTelemetry()` | Last sample cached from the telemetry subscriptions below. |
| `onTelemetry(cb)` | Subscribe to `telemetry.position()`, `telemetry.battery()`, `telemetry.heading()`, `telemetry.velocity_ned()`, `telemetry.flight_mode()`; map into `DroneTelemetry`. |
| `onMissionComplete(cb)` | Subscribe to `mission.mission_progress()`; fire when `current == total`. |

Sketch:

```ts
export class Px4DroneAdapter implements DroneAdapter {
  readonly droneId = 'px4-1';
  // connect via mavsdk, cache latest telemetry, expose the interface above
}
```

### Mapping telemetry

`DroneTelemetry` (in `packages/shared`) was designed to be a thin projection of MAVLink:

- `position` ← `telemetry.position()` (lat/lon)
- `altitudeMeters` ← relative altitude from `position`
- `batteryPercent` ← `telemetry.battery().remaining_percent * 100`
- `headingDegrees` ← `telemetry.heading()`
- `groundSpeedMps` ← magnitude of `telemetry.velocity_ned()`
- `state` ← derived from `telemetry.flight_mode()` (`HOLD`→`hold`, `RETURN_TO_LAUNCH`→`returning`, etc.)
- `missionProgress` ← from `mission.mission_progress()`

## Step 3 — Flip the switch (done)

Adapter selection lives in `services/api/src/drone/factory.ts` and is driven by the
`DRONE_ADAPTER` env var (`mock` default, `px4` for real flight). The mock stays the
default and is also used as an automatic **fallback** if PX4 SITL can't be reached, so
demos/tests never break:

```bash
DRONE_ADAPTER=px4 npm run dev   # see docs/px4-sitl-runbook.md
```

Note: this project implements the adapter with a thin MAVLink/UDP client
(`node-mavlink`) rather than the gRPC `mavsdk_server`, so there's no extra binary to run
— the same MAVLink actions described below are sent directly.

## Step 4 — Beyond SITL

Once SITL works, the same adapter connects to a real vehicle by pointing MAVSDK at the
telemetry radio / companion computer instead of the SITL UDP endpoint. Safety features
(geofencing, RTL-on-low-battery, failsafes) are configured in PX4 itself and surfaced in
the GCS via the telemetry `state`.
