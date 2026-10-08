# Agreed trip prices (`routes.agreements.*`)

Baghdad/Kut seats, private car round 2 step 4. Rules and reasons: `docs/specs/2026-10-08-agreed-trip-prices.md`.
Server: `apps/api/src/modules/routes/agreements.service.ts` (states), `agreements.ts` (place and amount rules).

| procedure | who | does |
|---|---|---|
| `agreements.ask({departureId, kind, lat, lng, note?})` | rider | asks the driver to price a `pin_pickup` (on the road, outside the home door area) or a `door_drop` (within 25 km of the far garage). Replaces his older open ask of the same kind. 6 per departure. |
| `agreements.withdraw({agreementId})` | rider | takes back an ask or a price not yet on a booking |
| `agreements.respond({agreementId, accept})` | rider | answers a price. Accepting puts it on his booked seat right away (old one withdrawn; a prepaid seat must still be covered, `wallet_insufficient`), else it waits for the booking that names it |
| `agreements.mine({departureId})` | rider | his agreements on the run, newest first |
| `agreements.propose({agreementId, amountIqd})` | the departure's driver | names the price: whole 1,000s, 0–25,000 (0 = «ببلاش»). Lapses after 30 minutes unanswered; he can price again |
| `agreements.onDeparture({departureId})` | the departure's driver | every ask on his run, with the rider's first name (vault read, purpose `intercity_manifest`) |

Booking: `seats.hold` takes `pickup: {kind: 'pin', agreementId}` and `dropoff: {agreementId}`. The
agreed amounts are `pickupFeeIqd` and `dropoffFeeIqd` on the booking, are in its total, and ride on
the first seat's fare (the usual 10 % take). Booking marks the agreements `used`.

Errors: `agreement_not_found`, `agreement_state_conflict`, `agreement_amount_invalid`,
`agreement_place_invalid`, `agreement_limit`, plus `departure_state_conflict` once the car left.

Events: `agreement.asked|proposed|accepted|declined|expired|withdrawn` and `seat.agreement_applied`
(aggregate `departure`). No pushes yet: chat cards (4c) or lane D add them.

## Step 4b: «احجز وادفع كاش» on a private car (a6; switch `MoneyRules.requestCashReservation`, off)

| Procedure | Who | What |
|---|---|---|
| `routes.requestBoard.askCash({ postId, offerId })` | rider | Asks the driver behind one open offer. Once per offer; a no stands. A new price from the same driver carries the ask (and his yes) over. |
| `routes.requestBoard.answerCash({ postId, offerId, accept })` | that driver | Answers an `asked` ask on his own open offer. |
| `routes.requestBoard.pick({ postId, offerId, cash: true })` | rider | Books on the driver's yes: nothing is held on the wallet. |

Refused with `forbidden` while the switch is off, `cash_reservation_owed` while the rider's wallet is
below 0 (a past no-show is paid first), `cash_reservation_revoked` after his seat cash no-shows.
Views: `RequestOfferView.cash` (`asked` · `accepted` · `declined` · null), `RequestPostView.cashReserved`
and `cashReservationOn`. Events: `request.cash_asked` {offerId, driverId, noShowIqd},
`request.cash_answered` {offerId, riderId, accepted}; `request.matched` adds `cashReserved`.

Money (Ali 2026-10-07, rules 49/50): the deposit amount (20 %, min 5,000) stays the no-show amount.
A rider no-show or a cancel inside the last hour posts the same `order.cancelled` fee to the driver; with
nothing held it stays on the rider's wallet as debt (the existing wallet-debt rule). A driver no-show
credits the rider that amount once, from the driver. A completed trip is all cash.
