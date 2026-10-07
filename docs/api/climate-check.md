# Cold car in summer: «المكيّفة شغالة اليوم؟» and AC cars first (ride idea x1, 2026-10-07)

Ali's idea x1 (voted yes): drivers confirm their AC works each shift; on hot days the app shows the
heat and sends only «مكيّفة» cars. Built for heating on cold days too (the same rule, see the end).
There is no weather feed: hot and cold are Aziziyah's calendar and clock (`climateAt`,
`packages/contracts/src/vehicle-features.ts`): hot on summer afternoons (May–Sep, 10:00–19:59), cold all
winter (Dec–Feb) and on Nov/Mar nights. **No price changes.**

Shared contracts: `packages/contracts/src/climate-check.ts` (`ClimateFeature`, `CLIMATE_CHECK_RULES`,
`climateShiftAt`, `shiftIdAt`, `PartnerClimateCheck`, `AnswerClimateCheckInput`) and
`CLIMATE_DISPATCH_RULES` in `dispatch-io.ts`.

## The shift question

A shift is one of Aziziyah's two (Ali, 2026-10-06, the same as the shift guarantee's): 06:00–15:00
(`day`) and 15:00–02:00 (`evening`), ids like `2026-07-14:day`. Between 02:00 and 06:00 there is none.

`climateShiftAt(now)` is the shift we are in when it still has a hot (cold) hour ahead — a July
morning at 07:00 is asked already, because the afternoon heat comes in the same shift; a July evening
at 20:30 is not. The feature asked about follows the climate: AC when hot, heating when cold.

### `partner.status` → `climateCheck: PartnerClimateCheck | null`

| Field | Meaning |
|---|---|
| `feature` | `ac` or `heating` |
| `climate` | `hot` or `cold` |
| `shiftId` | the shift the answer belongs to |
| `endsAt` | when the shift (and the answer) ends |
| `working` | his answer this shift: `true`, `false`, or `null` until he answers |

Present only while he is **online**, holds the **driver** role on a **car** (his roles serve taxi rides
on it — couriers and tuktuks are never asked), and ops **confirmed** that feature at the car check (the
fleet registry's `features_confirmed`; a claim still waiting is not asked about). Otherwise null.

### `partner.answerClimateCheck({ working })` → `PartnerStatus` (driver role)

- Stores his answer for this shift (`driver_shift_checks`, one row per driver × shift × feature); a
  later answer in the same shift replaces it (it broke at noon, it was fixed by four).
- `climate_check_none` (CONFLICT) when no question stands for him now (offline, mild shift, no confirmed
  feature, not a ride car).

### What «لا» does

For the rest of that shift the feature is taken off his car everywhere riders and dispatch read it:
`VehicleFactsPort` (dispatch ranking n6, the first waves below, the offered-drivers list n3, the driver
profile n5) and the courier card (`orders.track` → `courier.features`). The next shift starts clean.
No answer = the car check stands (he still counts as an AC car). «إي» changes nothing.

## Dispatch: the first waves go to cars with working AC

On a hot (cold) day a **taxi** ride's first `CLIMATE_DISPATCH_RULES.onlyWaves = 2` waves go only to
cars whose AC (heating) is confirmed and not said off this shift. With the default waves that is
3 such cars for 15 s, then 5 more for 15 s; the third wave (everyone left, 30 s) is open to all, with
those cars still first (n6), then the re-broadcast at 60 s as always. Whatever the city's wave config,
the last wave is never narrowed. An empty narrowed wave opens the next one at once, so with no AC car
free the ride goes to everyone immediately — nobody waits for a car that isn't there.

- Tuktuk rides, food and the other verticals are untouched (tuktuks offer neither).
- «عوائل» (s6) still narrows the first wave, inside the AC cars; with no family-fit AC car the first
  wave is the AC cars.
- `dispatch.wave_sent` carries `only: 'ac' | 'heating'` on a narrowed wave.

## Apps

- **Customer** (choose screen, a ride for now with the car chosen): on the server's clock (the nearby
  read's `at`), a small line under the vehicles — «اليوم حار، نبعثلك سيارة مكيّفة» (snow icon, cool
  tint) or «اليوم برد، نبعثلك سيارة بيها تدفئة» (flame, warm tint). Information only.
- **Partner** (home, while online): the card «المكيّفة شغالة اليوم؟» / «التدفئة شغالة اليوم؟» with
  «اليوم حار، ركاب السيارات نبعثهم للمكيّفة أول» and two buttons «إي، شغالة» / «لا، عاطلة». After
  «لا»: a quiet line «المكيّفة عاطلة بهالشفت، ما نبيّنها للركاب» with «رجعت تشتغل». After «إي»: nothing.

## Heating on cold days

Symmetric and cheap, so built: the same table, the same question with «التدفئة», the same waves rule
with `heating`, the cold-day line on the choose screen.

## Data

`driver_shift_checks` (migration `20261008024000_ride_step4_ac_and_cargo`, owned by dispatch):
`driver_id`, `shift_id`, `feature` (`ac` | `heating`, checked), `working`, `answered_at`; a cuid `id`, unique
(driver, shift, feature); index on (shift, working). Ids only — no personal data.

## Demo

Partner demo (`apps/partner/scripts/demo/98-souq.mjs`): taxi `0770 111 0017` (a white تويوتا كورولا
with AC and «عوائل» confirmed, checked in). `POST /demo/weather?at=hot|cold|real` moves only the
shift question's clock to a July / January day (dispatch keeps the real one). Shots: `SHOTS=souq`
(partner), `ride-choose-hot` in the customer `ride` group (the app's server-corrected clock moved to a
July afternoon).
