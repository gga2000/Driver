# One ETA That Learns (maps program f7, SP4b learned correction) — Implementation Plan

**Goal:** every leg the one ETA quotes is the router's estimate × a correction learned from finished legs, per zone pair, Baghdad-time bucket, vehicle and routing basis (EWMA of actual ÷ predicted, applied clamped to 0.7–1.6). OSRM is not deployed, so the router is the straight-line estimate today; the learned factor is what makes ETAs honest in Aziziyah's streets.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.4 "One ETA (f7)".

## Architecture

- **Port in routing** (`modules/routing/eta-correction.port.ts`): `EtaCorrection.factor({ from, to, vehicle, basis })`, token `ETA_CORRECTION`, `NO_ETA_CORRECTION` (always 1). `EtaService` takes it `@Optional()`, so routing — imported by nearly every module — still imports nothing, and every `new EtaService(router)` in tests keeps the router's minutes.
- **`EtaService`**: `minutes` and `fromMany` multiply the unrounded router minutes by the factor, then round (≥ 1). New `baseMinutes` = the router's own minutes (whole and exact) with no correction. `path` (route lines) is unchanged. The basis label stays the router's: a corrected straight line is still `estimated`.
- **New module `eta`** (`modules/eta/`, `@Global()`, exports only `ETA_CORRECTION`; imports Config, Events, Trips, Routing; nothing imports it but `AppModule`):
  - `eta-learning.ts` — pure maths: `hourBucketOf`, `nextEwma`, `clampFactor`, `judgeLeg` (min length + outlier guard), `lookupChain`, `pickFactor`.
  - `eta-corrections.repository.ts` — `EtaCorrectionsRepository` (`learn`, `cells`); in-memory twin; Prisma version does the EWMA in one `INSERT … ON CONFLICT DO UPDATE` per cell so concurrent legs both count, after an `eta_samples` insert with `skipDuplicates` (unique stop).
  - `learned-eta-correction.ts` — `LearnedEtaCorrection` (the bound `ETA_CORRECTION`): pins → zones with the places module's `ZoneResolver` over `ConfigService.cityIds()`; reads a city's cells once per `cacheMs`; a store read failure is logged and the leg quoted uncorrected.
  - `eta-learner.ts` — `EtaLearner`, subscriber `eta:learn-legs` on `stop.arrived`, writing through the delivery's `tx`.
- **Promise on the learned minutes, locked at placement (Ali, 2026-10-07: "yes learned data"):** at first the honest-delay promise stayed on `baseMinutes` because `TrackingService.promise()` recomputes it on every read. Ali reversed that on 2026-10-07: `OrdersService.place` now locks the kitchen → door ride from `EtaService.minutes` (learned, clamped 0.7–1.6, factor 1 when nothing is learned; a scheduled order at its slot's bucket via the optional `at` on `minutes` / `EtaLegQuery`) into `orders.promised_ride_min`, and `promise()` adds those stored minutes to `promisedReadyAt` — so the promise agrees with the ETA the customer sees and never moves after placement. Orders placed before the column, or whose ETA could not be read at placement, keep `baseMinutes`. Amounts, the 10/20-minute steps and once-per-delivery are unchanged (`docs/api/late-promise.md`). The live ETA, at-risk list, apology's new time, share page, merchant radar/board, storefront minutes and nearby-vehicle minutes use the corrected `minutes` / `fromMany`.

## Which legs teach (and why)

| Leg | Start (where, when) | End | Why this start |
|---|---|---|---|
| Between stops (picked up → door; stop → next stop) | the previous completed stop's **target pin**, at its **completion** (server time) | this stop's arrival (server time) | Both times are server receipts on the same clock; the start pin is the kitchen/door the ETA itself routes from; kitchen waits and hand-over fall outside the leg. |
| First leg (accepted → first stop) | his **first trail point on the trip**, at the **acceptance** (server time) — only if that fix came within `firstFixMaxDelayMs` of the acceptance | first stop's arrival | Trail points are recorded on a trip only once he holds it, so the first one is where he accepted; a late first fix is somewhere else, and the leg is skipped. |

Skipped (outcome in brackets, tests cover each): quarantined late replays (`quarantined`); الرجعة and خطوط (`not_learnable_vertical`, `ETA_LEARNING_VERTICALS`); taps outside the 60 m geofence (`outside_geofence`); an arrival or starting completion whose device time is more than `maxTapDelayMs` from its receipt — queued offline (`late_tap`); a leg that passed through another stop's arrival (`not_direct`); no `trip.accepted` for the courier (`no_vehicle`); an end outside the zones (`outside_zones`); too short (`too_short`); outliers (`outlier`). Vehicle = the `vehicleClass` on his `trip.accepted` event (the courier registry lives in tracking, which imports routing).

Idempotent: the outbox's per-subscriber dedupe plus `eta_samples.stop_id` unique — a redelivered arrival returns `duplicate` and changes nothing.

## Constants (`ETA_LEARNING_RULES`, `packages/contracts/src/tracking.ts`)

| Rule | Value | Why |
|---|---|---|
| `alpha` | 0.2 | ≈ last 10 legs carry the estimate (0.8¹⁰ ≈ 0.11): follows a new checkpoint within a day, one detour can't swing it. |
| `minFactor` / `maxFactor` | 0.7 / 1.6 | Spec §5.4. Stored factors are kept as learned; the clamp applies when used. |
| `hourBuckets` | 0, 6, 11, 14, 17, 21 (Baghdad) | Six traffic regimes, not 24 hours: empty night, work + school run, lunch + school out, afternoon lull, market + dinner peak, late dinner. A 24-way split of every zone pair would never fill in a town of a few hundred legs a day. |
| `minSamples` | 5 | A younger cell defers to the next level; one bad day is at most a fifth of the start. |
| `minRatio` / `maxRatio` | 0.3 / 4 | Outside is not traffic: GPS gap, forgotten tap, lunch stop, a straight line across the river. |
| `minPredictedMin` | 2 | Shorter legs' ratio is decided by tap timing. |
| `firstFixMaxDelayMs` | 120 000 | First fix later than this after acceptance isn't where he accepted. |
| `maxTapDelayMs` | 60 000 | A tap queued offline is timed by the network, not the street. |
| `cacheMs` | 60 000 | Every live position asks for a factor; one read per city per minute per instance. Learning on an instance clears its cache at once. |

**Fallback chain** (first cell with ≥ `minSamples`): zone pair in this bucket → zone pair all day (`hour_bucket = -1`) → the city in this bucket (`from_zone = to_zone = '*'`) → the city all day → 1.0. The brief named three levels; the city-in-this-bucket level is added because rush hour is city-wide and fills long before any one pair. Every leg updates all four cells.

**Basis in the key:** a factor learned against the straight-line estimate would wrongly correct OSRM road times (bridges are already in them), so `road` and `estimated` legs learn and apply separately; when OSRM comes up its cells start at 1.0 and learn on their own.

## Data

Migration `20261007105000_eta_corrections` (ends with `driver_harden`):

- `eta_corrections`: id, city_id, from_zone, to_zone, hour_bucket, vehicle_class, basis, factor (unclamped EWMA), samples, last_sample_at, created_at, updated_at; unique (city_id, from_zone, to_zone, hour_bucket, vehicle_class, basis).
- `eta_samples`: one row per learned leg — stop_id (unique), trip_id, city_id, zones, hour_bucket, vehicle_class, basis, predicted_min, actual_min, started_at, arrived_at; index (city_id, arrived_at). Pseudonymous, no positions.

## Tasks

- [x] Contracts: `ETA_LEARNING_RULES`, `ETA_LEARNING_VERTICALS`.
- [x] Prisma models `EtaCorrection`, `EtaSample` + migration.
- [x] Routing: `EtaCorrection` port, `EtaService` applies it, `baseMinutes`.
- [x] Tracking: the promise uses `baseMinutes` (no behaviour change for the honest-delay credit).
- [x] 2026-10-07 (Ali: "yes learned data"): the promise's ride is the learned minutes, locked at placement (`orders.promised_ride_min`, migration `20261007180000_order_promised_ride`); tests in `modules/tracking/learned-promise.test.ts` (router minutes when nothing is learned, the clamp at both ends, agrees with the live ETA, a scheduled slot's bucket, locked against later learning and the hour turning, the late credit against the locked deadline) and the wiring test (orders gets the learned `EtaService`).
- [x] `eta` module: maths, repositories, `LearnedEtaCorrection`, `EtaLearner`, wiring, `AppModule`.
- [x] Tests (`modules/eta/eta.test.ts`): buckets, EWMA, clamp, outlier/too-short guard, fallback chain and `minSamples`, repository idempotency, a learned factor changes `minutes` / `fromMany` (basis unchanged) and nothing changes before `minSamples`, vehicle/basis/bucket separation, cache + `forget`, unreadable store → uncorrected, and the learner end to end on in-memory trips + events (both legs learned, redelivery `duplicate`, quarantined, no first fix, outside geofence, offline tap, outlier, intercity skipped, five slow rides grow the ETA).
- [x] Wiring test (`apps/api/src/eta-wiring.e2e.test.ts`): on `AppModule`, `EtaService` consults the learned correction and `eta:learn-legs` is subscribed (the port is optional, so a miswired app would otherwise quote uncorrected silently).
- [x] Docs: `docs/architecture.md` §5 "One ETA", `docs/persistence.md` tables row.

## Open questions

1. ~~**Store the promise?**~~ Decided by Ali on 2026-10-07 ("yes learned data"): the promise uses the learned ride minutes, locked into the order at placement (see Architecture).
2. **Batched couriers' first leg:** a courier handed a second trip while on his first goes on with the first job; that trip's first leg can look slow. The outlier guard catches the extreme cases; excluding them precisely needs dispatch's batching flag on the trip.
3. **Retention of `eta_samples`:** small and position-free; no purge yet.
4. **Console view** of the learned factors per zone pair (e.g. "streets here run 1.4× the estimate") is not built.
