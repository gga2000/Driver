# «عندي غراض» — the rider's shopping on his ride (ride idea x5, 2026-10-07)

Ali's idea x5 (voted yes), for the souq: tell the driver you carry shopping bags or a gas cylinder; the
tuktuk is suggested as the best fit. **Information only: no price effect, no dispatch effect.**

Shared contracts: `packages/contracts/src/ride-cargo.ts` — `RideCargo` (`bags` «أكياس سوق», `gas`
«قنينة غاز», `big` «غراض كبيرة»), `RIDE_CARGO_ORDER`, `sortCargo`, `rideCargoKey`, `RideCargoInput`.

## `orders.place` (rides)

`PlaceOrderInput.rideCargo?: RideCargo[]` — at most one of each kind (a repeated or unknown kind fails input validation).
Stored on the order (`orders.ride_cargo`, text[] checked against the three kinds) in chip order and
echoed as `Order.rideCargo` (absent when nothing was said). Ignored on other order types.
`orders.switchRideVehicle` (no driver after 3 minutes → the other vehicle) carries it over, like «عوائل».
The fare is the same with or without it (`orders.quote` and `orders.place` never read it).

## The driver sees it before he accepts

- `partner.currentOffer` → `PartnerOffer.rideCargo: RideCargo[]` (`[]` = nothing said): the offer card
  shows «عنده غراض: أكياس سوق، قنينة غاز» with «تأكد عندك مكان إلها».
- `partner.activeJob` → `PartnerJob.rideCargo`: the same line on the trip screen until the ride ends.

## Customer app (choose screen)

The trip options sheet has «عندي غراض» with three calm chips (any, all or none) and «نگول للسايق قبل لا
يقبل، والسعر ما يتغيّر». The options row then reads «… · غراض: قنينة غاز», and the tuktuk row shows
«الأنسب للغراض» (a bag icon, accent) — a hint only, the chosen vehicle never changes by itself. The
choice lasts for this booking (a new booking from home starts empty).

## Data

`orders.ride_cargo` (migration `20261008024000_ride_step4_ac_and_cargo`): `TEXT[] DEFAULT '{}'`,
`CHECK (ride_cargo <@ ARRAY['bags','gas','big'])`.

## Demo

Partner demo (`apps/partner/scripts/demo/98-souq.mjs`): `POST /demo/souq-offer?who=tuktuk|taxi` — a
ride for him whose rider carries bags and a gas cylinder; `POST /demo/souq-job?who=…` — the same,
accepted. Shots: partner `SHOTS=souq` (`offer-cargo`, `job-cargo`), customer `ride` group
(`ride-cargo`, `ride-cargo-hint`).
