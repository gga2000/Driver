# Architecture notes

Companion to the [platform core spec](specs/2026-10-02-platform-core-design.md). Short on purpose: these are the three rules every contributor must know before touching `apps/api`.

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

1. The mutating service writes its own rows **and** calls `events.emit(event, { aggregate, id })` in the same unit of work. In Milestone 1 that unit is a method call; with Prisma it becomes one `$transaction` that writes the aggregate row, the `events` row and the `outbox` row together.
2. Nothing publishes inline. A worker (BullMQ in Milestone 2) calls `events.drain()`, which delivers pending outbox rows to subscribers in order and marks them `published`. Delivery is at-least-once; subscribers must be idempotent.
3. Offline actions carry device timestamps and idempotency keys. `emit` and `ledger.record` both short-circuit on a repeated key, so client retries never double-write. A contradiction between an offline action and server state emits `dispute_opened` rather than overwriting.

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
