# Milestone 2 — Platform Core implementation plan

Date: 2026-10-02 · Status: draft for Ali's approval

Companion to `docs/specs/2026-10-02-domain-and-events.md`, `docs/specs/2026-10-02-dispatch-and-pricing-detail.md`, `docs/specs/2026-10-02-money-and-ops.md` and `docs/architecture.md`. Milestone 1 (commit `f78ad08`) delivered the monorepo, in-memory modules, pricing engine, ledger with repository interface, dispatch policies and a tiny simulator. Milestone 2 makes it real: Postgres + Redis, the full domain model, the full state machines, a working outbox, and a Console you can watch.

## 0. What exists today

| Area | State in M1 | What M2 changes |
|---|---|---|
| `packages/db/prisma/schema.prisma` | 19 models from the old platform-core spec (no Order, Participant, Departure, Subscription, Parcel, Promotion, Incident, MeetingPoint, Taxonomy; old 10-state trip machine; PII on `people`) | Rewritten to the domain-and-events spec; vault schema; first migration |
| `apps/api/src/modules/*` | 15 modules, in-memory except `ledger` (repository interface + unused Prisma repo) | Every module gets a Prisma repository behind its service |
| `apps/api/src/modules/events` | In-memory log + synchronous drain | Durable `events`/`outbox` tables, BullMQ publisher, subscriber registry, idempotency |
| `apps/api/src/modules/trips` | Old machine, no stop logic | New 8-state machine, per-stop states, geofence, unreachable timers |
| `apps/api/src/modules/dispatch` | Pure `plan()` | Redis GEO index, offer lifecycle with timers, four policies with spec timing |
| `apps/api/src/modules/simulator` | 25 taxi trips, no geography | Thousands of orders on the 34 seed zones with a simulated clock and invariants |
| `apps/console` | One page | Login, map, dispatch board, orders, driver ledger, pricing simulator, system |
| `packages/contracts/src/router.ts` | 3 procedures, no auth | Per-domain routers, `protectedProcedure` with roles, ~40 procedures |
| CI | No database | Postgres+PostGIS and Redis services, migrations, integration tests, simulator gate |

Binding rules (from `docs/architecture.md`): only `index.ts` is public; no module reads another module's tables; every state change writes its domain event to `outbox` in the same transaction; nothing publishes inline.

### 0.1 Unit of work
- `apps/api/src/shared/db/prisma.service.ts` — `PrismaService` wrapping `createPrisma(DATABASE_URL)`.
- `apps/api/src/shared/db/unit-of-work.ts` — `UnitOfWork.run<T>(fn: (tx: Tx) => Promise<T>)`; nested runs reuse the outer `tx` (AsyncLocalStorage).
- `apps/api/src/shared/clock.ts` — `Clock` with `SystemClock` and `FakeClock`.
- `apps/api/src/shared/queue.ts` — `QueueFactory` for BullMQ + `InMemoryQueue` for tests.
Every mutating service method: `return this.uow.run(async (tx) => { await this.repo.write(tx, …); await this.events.emit(tx, event, aggregate); })`.

### 0.2 Local infrastructure
- `docker-compose.yml`: `postgis/postgis:16-3.4` on 5432 (`POSTGRES_DB=driver`), `redis:7-alpine` on 6379.
- `.env.example`: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SMS_PROVIDER=fake`, `PORT`, `NEXT_PUBLIC_API_URL`.
- Root scripts: `db:up`, `db:migrate`, `db:reset`, `db:seed`, `sim`, `dev:api`, `dev:console`.
- Remove the `/bin/true` Prisma engine stub once Postgres exists.
Acceptance: `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev:api`; `health.ping` shows `db: ok, redis: ok`. Effort 1.5 days.

## Step 1 — Prisma schema: full domain model + migrations
Files: rewrite `packages/db/prisma/schema.prisma`; migration `20261002000000_m2_domain` (hand-edited: `CREATE EXTENSION postgis`, `vault` schema, GIST indexes, append-only trigger on `ledger_events`); `packages/db/prisma/seed.ts` (cities, 34 Aziziyah zones with draft centroid polygons, meeting points, taxonomy roots, demo restaurant with 10 items, dispatcher person); `packages/db/src/schema.test.ts` extended; `apps/api/src/modules/config/cities/aziziyah.ts` replaced with the 34 seed zones, tiers, tier-pair fares, `creditCapsIqd {bronze 75000, silver 150000, gold 300000}`, dispatch timing; `packages/contracts/src/city-config.ts` updated.

Schema: Identity (pseudonymous `Person` with no phone/name; `Role.kind` + shopper, intercity_driver, khat_driver; `Org.type` + household; `OrgMember.role payer|orderer|member`, `spendingLimitIqd`; `Device`, `Session`, `OtpChallenge`, `GuardianLink` targeting a Person or a Participant). Vault (Postgres schema `vault`, Prisma multiSchema): `PersonIdentity {personId, phoneE164, phoneHash, name, document refs, selfie refs}`, `VaultAccessLog`; only `modules/identity` may touch `vault.*` (lint rule). Places: `Place` + `localNames`, `flaggedAt`, `arrivalSamples`; `MeetingPoint`; `Zone.tier`, `extId`. Catalog: `CatalogItem` + taxonomy, photo, stock, availability, branch overrides; `TaxonomyNode`; real `ModifierGroup`/`Modifier` tables. Orders: `OrderType`, `OrderState` enums per spec; `Order`, `OrderLine`, `Participant` (phone in vault by hash), `TripOrder` with history, `Parcel`. Trips: `TripState`, `StopState` per spec; `Trip` + `departureId`, unreachable timestamps; `Stop` + state, meeting point, geofence fields, handover proof; `TrailPoint` monthly-partitioned raw stream. Routes: `Route.state`; `Departure`; `Seat` on departure (position + parcel, state, prepaid, walkUp, heldUntil); `Subscription`. Promotions: `Promotion`, `PromoRedemption` unique per order. `Incident`. Ledger: full type list + `kind money|points`; `points:` and `points_pool` accounts. Events/outbox: `Event.flagged`, `Outbox` idempotency/backoff fields, `SubscriberDelivery`; `DispatchOffer`.

Tests first: schema conformance (exact enum sets, no PII on people, vault schema, Int IQD); migration integration test (deploy on empty DB, postgis, append-only trigger); pricing tier-pair cases (centre→far 1,500; edge 2,000).
Acceptance: `pnpm db:reset && pnpm db:migrate && pnpm db:seed`; Prisma Studio shows the new tables and 34 zones with Arabic names. Effort 4 days.

## Step 2 — Identity module
Files: `identity.service.ts` façade; `otp.service.ts`; `session.service.ts` (JWT via jose, 15-min access, 30-day rotating refresh); `sms/provider.ts` + `fake.provider.ts` + `gateway.provider.ts` stub; `guardian.service.ts`; `identity.repository.ts` (only vault accessor); `phone.ts` (normalize + peppered hash). Orgs: households, spending limits, payer approval request. Contracts: `routers/identity.ts`, `auth.ts`, `protectedProcedure(roles?)`; context parses Bearer token. Dev-only `identity.devLastOtp`.

Interface: `requestOtp`, `verifyOtp` (find-or-create per phone hash in one transaction), `refresh`, `logout`, `verifyAccessToken`, `grantRole`/`revokeRole`/`hasRole`, `linkGuardian` (pending until ward OTP), `consentGuardianLink`, `revokeGuardianLink`, `profile` (vault access logged). 6-digit code, 5 attempts, 3-min expiry, 30-s resend. All mutations emit identity events.
Tests first: phone format variants → one person; lockout; expiry; refresh rotation; idempotent grants; guardian consent flow; integration: no PII on people, vault row, access log; smoke over the wire incl. UNAUTHORIZED with Arabic message.
Acceptance: Console login with fake OTP printed in the API terminal; same phone from two browsers = one person; guardian link shows "بانتظار الموافقة" until the second code is entered. Effort 5 days.

## Step 3 — Events module: durable outbox, publisher, subscribers
Files: `events.service.ts` (transactional emit), `events.repository.ts`, `outbox.publisher.ts` (BullMQ worker, 500 ms tick + poke, SELECT … FOR UPDATE SKIP LOCKED, exponential backoff, failed after 10), `subscriber.registry.ts` (named idempotent handlers, per-subscriber delivery dedupe), `timestamps.ts` (skew policy; flagged if device time > server + 60 s or < server − 7 d). Contradiction detector subscriber emits `dispute.opened`, never rewrites.
Tests first: idempotency; flagged skew; publisher retry/backoff; dedupe; concurrent drain never double-delivers; transaction rollback leaves no outbox row.
Acceptance: Console system panel shows outbox pending/published; stopping Redis makes pending climb, restarting drains it, nothing lost. Effort 4 days.

## Step 4 — Trips and orders modules
Files: trips rewrite (`trip.machine.ts` pure transitions + derivation from stops, `stops.ts`, `geofence.ts` 60 m, `unreachable.ts`, timers via BullMQ delayed jobs); new `modules/orders` (`order.machine.ts`, timers `merchant.autoReject@90s`, `order.autoClose@2h`, `participants.ts`); contracts for trip/order/participant; pricing gains `cancellationFee()`.
Interface: `OrdersService.place/merchantAccept/merchantReject/markPreparing/markReady/cancel/openDispute/onTripEvent/get/listActive/listForPerson`; `TripsService.createForOrders/attachOrder/detachOrder/offer/accept/decline/timeout/reportPosition/arrive/completeStop/skipStop/startUnreachable/fail/cancel/get/active/forDriver`. Trip state derived from stops for multi-stop trips.
Tests first: full transition tables; 90-s auto-reject; auto-accept flag; cancel fee after preparing; 2-h auto-close; participant tagging and pending points; geofence arms at 50 m not 70 m; arrive outside geofence flagged not blocked; unreachable fail allowed only at 5 min, dispatcher at 3; idempotent replay; attach/detach history; end-to-end integration.
Acceptance: Orders page test order turns `merchant_rejected` after 90 s; map page slider arms "وصلت" at 60 m; "خارج النطاق" flag; unreachable countdown with dispatcher card at 3:00 and "فشل" enabled at 5:00. Effort 8 days.

## Step 5 — Dispatch on Redis with the four policies and spec timing
Files: `geo-index.ts` (GEOADD/GEOSEARCH, driver hash, 90-s TTL), `presence.service.ts`, `offer.orchestrator.ts` (wave timers on BullMQ), `batching.ts`, `dispatch.repository.ts` (`DispatchOffer`), config fields (`rebroadcastAfterSec 60`, `rebroadcastCompensationIqd 500`, `customerFreeCancelAfterSec 180`, `passes 3`, `arriveBeforeReadyMin 2`, batch limits, `minSeatsByTMinus30 3`, substitute waves 2×3×5 min, rank weights 40/30/20/10); Aziziyah waves `[3/1.5 km/15 s, 5/3 km/15 s, all/30 s]`.
Interface: `PresenceService.online/heartbeat/offline/nearby`; `DispatchService.request/respond (SETNX first-accept)/override/setPolicy (Redis runtime override)/board`. Over-cap drivers excluded after current job. Auto-assign on `order.merchant_accepted`, timed to `readyAt − 2 min`, 20-s accept, 3 passes then dispatcher card. Scheduled low-fill at T−30. Pre-assigned substitute auctions. ETA = haversine × 1.4 at 25 km/h until OSRM.
Tests first: ranker weights; geo radius and TTL; wave timing, single winner, rebroadcast at 60 s, free cancel at 180 s; the four batching rules; suggest-only emits nothing to drivers; policy override persists.
Acceptance: dispatch board shows wave cards with countdowns, red "+500 تعويض" at 60 s, suggest-only switch yields "بانتظار قرار الموزّع". Effort 7 days.

## Step 6 — Ledger: full event types, caps, nightly job
Files: contracts type list + kind + account regex; `postings.ts` (pure balanced posting groups: order closed, ride completed, cancellation, seat, errand, late meter, points); `caps.ts`; `nightly.job.ts` (02:00 Asia/Baghdad); `ledger.subscribers.ts`; Prisma repo bound when `DATABASE_URL` set.
Interface: `record(tx)`, `recordAll(tx)` (batch must sum to zero), `balance`, `statement`, `isOverCap(driverId, tier)`, `checkInvariant` (money and points separately), `runNightly` (report, per-driver owed/cap, incident on failure).
Tests first: worked example 15,000 → 2,750/1,000/12,750; tuktuk 10 % min 100; front seat 25 %; late meter 100 %; points 75 to diner, +10 % organiser, pending for phone-only; property test random orders balance; kind mismatch throws; unbalanced batch writes nothing; nightly opens incident on injected imbalance; DB rejects UPDATE on ledger rows.
Acceptance: driver ledger page with Arabic line labels, cash-held bar vs 75,000 cap turning red and the board stops offering; "تشغيل الإقفال الليلي" shows "الدفتر متوازن ✓". Effort 4 days.

## Step 7 — Aziziyah simulator
Files: `world.ts` (deterministic actors on the 34 zones), `actors/customer|driver|merchant.ts`, `scenario.ts` (70 % food, 25 % rides, 5 % cancellations), `invariants.ts`, `cli.ts` (`pnpm sim --orders 2000 --drivers 40 --seed 1 --speed 600`), dev-only `sim.start/stop/status` procedures.
Invariants: money Σ=0, points Σ=0; all orders/trips terminal; no stop completed before arrived; outbox drained; idempotent replay adds nothing; no fee > fare; totals multiples of 250; no over-cap offers; no batched hot wait > 10 min; no points on money accounts; one balanced posting group per closed order.
Tests first: world determinism and zone resolution; 200-order in-memory run with zero violations; 2,000-order integration run under 5 min in CI.
Acceptance: `pnpm sim --orders 2000 --seed 7` prints the result table and exits 0; a deliberate rule break yields a named violation and exit 1; the Console map shows markers gliding. Effort 5 days.

## Step 8 — Console pages
Files: `packages/map` (MapLibre `style.json` with PMTiles placeholder and raster fallback, Aziziyah bounds, zone GeoJSON loader); console `login`, `map` (driver markers by state, trip lines, tier-shaded zones, trip drawer), `dispatch` (columns searching/offered/assigned/needs dispatcher, policy switches, override), `orders` + detail timeline, `drivers/[id]/ledger`, `pricing` (interactive quote with shown + shadow components and cancellation preview), `system` (health, outbox, nightly job, simulator controls); RTL navigation with i18n strings; `routers/console.ts` protected by roles; 2-s polling hooks for now.
Tests first: zod round-trips; Playwright smoke (login, map canvas + marker, dispatch card within 10 s, order timeline order, ledger sums, pricing toggle).
Acceptance: RTL sidebar الخريطة/التوزيع/الطلبات/السواق/التسعير/النظام; tier-shaded zones with moving simulated drivers; live policy switches; pricing page centre→الخماس shows 1,500 with grey "مخفي" shadow rows. Effort 8 days.

## Step 9 — CI
Files: `ci.yml` with Postgres+PostGIS and Redis services, migrate deploy, lint, typecheck, unit + integration tests, builds, smoke, `pnpm sim --orders 2000 --seed 1 --ci` gate, `simulation-report.json` artifact; vitest `unit`/`integration` projects; turbo env passthrough.
Acceptance: one green job in the PR Checks tab with a downloadable report showing `violations: 0`; a deliberate ledger break fails at "simulate" with the violation name. Effort 2 days.

## Sequencing
```
0 infra ─┬─ 1 schema ─┬─ 2 identity ──────────────┐
         │            ├─ 3 events ─┬─ 4 trips+orders ─┬─ 5 dispatch ─┬─ 7 simulator ─ 9 CI
         │            │            └─ 6 ledger ───────┘              │
         └────────────┴────────────────────────────── 8 console (pages land as routers land)
```
Steps 2, 3, 6 parallel after 1. Total ≈ 48 developer-days.

## Decisions to confirm with Ali
1. Seed zone geometry is AI-drafted centroids until drivers verify in Partner; prices are only as right as the polygons.
2. Vault as a Postgres schema for M2; separate database + KMS later.
3. Console live updates by 2-s polling in M2; Supabase Realtime vs Ably deferred.
4. ETAs by haversine × 1.4 until OSRM is hosted.
5. Prisma multiSchema + postgresqlExtensions preview flags verified against Prisma 7.10 before Step 1.
6. The 8-component scoring index is Milestone 3; M2 keeps event counting.
