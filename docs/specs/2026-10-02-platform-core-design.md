# Driver (درايفر) — Platform Core Design Spec

Date: 2026-10-02 · Status: approved by Ali · Scope: sub-project 0 (Platform Core) and the interfaces the six verticals plug into.

## 1. Purpose

Driver is a hyperlocal delivery and mobility platform launching in Aziziyah (Wasit, Iraq), covering food delivery, grocery "shop for me", city taxi/tuktuk, intercity shared rides with seat selection, and خطوط (recurring subscription routes). Platform Core is the shared foundation: identity, organizations, places, trips, dispatch, pricing, ledger, routes, scoring, notifications, support, config, catalog, the web console, the simulator and the test harness.

## 2. Principles (binding on all code)

1. One identity per phone number; roles and organizations, never duplicate accounts.
2. Everything a courier or driver does is a Trip with ordered Stops; verticals are configuration.
3. Money is an append-only ledger of events; balances are computed, never edited.
4. Dispatch, pricing and scoring are policies selected by config per city and vertical.
5. Every price is a sum of named, explained components. Shadow (metered) components are always computed but hidden until enabled by config.
6. Multi-city from day one: zones, prices, hours, landmarks, thresholds are data, never code.
7. Clients are offline-first with an action queue; the server resolves conflicts by rule and never silently overwrites.
8. Every actor action is an Event with time and location; scorecards derive from events.
9. Safety data (trails, selfies, minors' locations) has strict access rules and a 30-day retention window unless an incident is open.
10. Nothing deploys without the test suite and the simulator passing; releases roll out in stages.
11. Arabic (Iraqi dialect) is the first language of every screen; RTL is the default layout.
12. Apps never talk to the database; the API is the only client of Postgres.

## 3. Clients

| Client | Audience | Stack |
|---|---|---|
| Driver | customers | Expo (React Native, New Architecture), Expo Router, Reanimated 3, Skia, Rive |
| Driver Partner | couriers, taxi/tuktuk drivers, intercity and خط drivers, fleet owners, field ops | same |
| Driver Merchant | restaurants and grocers (phone + tablet) | same |
| Driver Console | dispatch, support, finance, ops, analytics | Next.js |

All share `packages/ui` (design system), `packages/contracts` (tRPC types), `packages/i18n` (Arabic-first strings).

## 4. Backend

One NestJS modular monolith (`apps/api`), TypeScript, exposing tRPC. Modules: `identity`, `orgs`, `config`, `places`, `catalog`, `trips`, `dispatch`, `pricing`, `ledger`, `routes`, `scoring`, `notify`, `support`, `events`, `simulator`.

Rules:
- A module exposes a public service interface and emits domain events. No module imports another module's repository or reads its tables.
- Every state change writes its domain event to the `outbox` table in the same transaction; a BullMQ worker publishes outbox rows to subscribers.
- Infrastructure: Supabase Postgres + PostGIS (Frankfurt), Redis (positions, geo-index, BullMQ), Supabase Realtime or Ably for live updates, Cloudflare R2 or Supabase Storage for files, Mapbox tiles + self-hosted OSRM for routing, Firebase push, SMS gateway, WhatsApp Business API, Sentry, PostHog, OpenTelemetry, ClickHouse for analytics.

## 5. Domain model

| Object | Description | Key fields |
|---|---|---|
| Person | One per phone number | phone, name, locale, roles[], memberships[] |
| Role | Grant on a Person, optionally scoped to an Org | customer, courier, driver, merchant_staff, merchant_owner, fleet_owner, guardian, field_ops, dispatcher, support, finance, admin |
| Org | Restaurant, grocer, fleet | type, name, members, payout settings, city |
| Vehicle | Plate-level object | plate, class (bike, tuktuk, car, van, intercity), owner org, active driver |
| City / Zone | Config units | polygon, prices, hours, dispatch policy, rounding rule |
| Place | Saved or learned location | pin, name, photos[], note, confidence, owner, shares[], landmark flag |
| Catalog | Merchant menu | items, modifiers, availability, prep time, busy mode |
| Trip | Universal job | vertical, stops[], customer, courier, vehicle, state, quote, trail, events |
| Stop | Ordered leg endpoint | place, type (pickup, dropoff, wait), window, completed_at |
| Route | Recurring or scheduled line | stops[], schedule, driver, vehicle, seats[], type (khat, intercity) |
| Seat | Bookable position on a Route | position (front, back_left, back_middle, back_right), rider, price, status |
| Quote | Priced offer | components[], total, currency IQD, locked_at, accepted_at, shadow_components[] |
| LedgerEvent | Immutable money event | type, amount, from_account, to_account, trip, route, occurred_at, recorded_at |
| Event | Anything that happened | actor, type, occurred_at, recorded_at, location, payload |

Trip states: `draft → quoted → requested → assigned → en_route → arrived → in_progress → completed`, with `cancelled` and `disputed` reachable from any active state.

## 6. Dispatch

`dispatch` selects a policy by (city, vertical):
- `smart_broadcast`: waves of ranked nearby drivers (default 3 drivers / 15 s, then 5 / 15 s, then all / 30 s), first accept wins.
- `auto_assign`: machine assigns best driver; batching of up to 2 orders in one zone; dispatcher override.
- `scheduled`: departures planned in advance, seats filled, ops confirms car.
- `pre_assigned`: route driver fixed; absence triggers substitute auction among vetted drivers with identical stops.
All policies end in driver accept/decline with timeout. "Suggest only" mode routes every decision to the console.

## 7. Pricing

A Quote is a list of components: `base`, `distance`, `time`, `zone_adjust`, `front_seat`, `door_pickup`, `street_pickup`, `wait`, `night`, `weather`, `peak`, `pickup_compensation`, `promo`, `cancellation`. Each has value, Arabic label, driver-share rule, visibility (shown or shadow). Zone tables are the base; distance/time are computed on every quote and hidden until enabled per city/vertical/time window/driver. Quotes are locked at acceptance; re-quotes only on added stop or dropoff moved more than 1 km, as a new line. Rounding per city (default nearest 250 IQD), floors and ceilings per vertical, sanity check against the last 100 similar trips. Every quote is stored with acceptance outcome.

## 8. Ledger

Accounts: platform, each driver, each merchant, each customer wallet. Event types include `cash_collected`, `commission_accrued`, `merchant_payable`, `driver_settlement`, `merchant_payout`, `refund`, `credit_issued`, `cancellation_fee`, `promo_funded`, `seat_premium`, `subscription_charge`, `adjustment`. Balances are sums. Driver credit cap is a rule on the driver balance; over cap blocks new offers after the current job. A nightly job asserts the ledger sums to zero and alerts on failure. Offline events carry device timestamps; contradictions emit `dispute_opened` instead of overwriting.

## 9. Scoring

Events feed a per-driver scorecard: acceptance, decline, timeout rates; time to accept and arrive vs ETA; wait time; delivery delay; idle-online hours; cancellations after accept; complaints; disputes per 100 trips; cash discrepancies; route deviation; خط punctuality. Reliability index 0–100 explained by components. Days 1–30 observation (visible to admins only, driver told a learning period is running); from day 31 nudges precede consequences; tiers Bronze/Silver/Gold drive offer priority, cash cap and bonuses; score decays toward the recent two weeks. Suspensions and bans are human decisions with an evidence pack. Thresholds are config.

## 10. Safety

Driver ID and licence review at onboarding; daily selfie check-in with liveness; trip sharing; SOS to dispatcher with live location; route-deviation alerts; guardian live view for خطوط minors (explicit, revocable grant in the audit log); geofenced arrival confirmations; women-only ride option when female drivers exist; incident workflow with evidence. Minors' locations visible only to guardian, assigned driver during the run, and ops.

## 11. Offline

Partner and customer apps keep an action queue; actions carry device timestamps and idempotency keys. Server orders by timestamp, applies rules, and emits `dispute_opened` on contradiction.

## 12. Errors

Every API error returns a stable code, an Iraqi-Arabic user message, and a retry hint. Clients never display raw errors.

## 13. Testing and delivery

Unit tests for pricing, ledger, dispatch, scoring; integration tests per tRPC procedure; E2E on apps; the Aziziyah simulator (fake customers, drivers, restaurants on real geography) runs on every merge and nightly; staged rollout staff → 10% drivers → all with one-tap rollback; weekly human review of `ledger`, `identity`, and safety code.

## 14. Build order

Platform Core → Food → City taxi/tuktuk → Intercity + seats → خطوط → Grocery → Wallet. Core's visible deliverables are the Console with live map, the pricing simulator, and the trip simulator.
