# Partner redesign step 4 — خطوط mornings and «هيج يشوفك الزبون» (k1–k3, r3, r4)

## API

| Field / procedure | Type | What it is |
|---|---|---|
| `khat.todayRun` → `trips[].stops[].landmark` | `string \| null` | k2: the public town landmark (garages and meeting points from `AZIZIYAH_LANDMARKS`) within 600 m of the stop's pin, its Arabic name — the same rule as the partner offer and job (`apps/api/src/shared/landmarks.ts`). Never the child's address. Defaults to `null`. |
| `driverAccount.publicProfile` | query → `DriverProfile` | r4: the profile a rider opens on his photo (`tracking.driverProfile`), built by the same code for the driver himself. No plate (riders see it only once he is their driver). Driving roles only. |

No money rule, dispatch rule or migration changes.

## Client (`apps/partner`)

- `app/khat/index.tsx` + `NextChildCard` (`src/features/khat/KhatParts.tsx`): the one child to look for
  now, big at the top — the guardian's photo or the initial (k1; the demo seeds no drawn faces unless
  `/demo/khat/seed?photos=1`), the landmark the door is near, «الموعد 1:20 ص · بعد 6 دقيقة», then a big
  «بالسيارة» (or «نزول» at the school) with «غياب اليوم» beside it and the guardian call (k3). The rule is
  `nextChild()` in `src/features/khat/logic.ts`. The run's list marks that child «الجاي»; the other
  children keep their own buttons. The sweep (k4) is unchanged.
- `app/seen.tsx` «هيج يشوفك الزبون» (account tab, first row): the rider's sheet as riders see it, then
  what would make it better (photo waiting/missing, car features waiting for the car check, every
  compliment).
- r3 (AC / heating on his profile, confirmed at the car check) already exists: «مميزات سيارتك».
- Avatars in the partner palette: `createTheme` derives the four avatar tones from an app palette, so a
  monogram is never the base palette's blue.

Shots: `SHOTS=khat,seen node scripts/web-shots.mjs <dir>`.

Waiting for the Baghdad/Kut PR (#8), which changes the garage and seat screens: i1 garage board, i2
car from above (its `CarSeatArt`), i3/i4/b7 seats, f1 on the road. i5–i7 need server rules (flagged).
