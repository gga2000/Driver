# Return trip 10 % off and lap children (Baghdad/Kut seats, private car round 2 step 5)

Ali's price items 51 (return bundle) and 52 (lap child free). Server: `apps/api/src/modules/routes/departures.service.ts`
(`returnPartner`, `pairDiscount`, `dropPair`, `repointPair`, `discountSplit`), `model.ts` (`returnDiscount`).
Migration `20261010380000_seat_return_bundle` (three columns on `seat_bookings`, no new table).

## Return bundle — switch `MoneyRules.intercityReturnBundle` (off as shipped)

`{ enabled: false, percent: 10, fundedBy: 'platform' }`. Ali decided on 2026-10-08 that the company funds it (`fundedBy: 'platform'`). Turning it on or changing the percent is his call.

- **When a pair forms:** the rider holds a booked seat one way and books a seat the other way on the same corridor,
  while the first car has not left yet (both departures still open). Same direction or another road never pairs.
- **How much:** 10 % of every seat in the pair, each seat rounded down to 250 dinar
  (`floor(seats × price × pct / 100 / 250) × 250`). Two 5,000 seats → 1,000 off.
- **Where it sits:** the whole discount rides on the **later** booking, so nothing he already rode is ever taken back.
  The hold already shows it (`returnDiscountIqd`); booking locks it and links both bookings (`returnPairId`).
  A wallet seat is checked against the discounted total.
- **Losing it:** the rider cancels or no-shows a leg, or the earlier leg is stranded with its hold forfeited → the pair
  breaks; the later booking goes back to full price only while it is still held or booked (never after riding).
  A seat the driver cancelled that moves to the next car keeps its pair.
- **Views:** `BookingView.returnDiscountIqd`, `returnPairBookingId`, `returnOfferPercent` (non-null on the owner's
  booked, unpaired, not-yet-left seat while the switch is on — the app shows «ارجع ويانا بخصم 10 %»).
- **Events:** `seat.return_paired {bookingId, pairBookingId, discountIqd, discountedBookingId}`,
  `seat.return_unpaired {bookingId, reason, discountIqd}` (only when a discount was actually lost).

### Ledger (`postSeat`, `SeatMoneyPayload.platformDiscountIqd`)

The rider pays fare + front premium − discount.

| `fundedBy` | Driver of the discounted car | Company |
|---|---|---|
| `platform` (recommended) | paid on the full seat price (5,000 seat → 4,500 after the 10 % take) | pays the whole discount: `promo_funded` platform → payer, memo `return_bundle` |
| `driver` | each driver gives up only his own seat's share: the fare is lowered by this booking's own seats' discount (4,500 → 4,050) | pays the other car's share |

## Lap children (Ali item 52, no switch)

`seats.hold` takes `lapChildren` (0–3, default 0). One child per booked seat, never on «المقعد القدام»
(`lapChildrenAllowed(seatIds)`), else `lap_children_invalid`. Free: no line in the money, a «ببلاش» line on the
quote and ticket. The driver's manifest row shows the count (`DriverBookingRow.lapChildren`).

Demo: `POST /demo/rajaa/return?personId=` (customer demo API) turns the switch on, books a seat out and announces two
cars back. Screenshots: `node scripts/web-shots.mjs return` in `apps/customer`.
