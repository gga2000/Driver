# Partner & Merchant apps — wave 2 API

Date: 2026-10-03. Backend for the second wave of the Partner and Merchant apps (spec
`docs/specs/2026-10-03-partner-and-merchant-apps.md`). Five new tRPC keys; the `partner` and `merchant`
keys (presence / offers / active job, order board / busy / printer) belong to the wave-1 shells.

Conventions (same as every router):

- All procedures need a session (`Authorization: Bearer`). The role column is the coarse gate in the
  router; org scoping and owner-only checks happen in the API and answer `FORBIDDEN`.
- Errors carry `{code, message_ar, message_en, retryHint}`. New codes are listed per key.
- Dates are `Date` on the wire (superjson). Money is integer IQD. "Local" means Baghdad (UTC+3); weeks
  start Sunday.
- **Photos**: upload first with `places.photoUpload({contentType, sizeBytes})` → signed `PUT`, then pass
  the `uploadId`. The upload must be the caller's and stored, else `upload_invalid`.

Contracts: `packages/contracts/src/{driver-account,khat,fleet,ops,merchant-admin}-io.ts`, routers in
`packages/contracts/src/routers/`. API modules: `apps/api/src/modules/{driver-account,khat,fleet,ops,promotions,merchant-admin}`.

## `driverAccount.*` — a driving person's own account

Roles: driving roles (`courier`, `shopper`, `driver`, `intercity_driver`, `khat_driver`). Reads that take
`driverId` other than the caller's are back office only (`finance`, `admin`, `dispatcher`, `support`,
`field_ops`); fleet owners use `fleet.driverEarnings`.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `earnings` | query | `{period: 'day'\|'week'\|'month' = 'day', anchor?: Date, driverId?}` | `EarningsView`: `{from, to, totals {grossIqd, takeIqd, tipsIqd, bonusesIqd, guaranteeTopUpsIqd, penaltiesIqd, netIqd, jobs}, jobs[] {key, tripId, orderId, at, components[] {type, label_ar, label_en, amountIqd (signed), memo}, netIqd, cashCollectedIqd}, cash {collectedIqd, toMerchantsIqd, settledIqd, heldIqd, owedIqd}, cap {role, tier, capIqd, owedIqd, remainingIqd, fill 0–1, overCap, byTier {bronze, silver, gold}}, payoutDueIqd}` |
| `scorecard` | query | `{driverId?}` | `ScorecardView`: `{dayNumber, visibleFrom, visible, observation, learningMessage_ar, index\|null, tier\|null, completedTrips, windowDays: 14, metrics[] {key: acceptance\|completion\|on_time\|rating\|cash_return, label_ar, value, display, samples, fullAt, zeroAt, silverLine, score, weight, belowSilver}, nudges[] {key, message_ar, message_en}, consequencesFrom\|null}` — days 1–30: `visible=false`, metrics `[]`, index `null` for the driver (back office still sees them); from day 31 nudges for components under the Silver line and `consequencesFrom` = next Sunday |
| `documents` | query | `{driverId?}` | `{driverId, documents[] DriverDocumentView, missing[] kind, blocksOnline}` |
| `uploadDocument` | mutation | `{kind, uploadId, expiresAt?}` — kinds `national_id_front`, `national_id_back`, `licence`, `vehicle_registration`, `insurance`, `photo` | `DriverDocumentView {id, kind, kind_ar, status, status_ar, expiresAt, daysToExpiry, submittedAt, reviewedAt, rejectReason}`; status `pending → approved\|rejected`, derived `expiring` (≤ 30 days) / `expired`. A new upload of a kind supersedes the old one |
| `reviewDocument` | mutation | `{documentId, decision: 'approve'\|'reject', reason? (required to reject), expiresAt?}` — roles `field_ops`, `support`, `admin` | `DriverDocumentView` |
| `checkInChallenge` | mutation | — | `{challengeId, gesture: blink\|turn_left\|turn_right\|smile\|nod, gesture_ar, expiresAt (2 min)}` |
| `submitCheckIn` | mutation | `{challengeId, uploadId (selfie), livenessScore? 0–1}` | `CheckInStatus & {checkInId, result: passed\|failed, reason}` |
| `checkInStatus` | query | — | `{localDate, required, verifiedToday, verifiedAt, failuresToday, lockedOut, badge_ar ("متحقق اليوم ✓")}` |
| `onlineGate` | query | — | `{canGoOnline, reasons[] {code: checkin_required\|checkin_locked\|document_expired, message_ar}, checkIn}` |
| `handoverCode` | query | — | `{code: 4 digits, validUntil}` — read out to field ops for `ops.recordCashReceipt`; rotates at local midnight |

Notes: earnings come from `ledger.driverLedger` (every line named via `ledger.line.<type>`); guarantee
top-ups are `driver_incentive` lines whose memo starts with `guarantee`. Two failed check-ins in a local
day lock the driver out and emit `driver.checkin_locked` (ops alert). Document photos and selfies are
written as refs to the identity vault (`person_identities.document_refs` / `selfie_refs`); the public
tables keep status and expiry only. **Partner shell:** call `driverAccount.onlineGate` before going
online; server-side, `DriverAccountService.onlineGateFor(personId)` is exported for the `partner`
presence path to enforce it.

Errors: `document_not_found`, `checkin_challenge_invalid`, `checkin_locked`, `upload_invalid`, `forbidden`.

## `khat.*` — خطوط driver side

Role: `khat_driver`. A run is a Trip of vertical `khat`; each stop carries one child's opaque `childRef`.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `todayRun` | query | `{date?}` | `{localDate, trips[] KhatRunTrip}`; `KhatRunTrip = {tripId, state, stops[] {stopId, seq, type, state, zoneKey, windowStart, windowEnd, child {childRef, firstName}\|null, tappedInAt, tappedOutAt, absent}, childrenTotal, onBoard, delivered, absent}` |
| `tapIn` | mutation | `{tripId, stopId, pin?, occurredAt?, deviceUptimeMs?, idempotencyKey?}` (pickup stop) | `KhatRunTrip` — arrives the stop if still pending, then completes it with the child's tap |
| `tapOut` | mutation | same (dropoff stop) | `KhatRunTrip`; `khat.child_tapped_out` with `notifyGuardian: true` is the guardian's "arrived" push |
| `reportAbsence` | mutation | `{tripId, childRef, reason: guardian_notice\|not_at_stop\|sick\|other, note?}` | `{absenceId, tripId, childRef, reason, skippedStopIds, reportedAt}` — skips the child's unfinished stops, emits `khat.absence_reported`; repeating returns the first report |
| `substituteOffers` | query | `{cityId}` | `[{offerId, tripId, expiresInSec, stopsCount, childrenCount, firstWindowStart, zones, compensationIqd}]` — this driver's open offers on khat dispatch cards (substitute auction) |
| `acceptSubstitute` | mutation | `{offerId}` | `{outcome: assigned\|declined, tripId}` (goes through `dispatch.respond`) |

Children's names: first name only, read through identity for the run's own driver (`childFirstNamesForRun`),
every read a `VaultAccessLog` row with purpose `khat_today_run`. Errors: `khat_not_child_stop`,
`khat_child_not_on_trip`, `khat_child_absent`, `stop_state_conflict` (absence after tap-in), `forbidden`.

## `fleet.*` — fleet owner dashboard

Role: `fleet_owner` scoped to the fleet org. `fleetOrgId` may be omitted when the caller owns exactly one.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `overview` | query | `{fleetOrgId?}` | `{fleetOrgId, totals {vehicles, drivers, online, onJob, todayEarningsIqd, weekEarningsIqd, owedIqd}, vehicles[], drivers[], expiringDocuments[] {driverId, kind, status, expiresAt, daysToExpiry}, days[7] {date (local YYYY-MM-DD, Sunday first), earningsIqd, jobs}}` |
| `vehicles` | query | `{fleetOrgId?}` | `[{vehicleId, plate, vehicleClass, activeDriverId, active, seats}]` |
| `drivers` | query | `{fleetOrgId?}` | `[{driverId, name, phoneMasked, state: offline\|online\|on_job\|over_cap, vehicleId, tier, todayEarningsIqd, weekEarningsIqd, owedIqd, cashHeldIqd, capIqd, documents (worst status)}]` |
| `driverEarnings` | query | `{fleetOrgId?, driverId, period = 'week', anchor?}` | `EarningsView` (as `driverAccount.earnings`) |
| `assignDriver` | mutation | `{fleetOrgId?, vehicleId, driverId \| null}` | `FleetVehicle` (a driver leaves his other vehicle) |
| `addVehicle` | mutation | `{fleetOrgId?, plate, vehicleClass, seats? (0–14; default by class: bike 0, tuktuk 3, car 4, suv 6, van 7)}` | `FleetVehicle` (seats stored as the vehicle's seat map) |
| `addDriver` | mutation | `{fleetOrgId?, phone}` | `FleetDriver` with `pending: true` (person found or created by phone; the driving role still comes from ops review) |
| `myInvites` | query | — (driving roles) | `[{fleetOrgId, invitedAt, invitedByName (owner's first name), accepted}]` — the driver's own fleet links |
| `respondInvite` | mutation | `{fleetOrgId, accept}` (driving roles) | his links after: `accept` joins, `false` declines or leaves (his vehicle there is unassigned) |

**Consent (review 2026-10-04):** a link is pending until the driver accepts it. A pending row is the bare
`driverId` with `pending: true` — no name, phone, money, documents or live state, no vault read — and it
cannot be assigned a vehicle or read through `driverEarnings` (`driver_not_in_fleet`). Once accepted,
earnings shown to the owner start at the moment he joined. Names are vault reads logged with purpose
`fleet_view`. Errors: `fleet_not_found` (also: no such link for `respondInvite`), `fleet_ambiguous`,
`vehicle_not_found`, `vehicle_plate_taken`, `driver_not_in_fleet`.

## `ops.*` — field ops mode

Roles: `field_ops`, `admin`.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `addLandmarkPhoto` | mutation | `{target {kind: place\|meeting_point\|landmark, id}, uploadId, caption?, localNames[] (≤ 5)}` | `{photoId, target, state: 'proposed', addedAt}` (`landmark.proposed`; Console approves) |
| `recordCashReceipt` | mutation | `{courierId, amountIqd, code (courier's handover code), note?, idempotencyKey?}` | `{receiptId, courierId, amountIqd, reference (D-XXXX-XXXX), receivedAt, courierOwedIqd, courierCapRemainingIqd}` — posts ledger `driver_settlement` (channel `ops_round`) in the same unit of work; emits `ops.cash_received` (WhatsApp receipt) |
| `merchantOnboarding` | mutation | `{cityId, name, type: restaurant\|grocer, contact {name, phone}, location {zoneKey, pin?}, menuPhotoUploadIds[], shopPhotoUploadId?, notes?, settlementMode? (nightly_courier\|on_demand\|daily_zaincash\|weekly_bulk)}` | `{onboardingId, merchantOrgId, state: 'draft', menuPhotos, taskId, createdAt}` — owner phone/name go to the vault |
| `myTasks` | query | `{cityId?}` | `[{taskId, kind: cash_collection\|merchant_followup\|landmark_photo\|document_check, title_ar, refId, amountIqd, dueAt, state, computed}]` — computed `cash:<driverId>` tasks for couriers owing ≥ 50 % of their cap (or over it) |
| `completeTask` | mutation | `{taskId, note?}` | `OpsTask` (stored tasks only) |
| `cashHolders` | query | `{cityId?}` | `[{courierId, name, phoneMasked, heldIqd, owedIqd, capIqd, tier, overCap}]` — couriers holding customers' cash, over-cap then most owed first; names are vault reads (purpose `ops_cash_round`) |
| `landmarks` | query | `{cityId = 'aziziyah', zoneKey?}` | `[{placeId, name, zoneKey, pin, photos}]` — landmark places (fewest photos first); `photos` counts the place's photos plus ops proposals still pending. A new landmark is proposed with `addLandmarkPhoto` target `{kind: 'landmark', id: 'new:<zoneKey>'}` and its name first in `localNames` |

Errors: `handover_code_invalid`, `cash_receipt_exceeds_held`, `task_not_found`, `upload_invalid`.

## `merchantAdmin.*` — Merchant app wave 2

Roles: `merchant_owner` / `merchant_staff` **scoped to `merchantOrgId`** (every input carries it).
Owner-only (staff get `FORBIDDEN`): `money.*`, `staff.*`, `deals.project`, `deals.propose`, `deals.setActive`.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `myMerchants` | query | — | `[{merchantOrgId, role}]` |
| `menu.get` | query | `{merchantOrgId}` | `{merchantOrgId, categories[] {nameAr\|null, items[] AdminMenuItem}}`; `AdminMenuItem = {id, nameAr, nameEn, description, priceIqd, photoUrl (signed), categoryAr, sortOrder, prepTimeMin, available, soldOutUntil, onSale, modifierGroups[]}` |
| `menu.setAvailability` | mutation | `{merchantOrgId, itemId, available}` | `AdminMenuItem` (turning on also ends "sold out today") |
| `menu.soldOutToday` | mutation | `{merchantOrgId, itemId}` | `AdminMenuItem` with `soldOutUntil` = next local midnight; customers see it unavailable until then, then it is back by itself |
| `menu.updatePrice` | mutation | `{merchantOrgId, itemId, priceIqd}` | `{item, history[] {oldPriceIqd, newPriceIqd, changedBy, at}}` (newest first) |
| `menu.priceHistory` | query | `{merchantOrgId, itemId}` | `PriceChange[]` |
| `menu.replacePhoto` | mutation | `{merchantOrgId, itemId, uploadId}` | `AdminMenuItem` |
| `menu.upsertItem` | mutation | `{merchantOrgId, itemId?, nameAr, nameEn?, description?, priceIqd, categoryAr?, sortOrder?, prepTimeMin?, available?}` | `AdminMenuItem` (new items get a first price-history row) |
| `menu.upsertCategory` | mutation | `{merchantOrgId, nameAr, renameFrom?, itemIds?}` | `AdminMenu` (sections are item `categoryAr`; `itemIds` places items in order) |
| `menu.reorderCategories` | mutation | `{merchantOrgId, order[] (section names)}` | `AdminMenu` — named sections in that order, others after them, the unnamed one last; items keep their order inside (sort orders become section × 100 + position, so the customer menu follows) |
| `menu.setModifiers` | mutation | `{merchantOrgId, itemId, groups[] {nameAr, nameEn?, minSelect, maxSelect, required, modifiers[] {nameAr, nameEn?, priceIqd, available}}}` | `AdminMenuItem` (replaces all groups) |
| `menu.importFromPhotos` | mutation | `{merchantOrgId, uploadIds[]}` | `MenuImportJob {jobId, state: 'draft', photoUploadIds, photoUrls (signed, same order), items: [], ocr: 'stub', …}` |
| `menu.importJob` | query | `{merchantOrgId, jobId}` | `MenuImportJob` |
| `menu.applyImport` | mutation | `{merchantOrgId, jobId, items[] {nameAr, priceIqd, categoryAr?, description?, sourceUploadId?}}` | `MenuImportJob` (`applied`, items created) |
| `deals.list` | query | `{merchantOrgId}` | `DealView[]` |
| `deals.project` | query | same input as `deals.propose` | `{projected {ordersPerWeek, costPerOrderIqd, weeklyCostIqd, totalCostIqd, basisOrders}, basisDays: 28, requiresApproval}` — owner only; the draft's projected cost before submitting (validated like `propose`, nothing stored) |
| `deals.propose` | mutation | `{merchantOrgId, type: percent\|fixed\|free_delivery\|bogo, value, nameAr, itemIds[], schedule {startsAt, endsAt, days[] 0–6, hours? {start, end}}, budgetCapIqd?, minOrderIqd}` | `DealView {dealId, …, projected {ordersPerWeek, costPerOrderIqd, weeklyCostIqd, totalCostIqd, basisOrders}, state: pending_approval\|approved\|rejected\|paused\|ended, state_ar, active, funder: 'merchant'}` — projection from the last 28 days of orders, server-side; city config `merchantDeals.requirePlatformApproval` (Aziziyah: true) |
| `deals.setActive` | mutation | `{merchantOrgId, dealId, active}` | `DealView` |
| `deals.review` | mutation | `{dealId, approve, reason?}` — roles `admin`, `support` | `DealView` |
| `money.today` | query | `{merchantOrgId}` | `{localDate, orders, salesIqd, commissionIqd, commissionByTier[] {tier, pct, baseIqd, commissionIqd, orders}, dealsIqd, netIqd, cashHeldByCouriersIqd, holders[] {courierId, amountIqd}, payableBalanceIqd, settlementMode, overExposure}` |
| `money.cash` | query | `{merchantOrgId}` | `MerchantCashAccount {balanceIqd, exposureCapIqd, overExposure, mode, holders[] {courierId, name (first name), amountIqd}, heldByPlatformIqd, request {reference, reason, requestedAt, amountIqd, state: requested\|on_the_way\|handed_over, channel, courierId, courierName, assignedAt, targetBy, handover} \| null, handovers[] {handoverId, at, courierId, courierName, amountIqd, balanceAfterIqd, confirmedBy: pin\|tablet}, lastSettledAt}` — the "اطلب فلوسك" timeline follows `merchant.settlement_requested` → `merchant.settlement_assigned` (same reference) → the courier's next hand-over (14 days of hand-overs, latest request within 24 h) |
| `money.statement` | query | `{merchantOrgId, weekOf?}` | `{from, to, openingIqd, closingIqd, lines[] {orderId, at, payment, itemsIqd, commissionTier, commissionIqd, feesIqd, netIqd}, settlements[] {at, kind: courier_handover\|payout, amountIqd, reference}, totals}` |
| `money.disputes` | query | `{merchantOrgId}` | `[{orderId, kind, note, openedAt, evidence {acceptedAt, readyAt, pickedUpAt, deliveredAt, promisedReadyAt, lines[] {name, qty, participant}, itemsIqd}, defaultOutcome {code, text_ar, merchantImpactIqd}, response\|null}]` (last 30 days) |
| `money.respondDispute` | mutation | `{merchantOrgId, orderId, decision: accept_default\|contest, note?, evidenceUploadIds[] ≤ 5}` | `MerchantDispute` (re-answering replaces; emits `merchant.dispute_responded`) |
| `insights` | query | `{merchantOrgId, days = 30}` | `{prepHonesty {samples, quotedAvgMin, actualAvgMin, onTimeShare}, rejection {offered, rejected, rate}, itemRatings[] {itemId, nameAr, avg, count, reviews[] {score, note, at}}, peakHours[24]}` |
| `staff.list` | query | `{merchantOrgId}` | `[{personId, name, phoneMasked, role, you}]` (vault reads logged, purpose `merchant_staff_view`) |
| `staff.invite` | mutation | `{merchantOrgId, phone, role = 'merchant_staff'}` | `StaffMember` (grants the role scoped to the org) |
| `staff.setRole` | mutation | `{merchantOrgId, personId, role}` | `StaffMember` |
| `staff.remove` | mutation | `{merchantOrgId, personId}` | `{removed}` |

Additive fields (Merchant app wave 2): statement lines carry `commissionPct`, `discountIqd`, `discountFunder`
(platform promos today: they don't lower the merchant's net); disputes carry `respondBy` (opened + 48 h, then
the default outcome stands), `evidence.photos` and `response.photoUrls` (signed); insights carry
`rejection.trend[]` (7-day buckets), `peakGrid[7][24]` (weekday × hour), `bestSellers[]` (by sales) and
`orders`, and a rated order's food score goes to its main dish (largest line) only; staff rows carry
`pending` (invited, never signed in). `merchant.paid_by_courier` events carry `confirmedBy`.

Errors: `menu_item_not_found`, `import_job_not_found`, `import_state_conflict`, `deal_not_found`,
`deal_invalid`, `deal_state_conflict`, `dispute_not_found`, `staff_last_owner`, `upload_invalid`.

## Persistence

Migration `packages/db/prisma/migrations/20261004000000_partner_merchant_wave2`: tables `driver_documents`,
`driver_check_ins`, `khat_absences`, `fleet_drivers`, `landmark_photos`, `ops_cash_receipts`,
`merchant_onboardings`, `ops_tasks`, `catalog_price_changes`, `menu_import_jobs`,
`merchant_dispute_responses`; columns `catalog_items.sold_out_until`, `promotions.proposal_state`,
`promotions.projected_cost_iqd`. Every new repository has a Prisma and an in-memory twin (Prisma when
`DATABASE_URL` is set); `apps/api/src/wave2.integration.test.ts` round-trips all of them.

## Known gaps / TODO

- **Orgs are still in memory** (`OrgsService`). `ops.merchantOnboarding` creates the draft org there; the
  onboarding row persists, the org does not survive a restart. Fleet vehicles (`vehicles.owner_org_id`)
  and merchant deals (`promotions.merchant_org_id`) reference `orgs` rows, so with a database those orgs
  must exist as rows (seeded / Console). New wave-2 tables deliberately have no foreign keys to `orgs`.
- **Deals are not redeemed at checkout yet.** They are stored, projected and approved; binding a
  `PromotionsPort` that resolves merchant deals needs orders to put merchant-funded discounts into the
  commission base (G-87) instead of the platform promo line. `money.today.dealsIqd` is 0 until then.
- **Menu photos** replaced by merchants are stored as `upload:<id>` in `catalog_items.photo_url`; the
  admin view signs them, the customer catalog (`catalog.*`) does not yet.
- **Liveness and face match are stubs** (device SDK score, default 1); OCR for menu import is a stub
  (empty draft, staff type the rows).
- **Online gate enforcement**: `partner.goOnline` calls `DriverAccountService.onlineGateFor` and refuses with
  `online_checkin_required` / `checkin_locked` / `online_document_expired`; `partner.status.gate` carries
  the reasons. A refused heartbeat takes an online driver out of the index (lock-out, expired document).
  Nothing pushes a driver offline the moment `driver.checkin_locked` fires or a document expires: it
  happens at his next heartbeat (≤ 30 s while the app is open).
- Shift-guarantee top-ups are shown when the ledger has them (`driver_incentive`, memo `guarantee…`);
  no job posts them yet. Courier-waiting charges to merchants are not ledger lines yet.
- The khat run is read from the driver's khat trips; spawning a day's trips from a khat `Route` /
  `Subscription` (`khat.day_run_spawned`) is not built.
- Drift: no Prisma schema engine was available here, so `prisma migrate diff` was not run; the
  migration was applied to a fresh PostGIS database together with all earlier ones, seeded, and checked
  column-by-column (types, nullability, defaults, index names) against `schema.prisma`. CI's drift step
  is the authority.
