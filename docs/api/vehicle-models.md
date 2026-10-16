# «شنو سيارتك؟» — the driver's own car under the seats (2026-10-07)

Ali, 2026-10-07: the rider should see the driver's real car when he picks a seat on a Baghdad/Kut
run ("when we register a new driver and select his car it shows his car here"), drawn in the
Date & Saffron style (the AI-painted Hyundai Elantra he approved).

## The list (`packages/contracts/src/vehicle-models.ts`)

| Key | Name (ar-IQ) | Seat layout |
|---|---|---|
| `elantra` | النترا | 4 |
| `corolla` | كورولا | 4 |
| `cerato` | سيراتو | 4 |
| `sonata` | سوناتا | 4 |
| `accent` | أكسنت | 4 |
| `tahoe` | تاهو | 6 (captain chairs) |
| `gmc` | جمسي | 7 (bench middle row) |
| `starex` | ستاركس | 7 |
| `other` | غيرها, the driver types the name | any |

## Procedures
- `routes.announce` takes `vehicle.modelKey` (optional for older clients). The input is refused when the
  model can't carry the layout (an Elantra as a 7-seat van) or when `other` comes without `vehicle.model`.
- The run stores `modelKey` in `departures.vehicle_snapshot` (JSON, no migration); `model` holds the
  Iraqi name of a listed model (`vehicle.model_<key>`), or the typed name for `other`, so pushes, SOS and
  share pages keep reading `model`. Runs announced before the list read `modelKey: null`.
- Every `IntercityVehicle` the API returns (board, booking, pass, request offers) carries `modelKey`.

## Apps
- Partner, أعلن طلعة: «شنو سيارتك؟» lists the models that fit the chosen seat layout (`other` last, with
  a name field), prefilled from his last run. Required: no model, no announce.
- Customer, احجز مقعدك: `CarSeatArt` (`packages/ui`) lays the seat buttons on the car's picture when the
  run's model has one (`apps/customer/src/features/rajaa/car-art*.ts`); otherwise the drawn `SeatMap` of
  the same layout. Same selection rules, rejections, haptics and spoken labels as `SeatMap`.

## Adding a car picture
Top-down painting, front up, driver on the left, flat cream backdrop, 2:3. Put it at
`apps/customer/assets/cars/<key>.webp`, add its seat points (percent of the picture) to
`CAR_ART_LAYOUTS` and its `require` to `CAR_PICTURES`. `car-art.test.ts` checks every seat of the
layout has a point inside the picture. Today only `elantra` has a picture; the other cars were
generated and wait for Ali's pick.
