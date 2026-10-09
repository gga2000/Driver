# «شنو سيارتك؟» — the driver's own car under the seats (2026-10-07)

Ali, 2026-10-07: the rider should see the driver's real car when he picks a seat on a Baghdad/Kut
run ("when we register a new driver and select his car it shows his car here"), drawn in the
Date & Saffron style. Since 2026-10-09 that picture is one flat saloon (see the end of this page).

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
- Customer, احجز مقعدك, and the partner garage page: `CarSeatArt` (`packages/ui`) and `CarArtSeats` lay the
  seats on one flat top-down saloon in date brown and saffron, the same for every 4-seat car
  (`apps/<app>/src/features/*/car-art*.ts`, picture `assets/cars/sedan.webp`). 6- and 7-seat runs show
  the drawn `SeatMap` of the same layout. Same selection rules, rejections, haptics and spoken labels as
  `SeatMap`.

## The flat car (partner check-up item 5, Ali 2026-10-09)
The painted, glossy Elantra was replaced by a flat drawing: no glossy pictures, and the model no
longer changes the picture (the model's name still shows in words on the band and the pass).
`scripts/art/flat-car.py` draws it (Pillow) and writes the same file to both apps; a test keeps the
two apps' pictures and seat points equal. A flat van for 6 and 7 seats would be added the same way:
draw it, add its points to `CAR_ART_LAYOUTS` under its layout and its `require` to `CAR_PICTURES`.
