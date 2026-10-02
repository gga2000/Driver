# Driver (درايفر) — Domain & Events Spec

Date: 2026-10-02 · Status: draft from approved decisions Q1–Q9 of Plan 1 (domain & events); remaining questions pending. Supersedes the domain section of `2026-10-02-platform-core-design.md` where they differ.

## 1. Core objects

| Object | Role | Notes |
|---|---|---|
| Person | One per phone number | roles[], memberships[], locale, trust tier |
| Role | Grant on a Person, optionally scoped to an Org | customer, courier, shopper (sub-role of courier, certified), driver, intercity_driver, khat_driver, merchant_staff, merchant_owner, fleet_owner, guardian, field_ops, dispatcher, support, finance, admin |
| Org | Restaurant, grocer, fleet, household (phase 2) | members, branches/locations, payout settings |
| Vehicle | Plate-level | class: bike, tuktuk, car, van, intercity; owner org; active driver; parcel capacity |
| City / Zone | Config | polygon, price tables, hours, dispatch policy, rounding, meeting points |
| Place | Saved or learned location | pin, name, photos[], note, confidence, owner, shares (household), landmark flag, local names[] |
| MeetingPoint | Curated street-pickup point per neighbourhood | pin, photo, reachable_by[] |
| Participant | A person on an Order who is not necessarily the orderer | name, phone, person_id (nullable), role: recipient / diner / rider / parcel_recipient |
| Order | Commercial object | type: food, grocery_catalog, errand, parcel, ride, seat, subscription; orderer; participants[]; lines[]; quote; state; refund state |
| OrderLine | One item or service on an Order | catalog item or free text, qty, modifiers[], participant_id (tag), note, points_eligible |
| Trip | Logistics object | vertical, stops[], courier, vehicle, state, trail, quote share; linked to Orders many-to-many with history (TripOrder: order_id, trip_id, attached_at, detached_at, reason) |
| Stop | Ordered leg endpoint | place or meeting point, type: pickup / dropoff / wait / shop, window, state, arrived_at, completed_at, handover proof |
| Route | Recurring (khat) or scheduled line (intercity) | stops[], schedule, driver, vehicle, seat_map, type |
| Departure | One scheduled run of an intercity Route | datetime, state, seats[], parcel slots |
| Seat | Bookable position on a Departure or Route | position: front, back_left, back_middle, back_right, parcel; state; rider participant; price; prepaid flag; walk-up flag |
| Subscription | A rider's seat on a khat | state, billing cycle, proration, guardian_id (if minor) |
| Parcel | Package on an Order of type parcel | description, photo_pickup, photo_dropoff, size_class, declared_value, fragile, prohibited_ack, pin |
| Catalog / CatalogItem / ModifierGroup / Modifier / Combo / Variant | Merchant menu | availability schedule, stock, prep_time, branch overrides, taxonomy_id, photo, spice, portion |
| TaxonomyNode | Shared item classification across merchants | parent, name_ar, name_en |
| Quote / QuoteComponent | Priced offer | shown and shadow components, locked_at, re-quote lines |
| LedgerEvent | Immutable money or points event | see §5 |
| Event | Anything that happened | actor, type, occurred_at (device), recorded_at (server), location, payload, idempotency_key |
| Incident | Safety or dispute case | trip/order, opened_by, evidence pack refs, state |
| Scorecard | Derived per driver / merchant / staff | computed from events; never written directly |

## 2. State machines

### Order
`placed → merchant_accepted → preparing → ready → picked_up → delivered → closed`
Exits: `merchant_rejected`, `customer_cancelled`, `platform_cancelled`, `refunded`, `disputed` (from delivered/closed), `failed`.
Rules: merchant must accept within 90 s or auto-reject with dispatch alert; merchants with an earned auto-accept flag skip acceptance. Free cancel until `merchant_accepted`; cancellation fee component after; no cancel after `picked_up` (becomes dispute). `delivered` set by courier; `closed` auto after 2 h without complaint or on rating. Money settles on `closed`.
Ride orders: `placed → matched → completed/closed` (Trip carries the detail). Seat orders: see Seat. Subscription orders: see Subscription.

### Trip
`created → offered → accepted → en_route_to_pickup → arrived_pickup → in_transit → arrived_dropoff → completed`
Exits: `declined`/`timed_out` (back to offered), `driver_cancelled`, `customer_cancelled`, `platform_cancelled`, `failed`.
Trip state derives from Stop states for multi-stop trips.
Arrival: geofence (60 m) arms the button and records GPS time; the driver's tap is the official event; a tap outside the geofence is recorded and flagged, never blocked.
Unreachable customer protocol at dropoff: tap "can't reach" → automatic call/WhatsApp → 5-minute visible timer → dispatcher alerted at minute 3 → `failed` allowed at minute 5 → order `disputed` with default outcome (food: customer owes cost; ride: cancellation fee), support may override.

### Stop
`pending → arrived → completed | skipped`

### Departure (intercity)
`scheduled → boarding (T−30 min) → departed → arrived → closed`
Exits: `cancelled_by_driver` (inside 2 h: scoring hit + fee; riders auto-offered next departures, same seat class honoured, difference refunded), `cancelled_low_fill`.
Walk-up seats: driver marks a seat walk-up in one tap; no commission at launch; a booked seat can never be given to a walk-up; walk-ups count toward fill.

### Seat
`held (10 min, unpaid) → booked → checked_in → completed`
Exits: `cancelled_by_rider`, `no_show`, `moved`.
Lateness: 5-minute grace with countdown visible to driver and boarded riders; from minute 5, 1,000 IQD per 10 min to the driver and 500 IQD per 10 min to each boarded waiting rider (as credit); cap 20 min, then driver may leave and the seat is forfeited. Enforceable on prepaid seats only; cash reservations get a 3-minute grace, no meter, and lose reservation rights after two no-shows. Driver lateness mirrors the rider rule from the driver's balance.

### Route (khat) and Subscription
Route: `draft → active → paused → ended`; spawns a Trip per scheduled day.
Subscription: `trial (first week free for new riders) → active → past_due → cancelled`. Monthly in advance; mid-month join prorated by remaining service days; mid-month cancel: no refund, seat returns to the marketplace, driver keeps the month.

### Parcel hand-over
Photo at pickup; photo at dropoff; recipient PIN by default; fallback: courier taps "no PIN" → sender receives dropoff photo + location and approves release with one tap; all on the trip timeline. Declared-value cap per courier tier; prohibited-items list acknowledged by sender. Intercity parcels use a parcel seat and the same hand-over at the destination garage.

## 3. Participants and points
- Every OrderLine may be tagged to a Participant; merchant app groups and prints by participant; per-participant notes.
- Points per line go to the tagged participant; if no account, `points_pending` keyed by phone, claimed on verification (`points_claimed`). Orderer earns an organizer bonus on the whole order.
- Participants receive status notifications. Shared cart (phase 2): participants add their own lines via link.
- Ride for someone else: rider participant, driver calls the rider, orderer watches live, points to the rider.

## 4. Grocery modes
1. Catalog store (partner grocer, fixed prices, stock).
2. Shop-for-me / errand: free-text or voice list, estimated range from learned receipt prices, customer ceiling, mandatory receipt photo, one-tap substitution approval, actual cost + fee + tip as separate ledger lines; shopper sub-role with certification and higher trust tier.
3. "Get me this from X": single-stop errand.

## 5. Ledger event types
Money: `cash_collected`, `commission_accrued`, `merchant_payable`, `driver_settlement`, `merchant_payout`, `refund`, `credit_issued`, `cancellation_fee`, `promo_funded`, `seat_premium`, `subscription_charge`, `subscription_proration`, `late_penalty_driver`, `late_penalty_rider_credit`, `departure_cancel_fee`, `errand_cost_actual`, `errand_fee`, `tip`, `parcel_fee`, `adjustment`.
Points: `points_earned`, `points_pending`, `points_claimed`, `points_redeemed`, `points_expired`, `organizer_bonus`.
Invariants: money events sum to zero across accounts nightly; points events never create money.

## 6. Domain events (taxonomy)
Identity: `person.registered`, `person.verified`, `role.granted`, `role.revoked`, `org.created`, `org.member_added`, `guardian.linked`, `guardian.revoked`, `device.registered`.
Places: `place.saved`, `place.shared`, `place.confirmed`, `place.drift_applied`, `place.flagged`, `landmark.proposed`, `landmark.approved`.
Catalog: `item.published`, `item.price_changed`, `item.sold_out`, `item.restocked`, `menu.imported`, `merchant.busy_mode_on/off`.
Order: `order.placed`, `order.accepted`, `order.auto_accepted`, `order.rejected`, `order.preparing`, `order.ready`, `order.picked_up`, `order.delivered`, `order.closed`, `order.cancelled`, `order.refunded`, `order.disputed`, `order.failed`, `line.tagged`, `substitution.proposed`, `substitution.accepted/declined`, `receipt.uploaded`.
Trip: `trip.created`, `trip.offered`, `trip.offer_seen`, `trip.accepted`, `trip.declined`, `trip.timed_out`, `trip.en_route`, `stop.geofence_entered`, `stop.arrived`, `stop.completed`, `stop.skipped`, `trip.unreachable_started`, `trip.unreachable_escalated`, `trip.completed`, `trip.cancelled`, `trip.failed`, `trip.batched`, `trip.reassigned`.
Dispatch: `dispatch.wave_sent`, `dispatch.assigned`, `dispatch.override`, `dispatch.policy_changed`, `substitute.auction_opened`, `substitute.assigned`.
Routes: `departure.scheduled`, `departure.boarding`, `departure.departed`, `departure.arrived`, `departure.cancelled`, `seat.held`, `seat.booked`, `seat.checked_in`, `seat.no_show`, `seat.moved`, `seat.walkup_marked`, `seat.late_meter_started`, `subscription.started`, `subscription.renewed`, `subscription.past_due`, `subscription.cancelled`, `khat.day_run_spawned`.
Parcel: `parcel.pickup_photo`, `parcel.dropoff_photo`, `parcel.pin_verified`, `parcel.release_requested`, `parcel.release_approved`.
Safety: `driver.checkin_selfie`, `driver.checkin_failed`, `trip.shared`, `sos.raised`, `route.deviation`, `incident.opened`, `incident.closed`.
Scoring: `score.recomputed`, `tier.changed`, `nudge.sent`, `consequence.applied`, `ban.proposed`, `ban.applied`.
Tracking: `position.reported` (high volume; stored in trail store, not the events table).
Every event carries actor, occurred_at (device), recorded_at (server), location where relevant, idempotency_key. Offline-recorded events with contradictions emit `dispute.opened`.

## 7. Places & landmark rules
- Home photo/note visible only to the assigned courier from `accepted` to `completed` + 1 h; never in history; household sharing opt-in.
- Confidence rises when the courier's arrival tap is within 40 m; pin drifts toward the median arrival after 3+ trips; far taps flag for review, never move the pin. "موقعك مؤكد" badge above threshold.
- Seeded landmark layer (~300) with photos and local names; couriers propose, console approves.
- Curated meeting points per neighbourhood with photos; suggested for street pickup.

## 8. Sub-projects (updated)
Platform Core → Food → City taxi/tuktuk → Parcels → Intercity + seats → خطوط → Grocery (catalog + errands) → Wallet.

## 9. Open questions (next in Plan 1)
Notification events per channel; dispute resolution outcomes table; points earning and redemption rates; household org rules; data retention per object.
