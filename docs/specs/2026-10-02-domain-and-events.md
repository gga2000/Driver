# Driver (درايفر) — Domain & Events Spec

Date: 2026-10-02 · Status: approved — Plan 1 (domain & events) complete, Q1–Q14. Supersedes the domain section of `2026-10-02-platform-core-design.md` where they differ.

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

## 8. Notifications policy
Push first; WhatsApp for anything involving money or safety; SMS for OTP and as fallback when push fails; WhatsApp falls back to SMS after 60 s undelivered. Quiet hours 23:00–07:00 except active trips. Every notification deep-links to its screen. Merchants may attach a Bluetooth printer; new orders print automatically.

| Event | Customer | Driver | Merchant |
|---|---|---|---|
| OTP | SMS, WhatsApp fallback | same | same |
| Order accepted / preparing / picked up | push | — | — |
| Courier arriving (2 min) | push + WhatsApp | — | — |
| Delivered / completed + receipt | push + WhatsApp | push | — |
| New order | — | push + loud alert, repeat every 20 s until seen | push + loud alert + optional SMS |
| Job offer | — | in-app only | — |
| Unreachable customer | masked call + WhatsApp | — | — |
| Seat booked / departure reminders (evening before, 1 h) | push + WhatsApp | push | — |
| Late meter running | push + WhatsApp | push | — |
| Khat: driver 2 min away, child dropped | push + WhatsApp to guardian | — | — |
| Settlement due / over cap | — | push + WhatsApp | — |
| Payout statement | — | — | WhatsApp PDF |
| Dispute / refund outcome | WhatsApp | WhatsApp | WhatsApp |
| Marketing | WhatsApp, opt-in, max 2/week | — | — |

## 9. Disputes
Customer may open a dispute until `closed` (2 h); after that support only. Refunds default to wallet credit; cash refunds via support only. Every dispute is an Incident with an auto-attached evidence pack. More than 3 disputes in 30 days puts a customer's disputes into manual review. Support overrides are logged.

| Case | Evidence | Default outcome |
|---|---|---|
| Cold / late beyond promise + 20 min | timestamps, trail | delivery fee refunded as credit; scoring hit to the party that caused the delay (prep vs transit) |
| Missing item | grouped order, merchant ready tap | merchant refunds item; merchant scoring hit |
| Wrong item | same | merchant refunds; re-delivery at merchant cost within 30 min |
| Not delivered vs delivered | dropoff geofence, trail, photo | in geofence + photo: stands; no photo: courier pays 50%; outside geofence: courier pays |
| Courier cancels after pickup | — | courier pays food cost; review after 2 in 30 days |
| Customer no-show after unreachable protocol | call log, timer | customer owes cost; flagged; prepay required after 2 |
| Parcel damaged/lost | photos, declared value | courier liable up to tier cap; incident |
| Cash discrepancy | ledger vs statement | balance adjusted; 3 in 30 days: cap lowered + review |
| Ride fare | locked quote, re-quote lines | locked quote stands; detour shown |
| Seat / late / no-show | meter, PIN, check-in | rule outcome stands |

## 10. Points
Earn 1 point per 100 IQD on food, grocery, parcels; 1 per 200 on rides and seats. Organizer bonus +10% of order points. 100 points = 1,000 IQD wallet credit, applied to delivery fees first. Boosts (config): merchant-funded double points, first-order bonus, weekly streaks, referral 2,000 points both sides on first completed order. Pending points for non-users expire after 90 days unclaimed; claimed points expire 12 months after earning. Customer tiers Silver/Gold by 90-day spend: Gold gets priority dispatch at peak and free door pickup. Points are a ledger liability included in the nightly invariant.

## 11. Promotion engine
A Promotion is a named, explained quote component (`discount`) with: funder (platform, merchant, driver pool, referral); effect (percent, fixed, free delivery, BOGO, free item, bundle, points multiplier, seat upgrade); scope (item, merchant, category, vertical, zone, time window); audience (all, new, tier, list, segment); limits (per user, per day, budget cap, stacking); validity. Mechanisms: codes, auto-apply, merchant self-serve deals (platform approval switch), flash deals, personal offers from behaviour, bundles, community deals (threshold of orders unlocks a discount, live counter). Rules: every discount is its own receipt line naming its funder; budget caps auto-stop; fraud fingerprint (device + phone + place) for new-user offers; no stacking by default (best for customer wins); each promo has an owner and end date; each records impressions, redemptions and incremental orders against a holdout. Objects: `Promotion`, `PromoRedemption`.

## 12. Households
Household is an org type live at launch: shared saved places; guardian links; members with spending limits; a shared household wallet with payer and orderer roles; orders over a member's limit request one-tap payer approval. Wallet moves into Platform Core; cash top-ups via drivers or agent shops count as funding until digital rails land.

## 13. Data retention and access
Keep all business data at full resolution indefinitely: GPS trails, all events, quotes (accepted and declined), promo exposures, searches, menu views, cart abandonment, receipt prices, landmark corrections, histories, ratings, disputes, scorecards, device and network telemetry. Personal identifiers (name, phone, home photos, ID documents, selfies, minors' positions) live in a separate identity vault; the analytics warehouse holds pseudonymous IDs; re-identification only through the console with every access logged. Ageing exceptions: selfie photos dropped after 90 days (result kept); minors' second-by-second positions replaced by trip summaries after 30 days. Account deletion erases identifiers; behavioural data stays pseudonymous. Data does not leave the region without a decision.

## 14. Sub-projects (updated)
Platform Core (incl. wallet and households) → Food → City taxi/tuktuk → Parcels → Intercity + seats → خطوط → Grocery (catalog + errands) → Digital payment rails.
