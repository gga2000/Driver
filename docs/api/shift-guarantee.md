# Shift guarantee "ضمان الشفت" (G-91) — built, **switched off** (Ali, 2026-10-06)

> **Status: switched off.** Built and tested on 2026-10-06 to be counted and paid by the server, then
> Ali said the same day "hold it, switch it off" until he decides. It is an **open decision**. The switch
> is the money rule `MoneyRules.guarantee.enabled`, now `false` for Aziziyah and `false` by default for
> any city. While it is off:
> - the server pays **no** top-up (the Sunday run's `settle` posts nothing) and covers nobody;
> - `driverAccount.guarantee` returns `enabled: false`, `current: null`, `week: []`, `pendingIqd: 0`, and
>   `driverAccount.shiftSummary` returns `guarantee: []`;
> - the Partner app shows **no** progress, pending or paid guarantee line (job end, shift summary,
>   earnings tab), so nothing promises money; the demo API posts no top-ups;
> - the simulator invariant `shift_guarantee_once_and_exact` asserts that nothing is paid to anyone.
>
> Turning it on is the one-line config change `enabled: true` (after Ali decides, together with the
> readings at the end of this page); the enabled path stays covered by unit tests
> (`apps/api/src/modules/ledger/guarantee.test.ts`, `driver-account.service.test.ts`).
>
> Everything below describes the rule **as it works when switched on**.

Rule: money & ops spec §2 ("10,000 per 4-hour peak shift at ≥ 85% acceptance, topped up by platform"),
edge-case review #91 (≥ 85 % acceptance **and** ≤ 1 cancel after accept **and** ≥ 3 completed jobs in the
shift; paid Sunday with the scorecard, not nightly). Ali decided on 2026-10-06 that the server pays it,
then switched it off the same day until he decides (see the status above).
Config: `MoneyRules.guarantee` (`packages/contracts/src/ledger-rules.ts`). Shared rule:
`packages/contracts/src/shift-guarantee.ts` (`peakWindows`, `shiftGuarantee`), used by the API and the
simulator. Server: `apps/api/src/modules/ledger/guarantee.ts` (`ShiftGuaranteeService`).

## Config (`MoneyRules.guarantee`, Aziziyah)
| Field | Value | Meaning |
|---|---|---|
| `enabled` | **`false`** (switched off by Ali, 2026-10-06; schema default `false`) | The city's switch. Off → nobody is covered or qualifies, nothing is paid, nothing is shown. |
| `amountIqd` | 10,000 | What a qualified shift is topped up to. |
| `minAcceptance` | 0.85 | Accepted ÷ offers answered or let expire in the shift. Compared in whole basis points, so exactly 85 % passes. |
| `maxCancelsAfterAccept` | 1 | Jobs he cancelled after accepting, in the shift. |
| `minCompletedJobs` | 3 | Trips he completed in the shift (a batched trip is one job). |
| `peaks` | lunch 12:00–16:00, dinner 19:00–23:00 | Peak shifts on the Baghdad clock (`[start, end)`, one local day). The 4 hours around the city peaks of edge-case review #21 (13:00–15:00, 19:30–22:30). |
| `roles` | `['courier']` | Cap roles covered (money §2 / §5 "courier shift guarantees"). A car or tuktuk driver who also delivers is capped as `driver` and is not covered. |

## What one shift counts
For each peak shift (id `2026-10-04:lunch`):
- **Offers** — his own `trip.accepted` / `trip.declined` / `trip.timed_out` events in `[from, to)` (dispatch
  records an expired offer under his id). Quarantined late replays never count. No offers → not qualified.
- **Cancels after accept** — his `trip.cancelled` events with `by: 'driver'` in the shift.
- **Completed jobs** — trips whose `trip.completed` falls in the shift and whose last `trip.accepted` is his
  (a customer's "وصلت" completes his ride too). The accept may be up to 12 h before the shift.
- **Earnings** — his `driver:` ledger lines for those trips, whenever they posted (a wallet order's money
  posts at close, after the shift): pay, extras, incentives and tips, less the platform's take
  (`commission_accrued`). Penalties are not added back (no top-up of a fine), settlements are not earnings,
  and an earlier guarantee line never counts.
- **Top-up** = `max(0, amountIqd − earnings)` when all three conditions hold, else 0.

## Payment (ledger)
- The Sunday run of the nightly close (02:00 Baghdad, `NightlyJob`) calls `settleWeek`: every covered
  driver's shifts that started in the 14 days before this Sunday 00:00 and are over. It runs **before** the
  per-driver payout figures, so the top-up goes out with the weekly payout (G-86). Never on other nights.
- Each top-up is one money group `incentive:guarantee:<driverId>:<shiftId>` with one line
  `driver_incentive`, `platform` → `driver:<id>`, memo `guarantee:<shiftId>`, dated at the run. The group
  id makes it once per driver per shift, ever: a re-run (manual "run nightly" on a Sunday, or next
  Sunday re-checking the week before) posts nothing twice; a missed Sunday pays the week late, not never.
- The report (`ledger.runNightly` → `NightlyReport.guaranteePaid`) lists what that run posted. A failure
  opens a `guarantee_settlement_failed` incident and the close goes on (books checked, payouts listed).
- Earnings (`driverAccount.earnings`) already count these lines as `guaranteeTopUpsIqd` ("تكملة ضمان
  الشفت"); receipts give the reason `guarantee`.

## Reads
- `driverAccount.guarantee` (driving roles, own data) → `GuaranteeView`: `enabled` (switch on and his role
  covered), the rule numbers, `current` (the live shift or null), `week` (this week's shifts, newest
  first), `pendingIqd` (ended, qualified, not yet paid — including last week's before the Sunday run).
- `driverAccount.shiftSummary` → `guarantee`: the peak shifts the shift overlapped.
- Each `GuaranteeWindowView`: `id`, `peak`, `from`, `to`, `status` (`live` | `ended` | `paid`), `offers`,
  `accepted`, `acceptance`, `cancelsAfterAccept`, `completedJobs`, `earningsIqd`, `meets`, `qualified`,
  `jobsToGo`, `topUpIqd` (live/ended: what the rule gives now; paid: what was paid), `paysOn` (the Sunday),
  `rule` (the numbers it was judged by).

## Partner app
- Job end (audit S-3): under the day ring, one line for the live shift — "باقي طلبين على ضمان شفت الغدا:
  10,000 دينار", or the condition at risk (acceptance below 85 %, cancels over the limit), or "ضمنت شفت
  الغدا: إذا ما وصلت 10,000 دينار لحد 4:00 م نكمّلها لك يوم الأحد". Nothing outside a peak shift or when
  not covered. Copy `partner.guarantee_*`; logic `apps/partner/src/features/work/guarantee-logic.ts`.
- Shift summary (S-4): "ضمان الشفت" card with each overlapped shift that has something to say (earned and
  paid on Sunday, paid, or live progress).
- Earnings tab: "ضمان الشفت: 6,500 دينار تنزل بحسابك يوم الأحد" while top-ups wait for the Sunday run.

## Simulator
`shift_guarantee_once_and_exact`, switched off (today): no `guarantee:` top-up for any driver in any peak
shift of the day and nobody covered — it checks every driver who answered an offer against every settled
peak shift. Switched on: it recounts every covered courier's peak shift from the trips, offer answers and
ledger rows after the day is settled: at most one platform-funded top-up per driver per shift, only to
covered drivers who met the conditions, equal to `max(0, 10,000 − earnings)` (`pnpm sim --orders 500 --seed
1 --ci` with it on, 2026-10-06: 3 top-ups, 24,500 دينار). The report's "Shift-guarantee top-ups" row says
"switched off".

## Readings chosen where the rule was silent (conservative; for Ali)
1. Peak shifts are 12:00–16:00 and 19:00–23:00 (the 4 hours around the review #21 peaks). The specs name
   peaks but no 4-hour shift times.
2. Couriers only (money §2 is the courier section; §5 says "courier shift guarantees"). Car/tuktuk
   drivers who also deliver are not covered. Config `roles`.
3. No minimum online time inside the shift: the rule names only the three conditions. A courier who comes
   online late and still does 3 jobs at ≥ 85 % qualifies (open question for Ali: require being online the
   whole shift?). The presence log has no history to check it yet.
4. "Offers seen" = offers he accepted, declined or let time out; an offer withdrawn because another driver
   took it first is not counted. No offers in the shift → not qualified.
5. Earnings count tips and incentives and subtract the platform's take; penalties are not added back.
6. A completed job counts in the shift where it completed (not where it was accepted).

## Follow-up
- "Switches off per zone when average shift earnings exceed it" (money §2): not built. It needs a zone for
  each courier's shift and a rolling per-zone average; today there is only the city switch
  (`MoneyRules.guarantee.enabled`).
