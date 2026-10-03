# Backend review — wave 2 (partner, merchant, driver-account, khat, fleet, ops, merchant-admin, promotions)

Date: 2026-10-04. Scope: `git diff a9b3cb6..HEAD -- apps/api packages/contracts packages/db` (HEAD e15df39).
Read against `docs/architecture.md`, `docs/specs/2026-10-03-edge-case-decisions.md`,
`docs/specs/2026-10-02-money-and-ops.md`, `docs/specs/2026-10-02-scoring-and-safety.md`,
`docs/api/partner-merchant-wave2.md`.

Each finding: severity, where, what, fix, proof test. Status `fixed` means a failing test was written
first, then the fix made it pass. `documented` means the fix is outside this pass (large, or in an area
other agents are changing) and is left as a follow-up.

Severity: **High** = money or another person's data reachable by a normal client; **Medium** = a
safety/state rule bypassable or a narrower leak; **Low** = hygiene with a real but small impact.

## Findings

| # | Sev | Area | Status |
|---|---|---|---|
| 1 | High | ops cash receipts: race, duplicate reference | fixed |
| 2 | High | fleet.addDriver: any phone → name, earnings, cash, documents | fixed |
| 3 | High | ledger.merchantBalance / requestSettlement open to merchant staff | fixed |
| 4 | Medium | khat tap-out without tap-in fires the guardian's "arrived" push | fixed |
| 5 | Medium | online gate: heartbeat grace never ends | fixed |
| 6 | Medium | merchantAdmin.staffInvite: phone → full name oracle | fixed |
| 7 | Medium | driverAccount.reviewDocument: reviewer approves own document | fixed |
| 8 | Medium | handover code brute-force (4 digits, no attempt limit) | fixed |
| 9 | Medium | double "اطلب فلوسك" opens two requests / two assignments | fixed |
| 10 | Low | merchantAdmin.insights: staff see sales money (bestSellers.salesIqd) | fixed (pass 2) |
| 11 | Medium (perf) | OrdersService.merchantOrders loads every order of the merchant | fixed (pass 2) |
| 12 | Low | menu import applied twice concurrently duplicates items | fixed |
| 13 | Medium | partner.currentOffer shows the customer's exact door to every offered driver | fixed |
| 14 | Low (tooling) | `turbo run typecheck` races `@driver/db` build against its typecheck | fixed |
| 15 | Medium (perf) | `events` has no index for `forAggregate` (Merchant cash screen) | fixed |
| 16 | Low | offer pay rounds differently from the ledger posting (batch bonus, ride take) | fixed |
| 17 | Medium | daily check-in: parallel selfies bypass the two-strikes lock-out | fixed |
| 18 | Medium | online gate: uploading any photo lifts an expired document | fixed |
| 19 | Low | merchant can contest a dispute after its 48 h window | fixed |
| 20 | Medium | self-declared vehicle class + no role check per vertical in dispatch | fixed (pass 2) |
| 21 | Low | `recordPayout` can pay a merchant more than its balance | fixed (pass 2) |
| 22 | Low | in-process locks (`KeyedLock`) are per instance | fixed (pass 2; check-ins unchanged, see below) |
| 23 | Low | `memberCards` returns names of deleted people | fixed (pass 2) |
| 24 | Medium | `orders.place` takes orders while the restaurant is closed by its opening hours (apps review #10) | fixed (pass 2) |
| 25 | Low | restaurant minimum order only enforced in the customer cart (apps review #11) | fixed (pass 2) |
| 26 | Medium | الرجعة car announced < 30 min ahead cancelled for low fill at once (apps review #12) | fixed (pass 2, product decision) |
| 27 | — | courier top-up limited to the courier carrying the customer's live order; cash on his cap | verified (pass 2, test added) |

## Details

### 1 · High · ops cash receipts race (money)

- **Where:** `apps/api/src/modules/ops/ops.service.ts` `recordCashReceipt`.
- **What:** the "not more than he holds" check and the idempotency check ran *before* the unit of work, and
  the settlement reference was `settlementReference('D', courier, day, countCashReceipts())`. Two receipts
  for one courier at once (two field staff, or a retry under a new key) both passed the check; with the
  same count they got the same reference, so the ledger silently skipped the second posting group
  (`recordAll` dedupes by group id) and the second receipt row failed on the unique reference (500). When the
  first committed between the second's check and its count, the second posted under a fresh reference and
  the courier's `cash:` account went **positive** — the platform recorded more cash handed in than he held.
- **Fix:** receipts for one courier are serialised: an in-process `KeyedLock` (`apps/api/src/shared/keyed-lock.ts`)
  plus `OpsRepository.lockCourierCash` (`pg_advisory_xact_lock(hashtext('ops.cash:<id>'))` inside the
  transaction, no-op in memory). The idempotency re-check, the held-cash check, the reference sequence and
  the posting all run under the lock.
- **Tests:** `ops.service.test.ts` › "two field staff taking cash from one courier at once both post, under
  distinct references"; "never takes more than the courier holds when two receipts race past the check".

### 8 · Medium · hand-over code guessing

- **Where:** `ops.service.ts` `recordCashReceipt` / `DriverAccountService.verifyHandoverCode`.
- **What:** the courier's confirmation is a 4-digit daily HMAC code with no attempt limit: 10,000 tries
  record a receipt the courier never confirmed (both-confirmations rule, decisions §3).
- **Fix:** 5 wrong codes for one courier in a local day lock his code until local midnight
  (`handover_code_locked`, new error code) and emit `ops.handover_code_locked` (ops alert). Counter is per
  process (documented in the method); a shared Redis counter is the follow-up if we run many instances.
  *Pass 2: the counter is shared (`WINDOW_COUNTER`, Redis with `REDIS_URL`) — see #22.*
- **Test:** `ops.service.test.ts` › "locks a courier's hand-over code for the local day after 5 wrong codes, even for the right one".

### 3 · High · merchant staff read the owner's cash account (authorization)

- **Where:** `packages/contracts/src/routers/ledger.ts` (`merchantBalance`, `requestSettlement`).
- **What:** both accepted `merchant_owner` **or `merchant_staff`** of the org. Wave 2 made merchant money
  owner-only (`merchantAdmin.money.*`, spec "roles gate money views", the Merchant app hides money from
  staff client-side), but staff could still read the live balance, which couriers hold how much, and fire
  "اطلب فلوسك" straight through `ledger.*`.
- **Fix:** the merchant side of `assertMerchantAccess` is `merchant_owner` only (back office unchanged).
- **Tests:** `packages/contracts/src/routers/ledger.test.ts` › "a merchant staff member cannot read the cash
  balance or ask for the money"; "the owner can, but only for his own store"; "back office still reads any merchant".

### 4 · Medium · خطوط tap-out without tap-in (state machine, child safety)

- **Where:** `apps/api/src/modules/khat/khat.service.ts` `tapOut`, and underneath it
  `apps/api/src/modules/trips/trips.service.ts` `completeStop` (also reachable directly via `trips.completeStop`).
- **What:** a dropoff stop completed with `childTap: 'out'` without the child's pickup ever being tapped in.
  `khat.child_tapped_out` (`notifyGuardian: true`) is the guardian's "arrived at school" push (decisions §5),
  so a driver could tell a parent the child arrived when he was never picked up.
- **Fix:** `completeStop` refuses a tap-out when the same run has a pickup stop for that child with no
  `childTapInAt` (`khat_child_not_tapped_in`, new error code). Lives in trips so both entry points are covered.
- **Test:** `khat.service.test.ts` › "never taps a child out at school who was not tapped in at home (review 2026-10-04 #4)".

### 5 · Medium · online gate bypass by heartbeating (scoring §2)

- **Where:** `apps/api/src/modules/partner/logic.ts` `gateAllowsHeartbeat`, `partner.service.ts` `goOnline`.
- **What:** a driver already in the presence index passed a closed gate whenever the only reason was
  `checkin_required`. Meant for a shift crossing midnight, it had no end: keep the app heartbeating and the
  daily selfie check-in is never asked again, for days.
- **Fix:** the grace holds only between local midnight and 04:00 (`MIDNIGHT_GRACE_UNTIL_HOUR`); after that a
  heartbeat without today's check-in is refused (`online_checkin_required`) and takes him out of the index.
  Lock-out and expired documents still end it at once.
- **Tests:** `partner.service.test.ts` › "heartbeating never skips the daily check-in past the night grace
  (review 2026-10-04 #5)" and the reworded "…keeps an online driver on for the night (until 04:00 local)";
  `logic.test.ts` gate table now pins the hour.

### 7 · Medium · document self-approval (authorization)

- **Where:** `apps/api/src/modules/driver-account/driver-account.service.ts` `reviewDocument`.
- **What:** reviewers are `field_ops` / `support` / `admin`; field ops commonly also hold a driving role. Nothing
  stopped a reviewer approving (and setting the expiry of) his own licence or ID — the document check that
  gates going online (scoring §2) was self-service for staff.
- **Fix:** reviewing a document of your own person is `forbidden`.
- **Test:** `driver-account.service.test.ts` › "a field-ops person who also drives cannot approve his own document".

### 9 · Medium · double "اطلب فلوسك" (money ops)

- **Where:** `apps/api/src/modules/ledger/merchant-cash.service.ts` `requestSettlement`.
- **What:** every press emitted a fresh `merchant.settlement_requested` (reference keyed on the millisecond),
  and the subscriber routed each one: a double tap, or owner + Console, sent two couriers or queued two
  ZainCash/ops payouts for the same balance. `recordPayout` does not check the balance, so the second payout
  would push the merchant account negative.
- **Fix:** while the last request is open (nothing settled since, inside its one-hour target) a new press
  returns that same plan (same reference/target, no event). Requests per merchant are serialised in process
  (`KeyedLock`); after the hour a press is a new request. Minimal and additive in a shared file.
- **Test:** `merchant-cash.test.ts` › "\"اطلب فلوسك\" pressed twice (or at once from two phones) is one request (review 2026-10-04 #9)".
- **Follow-up (documented):** `recordPayout` should refuse more than the merchant balance (or require an
  explicit negative-balance flag per the adopted "negative-balance payouts" rule); left to the ledger owners.

### 2 · High · fleet owner reads any person by phone (authorization, PII, money)

- **Where:** `apps/api/src/modules/fleet/fleet.service.ts` `addDriver`, `driverRows`, `driverEarnings`.
- **What:** `fleet.addDriver({phone})` linked whoever owns that number — no consent — and returned and
  listed him with his **full name** from the vault, masked phone, today's/week's earnings, cash held and
  owed, cap, document status and live state; `driverEarnings` then opened his whole book for any period
  (anchor anywhere in the past). Any fleet owner could look up any courier/driver (or any registered
  person) by typing a phone number.
- **Fix:** consent. `fleet_drivers.accepted_at` (migration `20261004120000_fleet_driver_consent`, existing
  links start pending); new driver-side procedures `fleet.myInvites` / `fleet.respondInvite` (driving roles).
  A pending row is the bare id (`pending: true`), with no vault read, ledger read, documents or presence;
  `driverEarnings` and `assignDriver` refuse it (`driver_not_in_fleet`). Accepted: earnings are clipped to
  the moment he joined (`DriverAccountService.earningsFor(…, {notBefore})`). Declining/leaving removes the
  link and frees his vehicle. Re-adding a removed driver is a fresh invite.
- **Tests:** `fleet.service.test.ts` › "adding a phone shows nothing of that person until he accepts the
  fleet's invite"; "an accepted driver's earnings start at the day he joined"; router gates in
  `packages/contracts/src/routers/wave2.test.ts`; Prisma round-trip in `apps/api/src/wave2.integration.test.ts`.
- **Client follow-up:** the Partner app needs an invites card (`fleet.myInvites` / `respondInvite`) and the
  fleet dashboard should render `pending` rows as "بانتظار موافقة السايق".

### 6 · Medium · staff invite as a phone → name lookup (PII)

- **Where:** `apps/api/src/modules/merchant-admin/merchant-admin.service.ts` `staffInvite` / `staffRows`.
- **What:** any merchant owner could type any phone number into "invite staff" and get back that person's
  **full vault name** at once (then remove him and try the next number). `pending` only covered people who
  had never signed in at all.
- **Fix:** a member is `pending` until he uses the app after being given the role (OTP sign-in or a session
  start/refresh after the grant), and a pending row carries `name: null`. Identity gained the narrow reads
  this needs: role rows carry `createdAt` (re-set on re-grant) surfaced as `orgRoleHolders().grantedAt`, and
  `IdentityService.lastActiveAtOf` (person + session rows, no vault fields). The role still works at once.
- **Test:** `merchant-admin.service.test.ts` › "inviting a phone does not reveal the person's name until he signs in after the invite".
- **Follow-up (documented):** an explicit accept step (like the fleet invite in #2) would be stronger; it
  needs a Merchant-app screen, so it is left as a product decision.

### 13 · Medium · offer card carries the customer's door pin (PII, location)

- **Where:** `apps/api/src/modules/partner/partner.service.ts` `currentOffer`.
- **What:** the offer sent to every driver in every wave (most decline) carried `dropoff.pin` = the exact
  drop target (the customer's home), and for rides `pickup.pin` = the rider's location. The spec's offer card
  names zones; the pins belong to the one driver who accepts.
- **Fix:** `dropoff.pin` is always null on an offer; `pickup.pin` only for a merchant pickup. Distances
  (`distanceToPickupKm`, `tripKm`) are still computed server-side; `activeJob` keeps the pins.
- **Test:** `partner.service.test.ts` › "an offer names zones, never the customer's exact door (review 2026-10-04 #13)".

### 14 · Low · `pnpm turbo run typecheck lint` flakes on `@driver/db`

- **Where:** `turbo.json`.
- **What:** `@driver/db#typecheck` ran in parallel with `@driver/db#build` (pulled in by every dependant's
  `^build`), whose `prisma generate` rewrites `src/generated/**` mid-`tsc` → `TS6053 File … not found`.
  Reproduced on two consecutive runs after a schema change.
- **Fix:** `"@driver/db#typecheck": { "dependsOn": ["build"] }`. Verified with `--force`.

### 15 · Medium (perf) · events by aggregate unindexed

- **Where:** `EventsService.forAggregate` (new in wave 2), called by `merchantAdmin.money.cash` on every open
  of the Merchant Money screen; `events` (the largest table) had no `(aggregate, aggregate_id)` index, so
  each call scanned it.
- **Fix:** `@@index([aggregate, aggregateId, occurredAt])`, migration `20261004120100_events_aggregate_index`.
- **Test:** `packages/db/src/schema.test.ts` › "events by aggregate: the Merchant app's cash screen reads merchant/<id> on every open".

### 16 · Low · offer pay ≠ ledger posting (money display)

- **Where:** `apps/api/src/modules/partner/logic.ts` `buildPay` / `rideTake`.
- **What:** the offer's batch bonus was `floor(fee × 0.7 / 50) × 50` and the ride take `floor(fare × rate)`,
  while the ledger posts `pct(fee, 0.7)` / `takeOf` (half rounds up). A 1,250 batched fee showed +850 on
  the offer and paid 875; a 1,750 one showed 1,200 and paid 1,225.
- **Fix:** `shareOf` mirrors the ledger's `pct`; `rideTake` mirrors `takeOf`.
- **Test:** `partner/logic.test.ts` › "the offer promises exactly what the ledger posts (review 2026-10-04 #16)".

### 17 · Medium · check-in lock-out bypass by parallel submissions (scoring §2)

- **Where:** `apps/api/src/modules/driver-account/driver-account.service.ts` `submitCheckIn`, `checkInStatusFor`.
- **What:** each submission checked "locked out?" before any of the others recorded its result, and a pass
  counted no matter when it came. Open N challenges, submit N selfies at once: all pass the check, and one
  passing makes him `verifiedToday` even after two failures — the two-strikes rule (and its ops alert) could
  be brute-forced.
- **Fix:** submissions per person are serialised (`KeyedLock`), and the status counts a pass only if it came
  before the second failure (submission order), which also covers several API instances.
- **Test:** `driver-account.service.test.ts` › "parallel submissions cannot beat the two-strikes lock-out (review 2026-10-04 #17)".

### 18 · Medium · expired-document gate lifted by any upload (scoring §2)

- **Where:** `driver-account.service.ts` `uploadDocument`, `documentsFor`, `onlineGateFor`.
- **What:** a new upload superseded the previous document of its kind at once, and the gate only looked at
  the latest per kind. A driver with an expired licence uploaded any photo (status `pending`, client-chosen
  `expiresAt`) and the gate opened — before anyone reviewed it.
- **Fix:** an upload supersedes only earlier pending/rejected documents; an approved one stays current until
  its renewal is approved (approval supersedes the older ones). The gate and `blocksOnline` look at every
  current document, so the expired approved licence keeps blocking until the renewal is approved. The
  document list still shows the latest per kind (the pending renewal).
- **Test:** `driver-account.service.test.ts` › "uploads to pending …, derives expiring / expired and blocks
  going online" (extended: the pending renewal keeps the gate closed; approval opens it).

### 12 · Low · menu import applied twice (state machine)

- **Where:** `apps/api/src/modules/catalog/catalog.service.ts` `applyImport`.
- **What:** the `draft` check and the final `applied` write were a read-then-write; two tablets applying the
  same import at once both created every item.
- **Fix:** `CatalogRepository.claimImportJob` — a conditional `draft → applied` update (`updateMany … where
  state = 'draft'`) before any item is created; the loser gets `import_state_conflict`.
- **Test:** `merchant-admin.service.test.ts` › "a menu import applied from two tablets at once creates its items once (review 2026-10-04 #12)".

### 19 · Low · late dispute answers (state machine)

- **Where:** `merchant-admin.service.ts` `moneyRespondDispute`.
- **What:** `respondBy` (opened + 48 h, "then the default outcome stands") was only displayed; a merchant
  could contest, or flip an accepted default to a contest, days later.
- **Fix:** answers after `respondBy` are refused with `dispute_response_closed` (new error code).
- **Test:** `merchant-admin.service.test.ts` › "disputes show evidence and the default outcome; the owner answers once (re-answer replaces)" (extended).

## Documented in pass 1, fixed in pass 2

Pass 2 (same day, backend agent): each fix below had a failing test first. Status in the table above.

### 10 · Low · staff see per-item sales in insights
`merchantAdmin.insights` is open to staff by design (API doc, and an existing test asserts staff read
`bestSellers[].salesIqd`). Under "roles gate money views" that figure arguably belongs to the owner. Changing
it changes the contract the Merchant app renders (`InsightsView` prints `salesIqd`), so it is a product call:
either null `salesIqd` for staff (contract `nullable`) or keep quantities only.
- **Fix (pass 2):** `MerchantInsights.bestSellers[].salesIqd` is `nullable` (contract); for `merchant_staff`
  it is null and the list is ranked by quantity (`staffInsights` in `merchant-admin/insights.ts`), so the
  order does not leak the money either. Prep honesty, rejections, item ratings, peaks and `orders` are the
  same for staff and owner. `InsightsView` hides the amount line when it is null (one guarded line).
- **Tests:** `merchant-admin.service.test.ts` › "prep honesty, rejection rate…" (staff now read `salesIqd: null`,
  the owner 10,000, everything else identical) and "staff get best sellers ranked by quantity with no money on them…".

### 11 · Medium (perf) · `OrdersService.merchantOrders` reads the merchant's whole history
`apps/api/src/modules/orders/orders.service.ts` `merchantOrders(merchantOrgId, range)` calls
`repo.findMany({merchantOrgId})` (every order the merchant ever had) and filters `placedAt` in memory, then
builds a full view per order (`this.view(id)`, N+1). It backs `money.today`, `money.statement`,
`money.disputes`, `insights` and the deal projection. Fix: push the range into the repository
(`placedAt: {gte, lt}`) and add `@@index([merchantOrgId, placedAt])` on `orders`. Left alone because the
orders module is being changed concurrently (deals at checkout).
- **Fix (pass 2):** `OrdersRepository.merchantOrdersBetween(merchantOrgId, from, to)` — one Prisma
  `findMany` on `merchantOrgId` + `placedAt ∈ [from, to)` with lines and participants included, ordered
  `(placedAt, id)`; `merchantOrders` maps it with `toOrderView` (no whole-history read, no N+1).
  `@@index([merchantOrgId, placedAt])`, migration `20261004130000_orders_merchant_placed_index`. Every
  caller already passes a bounded range (day, week + 1 day, 30 days, the deal-projection basis), and the
  compose functions stay in TypeScript over that slice: results are identical by construction (aggregating
  in SQL would duplicate the deal / commission rules the views apply per order, so it was not done).
- **Tests:** `orders/merchant-orders.test.ts` › "returns exactly what reading every order one by one
  returns (snapshot)" (snapshot written with the old implementation, unchanged after) and "never loads the
  merchant's whole history…" (no merchant-wide `findMany`, no per-order `find`); `orders.integration.test.ts`
  › "a merchant's orders by placed-at range…" on Postgres; `packages/db` schema test pins the index.

### 20 · Medium · vehicle class is self-declared and dispatch has no role ↔ vertical check
`partner.goOnline({vehicleClass})` puts whatever class the client sends into the presence index, and
dispatch picks candidates by presence vehicle (`vehicleFit`) without looking at roles. A `courier` (no car
documents required) going online as `car` is offered taxi passenger rides. The Partner app sends the
registered class, so this is an API-level hole, not a UI one. Fix belongs in dispatch candidate selection
(role per vertical: `driver` for taxi, `khat_driver` for khat, …) and/or capping the declared class at the
registered vehicle; both are business rules to agree first.
- **Fix (pass 2), both:** `partner.goOnline` uses the registered vehicle (`vehicles.active_driver_id` via the
  courier-card registry, else `FleetService.activeVehicleOf`; nothing registered = bike). A declared
  `vehicleClass` that differs is `vehicle_not_registered` (new code). Presence carries `verticals` =
  `servedVerticals(roles, vehicle)` (`dispatch/vehicles.ts`): `courier` → food/grocery/errand/parcel,
  `shopper` → grocery/errand, `driver` → taxi (car/SUV) or tuktuk (tuktuk), `khat_driver` → khat,
  `intercity_driver` → intercity, each filtered by `VEHICLE_FIT`; no verticals → refused the same way.
  `OfferOrchestrator.candidates` skips a driver whose list lacks the job's vertical (manual desk offers get
  the `vehicle_fit` warning). Presence written without `verticals` (internal callers: demo scripts) keeps
  vehicle fit only. Redis hash field `verticals` (`*` = unset). Simulator: drivers register as
  bike → courier, tuktuk/car → driver + courier, and go online with their `servedVerticals`.
- **Tests:** `partner.service.test.ts` › "goOnline uses the registered vehicle and the roles…" (4);
  `dispatch/role-fit.test.ts` (mapping, courier-in-a-car never offered taxi, taxi driver never offered food,
  tuktuk driver only tuktuk rides, presence keeps it); `geo-index.test.ts` round-trip on memory and Redis.

### 21 · Low · payouts are not bounded by the merchant balance
`MerchantCashService.recordPayout` posts any amount; with #9 fixed a double request no longer queues two
payouts, but nothing stops finance (or a future ZainCash matcher) from paying twice. The adopted
"negative-balance payouts" rule should decide whether this refuses or needs an explicit override flag.
- **Fix (pass 2):** `recordPayout` refuses more than the balance (`payout_exceeds_balance`, new code) and a
  non-positive amount (`settlement_nothing_due`); partial payouts are fine; a retry of a reference already
  posted returns the balance. Payouts, courier hand-overs (`confirmHandover`) and "اطلب فلوسك" run under one
  per-merchant lock (in process + `pg_advisory_xact_lock(hashtext('ledger.merchant_cash:<id>'))` in the
  transaction), so two at once cannot overpay; a hand-over mismatch's incident is opened after the lock's
  transaction (refusing never rolls it back). The balance after a payout/hand-over is computed from the
  balance read under the lock (ledger reads are not transaction-scoped). No override flag was added.
- **Tests:** `merchant-cash.test.ts` › "payouts never exceed what the merchant is owed" (3: refuse/partial/
  settle, two payouts at once, two hand-overs of the same cash at once) and "…take the advisory lock…".

### 22 · Low · per-instance locks
`KeyedLock` (cash receipts, settlement requests, check-ins) serialises within one API process. Cash
receipts also take a Postgres advisory lock; settlement requests and check-ins rely on idempotent
references / submission-order evaluation across instances, which keeps them correct but not perfectly
serialised. If the API is scaled out, move these to `pg_advisory_xact_lock` or the Redis lock dispatch uses.
- **Fix (pass 2):** `shared/db/advisory-lock.ts` — `advisoryXactLock(tx, key)` (no-op on the in-memory marker
  Tx) and `DistributedKeyedLock` (in-process `KeyedLock`, then the advisory lock first inside the UoW
  transaction). Used by settlement requests / hand-overs / payouts (above). Cash receipts per courier
  already took `ops.cash:<id>` (unchanged). Counters that must be shared are on `shared/window-counter.ts`
  (`WINDOW_COUNTER` in `InfraModule`: Redis sorted set with `REDIS_URL`, in-process otherwise): the
  hand-over code attempt counter (`ops:handover_fail:<courier>:<date>`) and the chat send / call limits
  (`chat:send|call:<person>`). A refused hit is not counted. Check-ins keep their in-process lock: their
  correctness across instances comes from submission-order evaluation (#17).
- **Tests:** `shared/db/advisory-lock.test.ts` (SQL + key, serialisation), `advisory-lock.integration.test.ts`
  (two "instances" on Postgres), `window-counter.redis.test.ts` (two pods share a window; racing hits never
  pass the last slot), `ops.service.test.ts` › "the 5-wrong-codes lock counts attempts on every API instance",
  `chat.service.test.ts` › "the send and call limits hold across API instances".

### 23 · Low · names of deleted people
`IdentityService.memberCards` (fleet, ops cash round, merchant staff) does not skip `deletedAt` people the way
`firstNamesFor` / `courierCard` do. Whether the vault row is wiped on deletion decides the impact.
- **Fix (pass 2):** `memberCards` reads the person row first and leaves deleted people out (no vault read,
  no log row), like `firstNamesFor`; every caller (households, fleet, ops cash round, merchant staff, top-up
  lookup) already renders a missing card as a nameless row.
- **Test:** `identity/profile.test.ts` › "member cards leave out deleted people…".

## Pass 2 — open S1–S3 API items from the apps review

### 24 · Medium · orders while closed by opening hours (apps review #10)
- **Fix:** `orders.place` reads the storefront through the catalog port (`CatalogPort.storefront`, bound to
  `CatalogService`) and refuses outside its opening hours with `merchant_closed` ("المطعم مسكّر هسه. اطلب من
  يفتح أو احجز طلبك لوقت الفتح"). A scheduled order is checked at its scheduled time (opening time itself is
  fine) and may not land in a pause window either; an early close refuses non-scheduled orders as before;
  busy mode never refuses. No hours on file = open. `orders.quote` stays lenient (the app shows the state).
- **Tests:** `orders/place-guards.test.ts` (5).

### 25 · Low · restaurant minimum order (apps review #11)
- **Fix:** `order_below_minimum` when the menu-priced items (before any deal; free-text requests count 0) are
  under the storefront's `minOrderIqd`, scheduled orders included. A deal's own `minOrderIqd` is untouched
  (deal engine); a basket can meet the restaurant minimum and still miss the deal.
- **Tests:** `orders/place-guards.test.ts` (3).

### 26 · Medium · short-notice الرجعة cars (apps review #12; product decision 2026-10-04)
- **Rule:** the low-fill cancel never fires before the announced departure − 10 min
  (`IntercityRules.lowFillNotBeforeMin`, default 10); a car announced less than 30 min ahead (the boarding
  window) is judged only at its hard latest departure. Below the minimum from T−30 the car stays
  `scheduled` and keeps selling; reaching 3 seats at any tick from T−30 opens boarding.
- **Fix:** `DeparturesService.lowFillAt(dep)`, used by `tick` and by `cancelLowFill` (refused, logged, before
  that time); dispatch's `DeparturesPort` gained `lowFillCheckAt` (routes binds it) and `cancelLowFill` may
  answer false — a `scheduled` dispatch request now checks at the routes time and re-checks after a refusal.
- **Tests:** `departures.service.test.ts` low-fill block (existing test moved to T−10; thin car filling
  between T−30 and T−10 boards; short-notice car judged only at its latest departure; short-notice car with 3
  seats boards at once; the port refuses before T−10); `offer.orchestrator.test.ts` › "checks when the owner
  (routes) says…".
- **Client follow-up:** the Partner announce form can drop its generic warning for short-notice cars.

### 27 · verified · courier top-up (deals-and-topup §2)
`partner.topUpLookup/confirmTopUp` were already limited to the courier carrying one of the customer's live
orders, and the cash is posted from `cash:<courier>` (counts on his cap). The module's check is now an
exported pure function (`courierCarriesOrderOf`) and `topups/courier-path.test.ts` runs it on the real orders
+ trips services: another customer's courier and a courier whose order is closed are refused; the carrier's
`owedIqd` rises and `capRemainingIqd` falls by the amount.

### Pass 2 verification
`pnpm turbo run typecheck lint test`, `pnpm sim --orders 2000 --seed 1 --ci` (18/18 invariants) — green.
Integration on a fresh Postgres 16 + PostGIS (port 55450; migrations applied in order with `pg`, then
`pnpm db:seed`) and Redis: `apps/api` 14 files / 48+ tests and `packages/db` integration green; both
services stopped afterwards. Migration `20261004130000_orders_merchant_placed_index` applied there.

## Verification

`pnpm turbo run typecheck lint` (now race-free, #14), `pnpm --filter @driver/api test`,
`pnpm --filter @driver/contracts test`, `pnpm --filter @driver/db test` — all green at the final commit.
Prisma-backed integration tests (`wave2.integration.test.ts`) need `DATABASE_URL` and were extended for the
fleet consent column but not run here; migrations `20261004120000_fleet_driver_consent` and
`20261004120100_events_aggregate_index` were not applied to a database in this environment (no schema
engine); CI's drift check is the authority.
