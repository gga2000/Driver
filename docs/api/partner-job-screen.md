# Partner job screen — step 3 of the redesign (j1–j10, d1–d4, r1, r5–r8, f7, b4–b6, b8, b11)

## API: one new read-only field

| Field | Type | What it is |
|---|---|---|
| `partner.activeJob` → `stops[].landmark` | `string \| null` | j2: the nearest public town landmark (garages and meeting points from `AZIZIYAH_LANDMARKS`) within 600 m of the stop's pin, its Arabic name; the same rule as the offer's `pickup.landmark` (`docs/api/partner-offer-slip.md`). Defaults to `null`. At a saved place the landmark the customer chose (`door.landmark`) wins. |

Nothing else changes on the server: no money rule, no dispatch rule, no new procedure.

## Client (`apps/partner`)

- `app/job.tsx`: the step rail (المطعم · الاستلام · الزبون · التسليم; for rides الراكب · الركوب · بالطريق ·
  النزول), the customer's own words as the headline at a door («باب أخضر…», then the place's note), the
  pickup code at 40 px with a full-screen view at full brightness (`src/lib/brightness*.ts`,
  `expo-brightness`, this app's window only), the kitchen's live ready bar, the rider-waiting clock
  (display only), and the four actions (اتصال «قريباً» · رسالة · الخريطة · مشكلة) right above the main
  button. The kitchen-not-ready warning sits above the slide, not inside it. «وصلت» is a dark button
  that turns saffron once he has stood at the stop (60 m, 10 s); the old "وصلت؟" sheet is gone. Each
  step is read aloud once when it begins (the offer's read-aloud switch).
- `src/features/work/job-steps.ts`: the pure rules (rail stage, door hint, spoken line, waiting clock,
  quick replies per step), tested in `job-steps.test.ts`.
- `src/features/safety/SosControl.tsx`: a shield instead of the red «طوارئ» pill on every trip screen. It
  opens one sheet: hold 3 s to alert the team (the same `safety.sos`), share the location, call 911,
  the emergency contact. After an alert the confirmation sheet is drawn in the ember night palette.
- Done screen: «تسلم إيدك», a soft bell (`assets/sounds/done.wav`, `playDoneTink`), no cash card (cash
  waits for home); "الخردة علينا" stays as one green line. At the door the change to give back is shown
  at 44 px in green.
- Chat: the quick replies are the ones true at this step (at most three), wrapped instead of a sideways
  scroll (`ChatThread`'s new optional `wrapQuickReplies`; the customer app is unchanged).
- Shift summary: with no orders in the shift, the cash to hand in says it comes from before the shift.

Shots: `SHOTS=job node scripts/web-shots.mjs <dir>` (`scripts/shots/25-job.mjs`).
