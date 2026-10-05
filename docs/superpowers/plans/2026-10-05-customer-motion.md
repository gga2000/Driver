# Customer Tracking Motion (SP5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the customer's tracking screen the courier moves like a real vehicle along real streets: he glides along the road shape between GPS fixes, keeps moving sensibly through short gaps, never jumps backwards over small corrections, turns with the road; the route line follows the streets and shortens behind him; the marker is a top-down vehicle (motorbike, tuktuk, car) that rotates with his heading and carries the minutes to arrival.

**Architecture:** Server: `orders.route({ orderId })` returns the road polyline from the courier (or the kitchen before a courier) through this customer's remaining stops, via `EtaService.path` (the routing module; `null` polyline without OSRM). Shared: `decodePolyline` in `@driver/map`. Customer: `track/motion.ts` — worklet-safe path maths (cumulative distances, point and heading at a distance, projection onto the path, the remaining path) and `planGlide` (JS thread) that turns a new fix into a glide along the path with a short dead-reckoning tail; `TrackMap` keeps the path in shared values and refetches the route when the courier strays more than 50 m from it or his next stop changes; `RouteLine` draws the remaining road; `CourierMarker` draws a top-down vehicle and the minutes pill. Without a road polyline everything falls back to today's straight glide and dashed straight line.

**Tech Stack:** zod/tRPC, NestJS, React Native + Reanimated 3 worklets + react-native-svg, vitest.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.5 (c1, c2, c3, x1).

## Rules (named constants in `motion.ts`)

| Constant | Value | Why |
|---|---|---|
| `SNAP_M` | 30 | A fix within 30 m of the road path is on it (GPS error in alleys). |
| `BACKTRACK_HOLD_M` | 40 | A fix up to 40 m behind the drawn marker: hold still until he catches up (no backwards hop). |
| `DEAD_RECKON_MAX_S` | 12 | After a glide, keep moving at his speed for at most 12 s without a new fix. |
| `MIN_MOVING_MPS` | 1 | Slower than 1 m/s: no dead reckoning (waiting at a light, at the counter). |
| `MAX_SPEED_MPS` | 17 | Dead-reckoning speed cap (≈ 60 km/h in town). |
| `HEADING_LOOKAHEAD_M` | 12 | Heading from the point 12 m ahead on the path: smooth turns at corners. |
| `REROUTE_OFF_M` | 50 | The courier strays this far from the path → ask the server for a new route. |
| `ROUTE_STALE_MS` | 120 000 | Refresh the route at least every 2 minutes. |

## Tasks

1. **`decodePolyline(encoded, precision = 6): LatLng[]`** in `packages/map/src/polyline.ts` (+ test with the reference example from the polyline spec at precision 5 and a precision-6 round trip via a small encoder in the test).
2. **Contracts**: `OrderRoute = { polyline6: string | null, basis: EtaBasis, from: LatLng, computedAt: Date }`; `orders.route` (same access as `orders.track`); `TrackingPort.route`.
3. **API**: `EtaService.path(points)` → `RouteResult`; `TrackingService.route(actor, { orderId })` — owner check; points: courier fix (sharing window) else kitchen (food, not picked up); then this order's remaining stops (ride: pickup until picked up, then drop-off; food: kitchen until picked up, then the door). Null polyline when fewer than two points. Tests with a scripted router.
4. **Customer `motion.ts`** (+ tests in Node): `buildPath(points)` → `{ pts, cum, length }`; `pointAt(path, d)`; `headingAt(path, d)`; `project(path, p)` → `{ d, offM }`; `remainingFrom(path, d)`; `planGlide(path | null, current, fix, speedMps)` → `Glide` with `kind: 'path' | 'line'`, from/to distances or points, headings and a dead-reckoning tail in metres; `glidePos(glide, t)` worklet (t in 0..1 over the poll interval, past 1 = tail).
5. **TrackMap**: `useOrderRoute(orderId)` (refetch on stray / next stop change / 2 min); path in a shared value; glides from `planGlide`; progress animates to `1 + tail` over `POLL + tail time`, stopped when the fix is stale.
6. **RouteLine**: road polyline from the marker's distance to the end (solid line with casing); straight dashed line only without a road polyline.
7. **CourierMarker**: top-down vehicle SVGs (motorbike, tuktuk, car/SUV/van) in brand colours with a soft shadow, rotated to the heading; minutes pill above it from the server ETA ("8 دقيقة"); grey and still when the signal is lost; still under reduce-motion.
8. **Verify**: typecheck/lint/tests; studio web with `OSRM_URL` pointed at the public OSRM demo (light use, demo data only) to see road-following; screenshots at phone size in light and dark; commit; push; CI.
