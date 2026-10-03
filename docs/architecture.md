# Architecture notes

Companion to the [platform core spec](specs/2026-10-02-platform-core-design.md). Short on purpose: these are the rules every contributor must know before touching `apps/api`.

## 1. Module boundaries

`apps/api/src/modules/<name>/` is a module. Each has:

- `<name>.module.ts` — Nest wiring (providers, imports, exports).
- `<name>.service.ts` — the public service; the only thing other modules call.
- `index.ts` — the **public interface**. Anything not exported here is private.

Other modules import `../<name>/index.js` and nothing else. The rule is enforced by `eslint-plugin-boundaries` in `apps/api/eslint.config.js`:

```
No rule allows the entry point 'engine.ts' in dependencies of type 'module' with name 'pricing'
```

Modules also never import the composition root (`app.module.ts`, `bootstrap.ts`) or the transport layer (`src/trpc`). Tests inside a module may reach its internals.

Why: the spec says "no module imports another module's repository or reads its tables". Keeping a single entry point per module is how that stays true as the codebase grows, and it is what lets a module be extracted into its own service later without touching callers.

Cross-module data flows through the service interface or through domain events, never through shared repositories. The `ledger` module shows the pattern: `LedgerRepository` is an interface, `InMemoryLedgerRepository` and `PrismaLedgerRepository` are implementations, and nobody outside `ledger` knows which one is bound.

## 2. Event outbox

Every state change emits a domain event. The `events` module owns both the actor event log and the transactional outbox:

1. The mutating service writes its own rows **and** calls `events.emit(tx, event, { name, id })` with the `tx` of its `UnitOfWork.run`: one transaction writes the aggregate row, the `events` row and the `outbox` row together, and a rollback leaves none of them.
2. Nothing publishes inline. After the commit the `OutboxPublisher` is poked: with Redis a BullMQ worker on the `outbox` queue drains (500-ms tick, `SKIP LOCKED` claims, backoff 2^n s, `failed` after 10); without Redis the commit drains before `run` returns. Subscribers register by name (`events.subscribe(name, types, handler)`); each one's effect commits with its `subscriber_deliveries` record, so a redelivery skips it. Delivery is at-least-once; subscribers must be idempotent. Quarantined late replays reach only subscribers that opt in, never settlement.
3. A payload another module consumes has exactly one schema, in `packages/contracts/src/domain-events.ts` (`DOMAIN_EVENT_PAYLOADS`). The producer builds it as `DomainEventInput<type>` and its `emit` runs `encodeDomainEvent` (a drifted payload fails the producer's own transaction, never as a failed outbox row); consumers parse with `decodeDomainEvent`. `apps/api/src/domain-events.contract.test.ts` feeds what orders and trips really emit to the ledger and dispatch.
4. Offline actions carry device timestamps and idempotency keys. `emit` and `ledger.record` both short-circuit on a repeated key, so client retries never double-write. A contradiction between an offline action and server state emits `dispute_opened` rather than overwriting.

The `Outbox` model in `packages/db/prisma/schema.prisma` is the durable form of this queue. Never bypass it by calling a notification or analytics sink directly from a service.

## 3. Adding a city

Cities are data. To add one:

1. Create `apps/api/src/modules/config/cities/<cityId>.ts` exporting a `CityPricingConfig`:
   - `zones[]` with Arabic and English names;
   - one `VerticalPricing` per vertical you launch there, with its zone-pair fare table, `defaultFare`, component rules, `floor` and `ceiling`;
   - a `dispatch` policy per vertical (`smart_broadcast`, `auto_assign`, `scheduled`, `pre_assigned`) with waves and timeouts;
   - `roundingStep` (default 250), `timezone`, `driverCreditCapIqd`.
2. Register it in `ConfigService`'s constructor list. The schema is validated at boot, so a malformed config fails fast.
3. Add the city's zone polygons via `PlacesService.registerZones` (PostGIS `zones` table in Milestone 2).
4. Write a pricing test for one representative trip per vertical, like `apps/api/src/modules/pricing/engine.test.ts` does for Aziziyah.

No code in `pricing`, `dispatch` or `ledger` should need to change. If it does, the thing you are adding belongs in config, not in the module.

Metered pricing (distance and time) is always computed. To turn it on for a city, flip the component rule's `visibility` from `shadow` to `shown`; the `shadowTotal` field on every quote tells you in advance what customers would have paid.

## 4. What the server never takes from the client

Rules from the Milestone 2 review follow-ups; each has a regression test.

- **Fees are quoted, not sent.** `orders.place` quotes the order with `PricingService` (its vertical, the merchant's or the given pickup zone, the drop-off zone, door / street options, night and peak by time) and locks the result on the order. `deliveryFeeIqd`, `serviceFeeIqd` and a ride's `fareIqd` in `PlaceOrderInput` are only the cart's expectation: a mismatch is refused with `price_changed`. No zones, no price: `quote_location_required`. The new-customer cash cap (25,000) is checked against this server total.
- **Discounts only from a promotion.** `discountIqd` comes from `PromotionsPort.resolve(promoCode, …)` (`orders/promotions.port.ts`). The only binding today is `NoPromotions`, so every discount is 0 and a promo code or a non-zero discount is refused with `promotion_invalid` until the promotions module binds a real implementation to `ORDERS_PROMOTIONS`. A resolved promotion is stored on the order (`promotion_id`) and funded from its budget line in the ledger (`platformPromo`). Rides, errands and parcels take no promotion yet.
- **Tips** are the customer's choice, capped per order (`ORDERS_RULES.maxTipIqd`, default 10,000 → `tip_above_cap`), and posted 100 % to the courier or driver.
- **Accepting a job goes through dispatch.** The only public path is `dispatch.respond` (offer id + accept/decline). `trips.accept` / `trips.decline` are not on the router; `TripsService` accepts or declines only for a driver holding an open `DispatchOffer` (`DispatchOfferCheck`, bound into trips by the dispatch module; `offer_not_found` / `offer_not_yours`), and never for an over-cap driver (`over_cap`). Accepts run under a per-driver lock (`DispatchStore.withDriverLock`: Redis `SET NX PX` with a token, an in-memory mutex without Redis), so two accepts by one driver cannot both pass the one-job check.
- **Children's names live in the vault.** خطوط stops and `khat.child_tapped_*` events carry an opaque `childRef` (`vault.child_identities.id`). Names are read only through identity — the driver's run sheet (`trips.runSheet`, trip's own driver only) and the guardian's own view (`identity.myChildren`) — and every read is a `VaultAccessLog` row with `child_ref`.
- **OTP requests are rate-limited** per client IP (default 10/hour, `OTP_RATE_LIMIT_PER_IP_HOUR`) and per device fingerprint (default 5/hour, `OTP_RATE_LIMIT_PER_DEVICE_HOUR`), shared through Redis when `REDIS_URL` is set: `rate_limited` with `retryAfterSec`. The IP is Express's `req.ip`; behind a load balancer set `TRUST_PROXY` (hop count) so it is the client's, not the balancer's.
