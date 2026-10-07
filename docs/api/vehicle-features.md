# Vehicle details and tags (taxi/tuktuk step 3, 2026-10-07)

What a rider sees about the car (Ali's ride ideas d1, n1, n2): the model with a dot of its real
colour, and what it offers — «مكيّفة» and «تدفئة» loud (coloured, first), «عوائل», «ممنوع التدخين»,
«صندوق كبير», «مقعد طفل» quiet. The driver says what his car offers in the partner app; ops confirm it
at the car check in the Console; **customers only ever see confirmed features**. On very hot or cold
days (`climateAt`) dispatch offers rides to cars with confirmed AC / heating first (no price change) —
that ranking is the dispatch worker's part of step 3. Step 4 (x1, docs/api/climate-check.md): ride drivers confirm
their AC (heating) works once a shift; a «لا» hides that tag from riders and dispatch until the shift
ends, and a hot day's taxi ride goes first only to cars with working AC.

Shared contracts: `packages/contracts/src/vehicle-features.ts` (`VehicleColour`, `VEHICLE_COLOUR_HEX`,
`vehicleColourKey`, `VehicleFeature`, `LOUD_FEATURES`, `sortFeatures`, `climateAt`, `isNightAt`) and
`CLASS_FEATURES` in `fleet-io.ts`.

## Data

`vehicles` (migration `20261007230500_vehicle_features`, additive):

| Column | Type | Meaning |
|---|---|---|
| `model` | text, null | "تويوتا كورولا" as the fleet owner typed it (2–40 characters) |
| `colour` | text, null | one of `VehicleColour` (check constraint) |
| `features` | text[] `{}` | the driver's claims (check: known features only) |
| `features_confirmed` | text[] `{}` | what ops confirmed at the car check; the database keeps it a subset of `features` |

What each kind of vehicle can offer (`CLASS_FEATURES`): a bike nothing; a tuktuk `family`,
`no_smoking`, `child_seat`; cars, SUVs, vans and الرجعة cars all six.

## The courier card (`orders.track` → `courier`)

`CourierCard` gains (all additive, with defaults for older payloads):

| Field | Meaning |
|---|---|
| `vehicleModel` | the registry's model; null when unknown |
| `vehicleColour` | `VehicleColour \| null` — draw it with `VEHICLE_COLOUR_HEX`, name it with `vehicle.colour.<key>` |
| `features` | **confirmed** features only, in display order (`sortFeatures`: AC, heating, then the quiet ones) |
| `tripCount` | his completed trips on every vertical (`trips.completedCountFor`), read once per card like the rating |
| `vehicleLabel` | kept for older screens: "model · Arabic colour name" («تويوتا كورولا · أبيض»), the model alone without a colour, null without a model |

The share page (`tracking.shared`) carries `vehicleModel` and `vehicleColour` beside `vehicleLabel`
(a الرجعة seat's colour only when the garage form's text names one of ours); never the features.

## `fleet.myVehicle` (query, driving roles)

The vehicle he is the active driver of — a fleet's or his own — as `FleetVehicle` (now with `model`,
`colour`, `features` (claimed) and `featuresConfirmed`), or `null` when none is registered.

## `fleet.setMyVehicleFeatures` (mutation, driving roles)

`{ features: VehicleFeature[] }` → `FleetVehicle`. «مميزات سيارتك»: the full set he claims now.

- A feature his kind of vehicle cannot offer → `vehicle_feature_not_offered` (AC on a tuktuk). No
  vehicle → `vehicle_not_found`.
- New claims wait for the car check (the partner app shows «بانتظار التأكيد»). A feature he takes off
  loses its confirmation at once, so riders never see something he no longer offers; claiming it again
  needs a new check.
- Emits `fleet.vehicle_features_claimed` `{vehicleId, added, removed}` on the `vehicle` aggregate when
  the set changed.

## The car check (Console approvals)

- **`fleet_vehicle`** (a fleet owner's new vehicle): the item now lists the model and colour in its
  facts and the driver's claims in `features: [{feature, confirmed}]`. Approving takes
  `confirmFeatures` — the claims ops saw (absent = all of them); claims not seen are cleared.
- **`vehicle_features`** (new kind, «مميزات سيارة»; roles `field_ops`, `support`, `admin`): verified,
  active vehicles whose driver claimed something not yet confirmed, longest-waiting first. Title
  "model · plate", subtitle the waiting features, submitted by the driver. Approve with
  `confirmFeatures` (absent = every claim) confirms those and clears the rest; reject (reason ≥ 3
  characters, presets «الميزة مو موجودة بالسيارة», «المبردة أو الهيتر ما يشتغل») clears every claim still
  waiting and keeps the confirmed ones. Nobody checks his own car or his fleet's (`approval_own_item`);
  nothing waiting → `approval_state_conflict`. Emits `fleet.vehicle_features_checked`
  `{vehicleId, plate, confirmed, cleared, reason}`; the Console audit log reads «أكّد مميزات واسط 61207:
  مكيّفة، تدفئة».

`DecideApprovalInput.confirmFeatures?: VehicleFeature[]`; `ApprovalItem.features` defaults to `[]` for
the other kinds.

## Apps

- **Partner:** «سيارة جديدة» asks for the model (required for cars, optional for a tuktuk, hidden for a
  bike) and the colour (13 swatches of real paint with their Iraqi names; not for a bike). The fleet's
  vehicle list shows "model · colour" with the dot. الحساب has a «مميزات سيارتك» row (cars and tuktuks)
  opening `/vehicle`: the car with its colour and plate, «الحر والبرد» (AC icy, heating warm), then the
  quiet ones; each saved tick says «متأكدين منها» or «بانتظار التأكيد»; loading, error, offline,
  no-vehicle and bike states.
- **Console:** the approvals detail shows a «المميزات اللي يگول عليها السايق» box — one checkbox per
  claim, all ticked to start, each marked «متأكدين منها من قبل» or «جديدة».

## Demo

- Customer demo (`apps/customer/scripts/demo-api.mjs`): the ride drivers have real cars — a silver
  هيونداي النترا (AC, families), a white تويوتا كورولا (AC), a black هيونداي سوناتا (heating, no
  smoking), a white تويوتا كامري (AC, big boot) and three باجاج tuktuks with none.
- Partner demo: `0770 111 0002` (tuktuk, a blue باجاج: «ممنوع التدخين» confirmed, «عوائل» waiting),
  `0770 111 0003` (a black هيونداي سوناتا: AC and no smoking confirmed, heating waiting); the fleet's
  cars carry models and colours, and مصطفى كريم's تويوتا كورولا has AC confirmed and families waiting.
- Console demo: the simulator's cars and tuktuks have models and colours; two cars wait in
  «مميزات سيارات» (AC on a كورولا; heating and a big boot on an النترا).
