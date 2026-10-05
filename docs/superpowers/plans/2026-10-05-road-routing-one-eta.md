# Road Routing and One ETA (SP4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every arrival time the customer, the restaurant and the share link see comes from one server-side ETA service that routes on real roads through OSRM when `OSRM_URL` is set and falls back to one shared straight-line estimate otherwise; the duplicated speed constants are gone; the OSRM server is ready to deploy on Fly.

**Architecture:** A new API module `routing` holds a `Router` port with three implementations — `StraightLineRouter` (contracts' `ROAD_FACTOR` × `TOWN_SPEED_KMH`), `OsrmRouter` (HTTP `route` / `table`, 1.5 s timeout) and `ResilientRouter` (10-minute cache on rounded coordinates, circuit breaker, straight-line fallback marked `estimated`) — and an `EtaService` that turns legs into minutes per vehicle. Tracking (promise + live courier ETA), the share link, the merchant board and storefront cards use it; the live channel's `position` event and `orders.courierPosition` carry `etaAt`, which the customer app prefers over its local estimate. Dispatch and the Console keep synchronous straight-line maths but read the same contract constants. OSRM: one MLD car instance built from the Geofabrik Iraq extract, private on Fly (`driver-osrm.internal`).

**Tech Stack:** NestJS, zod, fetch + `AbortSignal.timeout`, OSRM v26.10.0 (`ghcr.io/project-osrm/osrm-backend:v26.10.0-debian`), Fly.io, vitest.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.4 (f7, c2 server half, decision D3). Route polylines to clients and learned corrections are SP4b-2 (with SP5's motion engine, which needs them).

---

## Decisions made while planning

1. **One OSRM profile (car) for now**, scaled per vehicle (`ROUTE_VEHICLE_FACTOR`: bike 1.0, tuktuk 1.15, van 1.1, others 1.0 — drafts until trails calibrate them). Separate motorbike / tuktuk profiles cost a second and third server; later if trails show it matters.
2. **Straight-line fallback = the contracts formula** (×1.4, bike 25 / tuktuk 30 / car 35 km/h). The storefront's ×1.35 at 20 km/h and the Console's ×1.3 at 24/20/28 go away; storefront keeps its +5 min hand-over.
3. **Dispatch stays synchronous** (ranker, batching, auto-assign start) on the shared constants; road-time dispatch needs `table` calls inside the offer loop and is SP4b-2.
4. **Intercity door-detour maths is untouched**: it prices a detour (money rule).
5. The customer app shows the server's `etaAt` when it has one and its local estimate otherwise, so tracking keeps working with an old API or a missing fix.

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/tracking.ts` | `EtaBasis`, `ROUTE_VEHICLE_FACTOR`, `MIN_PER_EARLIER_DROP` (moved from the customer app), `etaAt`/`etaBasis` on `CourierPosition`. |
| `packages/contracts/src/live-io.ts` | `etaAt`/`etaBasis` on the `position` live event. |
| `apps/api/src/modules/routing/{routing.port.ts,straight-line.router.ts,osrm.router.ts,resilient.router.ts,eta.service.ts,routing.module.ts,index.ts}` (+ tests) | The routing port, three routers, ETA service, module. |
| `apps/api/src/modules/tracking/{tracking.service.ts,share-links.ts,tracking.module.ts}` | Promise and live ETA through `EtaService`; share link ETA. |
| `apps/api/src/modules/live/{live.positions.ts,live.module.ts}` | `position` events carry the courier's ETA for that order. |
| `apps/api/src/modules/merchant/{board.ts,merchant.service.ts}` | Courier minutes to the counter from `EtaService`. |
| `apps/api/src/modules/catalog/{storefront.ts,catalog.rpc.ts}` | Card ETAs from one `table` call per list; contract constants. |
| `apps/api/src/modules/dispatch/geo.ts` | `etaMin` on the contract constants. |
| `apps/console/src/lib/dispatch.ts` | Candidate minutes on the contract constants. |
| `apps/customer/src/features/track/{eta.ts,queries.ts}`, `apps/customer/app/order/[id].tsx` | Prefer the server's `etaAt`. |
| `deploy/fly/osrm.toml`, `deploy/fly/osrm/Dockerfile`, `docs/deploy/hosting.md`, `.env.example` | OSRM on Fly; `OSRM_URL`. |

## Tasks

1. **Contracts** — add the constants and fields above; `CourierPosition.etaAt: z.coerce.date().nullable().default(null)`, `etaBasis: EtaBasis.nullable().default(null)`; same two optional fields on the live `position` event. Tests: schema parses old payloads (no eta) and new ones.
2. **Routing port + straight line** — `Router.route(points: LatLng[], profile: 'car') → Promise<{ distanceM, durationS, polyline6: string | null, basis }>` and `table(sources, destinations) → Promise<{ durationsS: (number | null)[][], distancesM: (number | null)[][], basis }>`. `StraightLineRouter` sums haversine × `ROAD_FACTOR` per leg at `TOWN_SPEED_KMH.car` (basis `estimated`). Tests: 1 km straight → 1.4 km, 144 s at 35 km/h.
3. **OSRM router** — `GET {base}/route/v1/driving/{lng,lat;…}?overview=full&geometries=polyline6&steps=false` and `GET {base}/table/v1/driving/{coords}?sources=…&destinations=…&annotations=duration,distance`; `code !== 'Ok'` or HTTP ≠ 200 → `RoutingUnavailable`; timeout `OSRM_TIMEOUT_MS` (default 1500). Tests with a fake fetch: URL shape (lng,lat order), parsing, error and timeout mapping.
4. **Resilient router** — cache key: profile + coordinates rounded to 4 decimals (≈ 11 m); TTL 10 min; max 5,000 entries (oldest out). Breaker: 5 failures within 30 s open it for 60 s (straight line meanwhile). Every fallback is `estimated`. Tests: cache hit skips OSRM; failure → estimated; breaker opens and recovers with a fake clock.
5. **EtaService** — `minutes(from, to, vehicle)` → `{ minutes ≥ 1, basis }` = route duration × `ROUTE_VEHICLE_FACTOR[vehicle]`; `fromMany(sources, to, vehicle)` via `table`. Module factory: `OSRM_URL` → `ResilientRouter(OsrmRouter, StraightLineRouter)`, else `StraightLineRouter`. Tests with the straight-line router: equals `travelMinutes` within a minute.
6. **Tracking** — `promisedArrival(order, kitchen, acceptedAt, rideMin)` takes the road minutes; `courierPosition` returns `etaAt`/`etaBasis` computed from the courier's fix with the delivery/ride rules the customer app uses today (`liveEta`), legs through `EtaService`. Share link ETA through `EtaService`. Tests: tracking service tests with the straight-line router keep their expectations; a new test checks `etaAt` for picked-up and not-yet-picked-up orders.
7. **Live channel** — `PositionFanout` takes an `etaFor(orderId, pin, at)` callback (wired to `TrackingService` in `live.module.ts`) and adds `etaAt`/`etaBasis` to each order's `position` event; a failing ETA never blocks the event.
8. **Merchant board** — `CourierFacts.etaMinutes` computed in `merchant.service.ts` via `EtaService`; `courierView` uses it. Board tests updated.
9. **Storefront** — `rideMinutes` → contract formula + hand-over; `catalog.rpc` computes all kitchen→door rides of a list with one `EtaService.fromMany` call. Storefront tests updated to the shared constants.
10. **Dispatch and Console** — `dispatch/geo.ts` `etaMin` uses `ROAD_FACTOR` and `TOWN_SPEED_KMH.bike`; Console `etaMinutes`/`roadKm` use the contract constants. Tests updated.
11. **Customer** — `order/[id].tsx`: `eta = fix?.etaAt ?? liveEta(…)`; `queries.ts` patches `etaAt`/`etaBasis` from live events; `MIN_PER_EARLIER_DROP` from contracts.
12. **OSRM on Fly** — `deploy/fly/osrm/Dockerfile`: build stage `FROM ghcr.io/project-osrm/osrm-backend:v26.10.0-debian`, download `https://download.geofabrik.de/asia/iraq-latest.osm.pbf`, `osrm-extract -p /opt/car.lua`, `osrm-partition`, `osrm-customize`; runtime `osrm-routed --algorithm mld --ip :: --port 5000`. `deploy/fly/osrm.toml`: private (no `[http_service]`), `fra`, `shared-cpu-1x` 2 GB. `hosting.md`: one-time steps, `OSRM_URL=http://driver-osrm.internal:5000`, monthly rebuild. `.env.example`: `OSRM_URL`, `OSRM_TIMEOUT_MS`.
13. **Verify** — full typecheck/lint/test, e2e three-apps, studio check (tracking shows minutes), commit per task, push, CI green.

## Self-review

- Spec f7 (one ETA): every customer/merchant/share ETA via `EtaService` ✓; the remaining synchronous sites (dispatch, Console, customer fallback, ride estimate) read the same constants ✓. D3 (own OSRM): adapter + deploy kit ✓, runs without it ✓. c2 server half: `polyline6` returned by the router, delivered to clients in SP4b-2.
- Names: `Router`, `StraightLineRouter`, `OsrmRouter`, `ResilientRouter`, `EtaService.minutes/fromMany`, `ROUTE_VEHICLE_FACTOR`, `EtaBasis`, `etaAt`, `etaBasis`, `etaFor`.
