# Agreed trip prices (Baghdad/Kut, private car round 2 step 4)

Ali's decision (2026-10-07 23:05): a pickup from the rider's pin on the way and a drop at a door in
Baghdad or Kut are priced **per trip, agreed in the app**, can be 0, saved on the booking and shown to
both, so nobody haggles in the car. «احجز وادفع كاش» on a private car: the driver accepts → no deposit;
a rider no-show then owes the deposit amount, collected on his next trip and paid to the driver.

Ali's votes on the design page (2026-10-08 12:22, https://claude.ai/artifact/CTsr5pd6R15gZ6Hwj3LKa7):
way 2 (price cards in the chat plus a pinned «اللي اتفقنا عليه» strip) and Yes to rules a1–a9.

## Split

- **4a (this spec, built now):** agreements as their own server records, the seat booking side (pin
  pickup, door drop), totals, the rider's booking screen and the driver's passenger list. Usable
  without chat: the rider asks from the booking flow, the driver answers from his list.
- **4b (built, off):** the private-car «احجز وادفع كاش» ask and the no-show debt (a money rule, behind
  `MoneyRules.requestCashReservation`, off).
- **4c (built 2026-10-08, after Ali's yes on taking over chat, 22:36Z):** the same agreements shown as
  cards inside the rider ↔ driver chat, the pinned «اللي اتفقنا عليه» strip, «اسأل السايق» on a run and
  «اسأله» on private-car offers. Chat only *renders* agreements; the rules stay here. `docs/api/trip-chat.md`.

## The agreement record (4a)

`trip_agreements` (one row per ask), owned by the routes module:

| field | meaning |
|---|---|
| `id` | `ag_…` |
| `departure_id` | the seat trip it is for |
| `rider_id`, `driver_id` | the two sides (the departure's driver) |
| `kind` | `pin_pickup` · `door_drop` (4b adds `cash_reservation`) |
| `lat`, `lng`, `note` | the place being priced (rider's pin / door) |
| `state` | `asked` → `proposed` → `accepted` · `declined` · `expired` · `withdrawn`; `accepted` → `used` |
| `amount_iqd` | the driver's price, null while asked; 0 = «ببلاش» |
| `asked_at`, `proposed_at`, `expires_at`, `decided_at` | times |
| `booking_id` | set when a booking uses it (locked) |

Rules (a1–a7):
- **a1** The rider asks (`agreements.ask`: departure, kind, place). Only the departure's driver sets
  the price (`agreements.propose`). A rider cannot type an amount.
- **a2/a3** Amounts are whole 1,000s from 0 to 25,000 (`agreement_amount_invalid` otherwise).
- **a4** Only the kinds above. A pin pickup must be on the way: within 5 km of the route (the
  garages and the corridor's meeting points as a line), and not inside the home door area (that
  keeps the existing distance price). A door drop must be within 25 km of the destination garage.
- **a7** A proposal not answered in 30 minutes expires (the scheduler tick); the driver can propose
  again. An ask the driver never answers expires when the departure leaves.
- One live agreement per (departure, rider, kind): a new ask withdraws the rider's older one, a new
  proposal replaces the driver's older one.
- Riders ask at most 6 times per departure (spam guard; `agreement_limit`).

## On the booking (a5)

- `hold` takes `pickup: {kind: 'pin', agreementId}` and `dropoff: {agreementId}` (optional). The
  server checks the agreement is `accepted`, this rider's, this departure's, unused; it becomes
  `used` with the booking id when the seat is **booked** (a lapsed hold frees it again).
- The booking keeps `pickupFeeIqd` (the agreed pin amount) and a new `dropoffFeeIqd` plus the drop
  place. `bookingTotal` adds `dropoffFeeIqd`. Both ride on the group's first seat in the fare, like
  today's pickup fee (the 10 % take applies to them as part of the fare).
- An agreed pin pickup counts as accepted by the driver (no second «يقبل؟» step).
- After booking, until the departure leaves: a new accepted agreement of the same kind replaces the
  old one on the booking. A prepaid seat is paid at completion from the wallet (as today), so the
  accept only re-checks the wallet covers the new total (`wallet_insufficient` otherwise); a cash
  seat just changes the cash to collect.

## Who sees what

- Rider: his own agreements on the trip (`agreements.mine({departureId})`), the booking's locked
  lines (`pickup` with `agreed: true`, `dropoff`), and the total.
- Driver: every agreement on his departure with the rider's first name (vault read logged), and on
  his passenger list each rider's agreed lines and the cash to collect.
- Support (a9): the agreements of a booking appear in the Console booking view (later, with 4c).

## Events

`agreement.asked`, `agreement.proposed`, `agreement.accepted`, `agreement.declined`,
`agreement.expired`, `agreement.withdrawn`: payload `{agreementId, departureId, riderId, kind, amountIqd}`,
actor the side that acted (`system` for expiry). A price applied to a booked seat also emits
`seat.agreement_applied` `{bookingId, agreementId, kind, amountIqd, totalIqd}`.
Pushes come from these through the chat (4c: each ask and price is a card, which pushes the other side); 4a sends none of its own.
