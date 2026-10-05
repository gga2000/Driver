# Live Share Page and Nearby Vehicles (SP5c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The family share page shows the same moving map as the rider (car gliding along the road, the road ahead, where it is heading) and updates the moment the car moves; before booking a taxi or tuktuk, the customer sees the free vehicles around them and how soon the nearest one could be there.

**Architecture:** Share: a public tRPC subscription `live.share({ token })` re-reads the shared trip each time the ride's live channel carries an event (≤ every 2 s) or every 15 s (intercity: every 5 s, its positions are not on the bus), and streams `hello` then `share` snapshots through the app's existing live connection (reconnect, fallback polling). `LiveService.watch` gives a public stream its wake-ups without forwarding any bus event. `tracking.sharedRoute` returns the road from the car to its target. The customer app's road glide and follow camera move out of `TrackMap` into two hooks used by both maps. Nearby: `dispatch.nearby` returns ≤ 8 free vehicles of the asked kind within 3 km, each moved 50–100 m in a direction fixed per driver for 10 minutes (HMAC), no ids, heading from the driver's last movement, plus the nearest one's minutes to the pickup on the one ETA. The choose-ride map draws them and glides them between 10 s refreshes by matching nearest neighbours.

**Tech Stack:** zod/tRPC v11 subscriptions over SSE, NestJS, React Native + Reanimated, vitest.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.5 (c9, c10). Board text Ali approved for c9: "the shared link shows the same moving map with the route and destination, and updates instantly".

## Decisions

1. **Destination on the share page** (approved board text): a pin and the road to it, never an address in words. The rider's share sheet and the page's privacy line change so their promise stays true: no phone number, no full name.
2. **Views count page opens**, not refreshes: `tracking.shared({ token, again: true })` and the stream's reads do not count. Today every 5 s poll counts as a view.
3. **`dispatch.nearby`** instead of the spec's `ride.nearby`: there is no ride router; presence and the busy rule live in dispatch. Signed-in customers only.
4. **Free** = online, vehicle and roles fit the vertical (`vehicleFit` > 0: a taxi is a car or an SUV, a tuktuk only a tuktuk), no job (`driverJobs` empty). Drivers holding an open offer still count (they are free until they accept).
5. **No road snapping yet**: needs OSRM's `nearest`, not deployed. The 50–100 m blur alone protects drivers; snapping lands with the OSRM deploy.
6. **Heading** comes from the driver's own movement between presence updates (≥ 15 m), else null (drawn pointing north).
7. **Share stream payload** is the same `SharedTrip` as the query, so the page has one shape and the stream never carries internal ids or channel names (`hello.channels = ['share']`).

## Constants

| Where | Name | Value | Why |
|---|---|---|---|
| contracts share-io | `SHARE_LIVE_RULES.refreshMs` | 15 000 | Ages the ETA, catches revoke/expiry between ride events. |
| contracts share-io | `SHARE_LIVE_RULES.intercityMs` | 5 000 | Intercity positions are not on the bus: re-read like the old poll, server side. |
| contracts dispatch-io | `NEARBY_RULES.radiusM` | 3 000 | Spec. |
| | `NEARBY_RULES.max` | 8 | Spec. |
| | `NEARBY_RULES.jitterMinM` / `jitterMaxM` | 50 / 100 | Spec. |
| | `NEARBY_RULES.jitterBucketMin` | 10 | Same blur for 10 minutes: no jumping between refreshes, no averaging it away. |
| | `NEARBY_RULES.refreshMs` | 10 000 | Spec. |
| api presence | `HEADING_MIN_MOVE_M` | 15 | Below this, GPS noise, keep the last heading. |
| customer | `NEARBY_MATCH_M` | 300 | A vehicle within 300 m of one in the last set is the same one: glide, don't blink. |

## Tasks

1. **Contracts**: `SharedTripInput.again`; `SharedTrip.target { lat, lng, kind: pickup|dropoff } | null`, `position.bearing/speedKmh`; `SHARE_LIVE_RULES`; `TrackingSharePort.sharedRoute(input) → OrderRoute`, `liveChannels(input) → string[]`; `tracking.sharedRoute` (public query); `LiveShare { type: 'share', trip }` in `LiveEvent`; `LivePort.watch({ channels, everyMs, minGapMs, signal })`; `live.share` (public subscription: hello, then a snapshot per wake-up, ends after `ended`). `NEARBY_RULES`, `NearbyVehiclesInput { cityId, pin, vertical: taxi|tuktuk }`, `NearbyVehicles { vehicles: { lat, lng, heading }[], nearestMinutes, at }`, `DispatchPort.nearby`, `dispatch.nearby` (protected). Router test for `live.share`.
2. **API live**: `LiveService.watch` (subscribe, yield once ready, then on events coalesced to `minGapMs` or every `everyMs`; shutdown and abort end it) + tests.
3. **API share**: `shared` counts only without `again`; `target` and bearing/speed in ride state; `sharedRoute` via `EtaService.path([car, target])`; `liveChannels` (ride → its order channel; intercity → none) + tests.
4. **API nearby**: presence `heading` (online/heartbeat, Redis hash field); `nearby.ts` pure `jitterPin(pin, driverId, bucket, secret)`; `DispatchService.nearby` (filter, ≤ 8, jitter, nearest minutes via `EtaService.fromMany`) + tests; demo drivers move so headings exist.
5. **Customer hooks**: `useRoadGlide` (fix → glide along the road, stray → refetch) and `useFollowCamera` (frame focus, follow until a gesture, recentre) extracted from `TrackMap`; `TrackMap` uses them unchanged in behaviour.
6. **Share page**: `features/share/queries.ts` (`useSharedTrip`: counted first read, `live.share` patches, fallback polling with `again`; `useSharedRoute`); `ShareMap` with road, target pin, minutes pill, follow camera + recentre; copy updates (sheet body, privacy line, target pin labels).
7. **Nearby on the choose map**: `features/ride/nearby.ts` (`matchVehicles` + tests), `useNearbyVehicles(pin, vertical)`, `NearbyVehicles` overlay in `RideMap` (smaller top-down vehicles, glide 1 s, fade in/out, still under reduce motion); nearest minutes on the vehicle card.
8. **Verify**: typecheck/lint/tests, e2e, screenshots (share page live with road and destination; choose screen with cars and tuktuks), commit, push, CI.
