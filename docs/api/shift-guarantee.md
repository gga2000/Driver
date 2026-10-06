# Shift guarantee "ضمان الشفت" (G-91) — built, **switched off** (Ali, 2026-10-06)

> **Status: switched off.** Built and tested on 2026-10-06 to be counted and paid by the server, then
> Ali said the same day "hold it, switch it off" until he decides. It is an **open decision**. The switch
> is the money rule `MoneyRules.guarantee.enabled`, now `false` for Aziziyah and `false` by default for
> any city. While it is off:
> - the server pays **no** top-up (the Sunday run's `settle` posts nothing) and covers nobody;
> - `driverAccount.guarantee` returns `enabled: false`, `current: null`, `week: []`, `pendingIqd: 0`, and
>   `driverAccount.shiftSummary` returns `guarantee: []`;
> - the Partner app shows **no** progress, pending or paid guarantee line (job end, shift summary,
>   earnings tab), so nothing promises money; the demo API posts no top-ups (its `guarantee-pending`
>   hook switches it on inside the demo only, to look at the lines);
> - the simulator invariant `shift_guarantee_once_and_exact` asserts that nothing is paid to anyone.
>
> Turning it on is the one-line config change `enabled: true` (after Ali decides, together with the
> readings at the end of this page); the enabled path stays covered by unit tests
> (`apps/api/src/modules/ledger/guarantee.test.ts`, `driver-account.service.test.ts`).
>
> **Shifts (Ali, 2026-10-06):** the first shift 06:00–15:00 and the second 15:00–02:00 the next morning,
> Baghdad time. Still switched off until he decides the rest.
>
> Everything below describes the rule **as it works when switched on**.

Rule: money & ops spec §2 ("10,000 per 4-hour peak shift at ≥ 85% acceptance, topped up by platform";
Ali replaced the 4-hour peaks with his two shifts on 2026-10-06),
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
| `peaks` | `day` 06:00–15:00 «شفت النهار», `evening` 15:00–02:00 «شفت الليل» (Ali, 2026-10-06) | The shifts on the Baghdad clock, `[start, end)` in minutes after the local midnight of the day the shift starts: `evening` is `{ startMin: 900, endMin: 1560 }` (26 × 60), past midnight. A shift is at most 24 h; the rules refuse overlapping shifts and repeated keys. Together they cover 06:00–02:00; 02:00–06:00 is in no shift. |
| `roles` | `['courier']` | Cap roles covered (money §2 / §5 "courier shift guarantees"). A car or tuktuk driver who also delivers is capped as `driver` and is not covered. |

## Shifts past midnight
- A shift belongs to the local date it **starts** on: the evening shift of Sunday 4 Oct is
  `2026-10-04:evening`, from Sunday 15:00 to Monday 02:00 (12:00Z–23:00Z). Its memo is
  `guarantee:2026-10-04:evening`.
- So a job at 00:30 Monday counts in Sunday's evening shift; 02:00:00 is outside it (the end is
  excluded), and 02:00–06:00 belongs to no shift. At 15:00 sharp the evening shift starts and the day
  shift is over.
- Window lists (`peakWindows`) look one day back, so a read that starts after midnight (the live
  shift at 00:30, a work shift that began at 01:00) still finds the shift running into it.
- A Saturday's evening shift belongs to the week it started in and pays on the Sunday it runs into
  (`paysOn`); see Payment for the 02:00 boundary.

## What one shift counts
For each shift (id `2026-10-04:day`):
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
  driver's shifts that **started** in the 14 days before this Sunday 00:00 and are **over by the run**
  (a shift is over at its end, even when that is after Sunday 00:00). It runs **before** the per-driver
  payout figures, so the top-up goes out with the weekly payout (G-86). Never on other nights.
- **The 02:00 boundary:** the Saturday evening shift ends at Sunday 02:00:00, the minute of the run. The
  run at 02:00:00 (or later) pays it — its jobs are counted up to 01:59:59.999, the end excluded. A
  Sunday run before 02:00 (e.g. a manual one at 01:00) leaves it, and the next Sunday's run pays it (the
  14-day re-check), once. Shifts that start on Sunday wait for the next Sunday. Covered by
  `guarantee.test.ts` ("the Sunday 02:00 boundary").
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
  covered), the rule numbers, `current` (the live shift or null — at 00:30 yesterday's evening shift),
  `week` (shifts that started this week, newest first), `pendingIqd` (ended, qualified, not yet paid,
  started since last week's Sunday — what the next Sunday run pays, including last week's before it).
- `driverAccount.shiftSummary` → `guarantee`: the guarantee shifts his work shift overlapped.
- Each `GuaranteeWindowView`: `id`, `peak`, `from`, `to`, `status` (`live` | `ended` | `paid`), `offers`,
  `accepted`, `acceptance`, `cancelsAfterAccept`, `completedJobs`, `earningsIqd`, `meets`, `qualified`,
  `jobsToGo`, `topUpIqd` (live/ended: what the rule gives now; paid: what was paid), `paysOn` (the Sunday),
  `rule` (the numbers it was judged by).

## Partner app
- Job end (audit S-3): under the day ring, one line for the live shift — "باقي طلبين على ضمان شفت النهار:
  10,000 دينار", or the condition at risk (acceptance below 85 %, cancels over the limit), or "ضمنت شفت
  الليل: إذا ما وصلت 10,000 دينار لحد 2:00 ص نكمّلها لك يوم الأحد". Shift names: `day` «شفت النهار»,
  `evening` «شفت الليل», any other «الشفت». Nothing outside a shift or when not covered. Copy `partner.guarantee_*`; logic `apps/partner/src/features/work/guarantee-logic.ts`.
- Shift summary (S-4): "ضمان الشفت" card with each overlapped shift that has something to say (earned and
  paid on Sunday, paid, or live progress).
- Earnings tab: "ضمان الشفت: 6,500 دينار تنزل بحسابك يوم الأحد" while top-ups wait for the Sunday run.
- Demo: `POST /demo/account/guarantee-pending` (partner demo API, `?who=courier` by default) switches the
  guarantee on **inside the demo API only** and seeds a finished qualifying shift, so these lines can be
  looked at while the city rule is off (`apps/partner/README.md`).

## Simulator
`shift_guarantee_once_and_exact`, switched off (today): no `guarantee:` top-up for any driver in any shift
of the day and nobody covered — it checks every driver who answered an offer against every settled shift.
The settled shifts are the two that start on the simulated day (the simulated day runs 10:00–24:00; the
in-process run moves its clock to 02:00 before the settlement so the evening shift is over). Switched on: it recounts every covered courier's shift from the trips, offer answers and
ledger rows after the day is settled: at most one platform-funded top-up per driver per shift, only to
covered drivers who met the conditions, equal to `max(0, 10,000 − earnings)` (`pnpm sim --orders 500 --seed
1 --ci` with it on and Ali's shifts, 2026-10-06: 3 top-ups, 23,000 دينار, 20/20 invariants). The report's "Shift-guarantee top-ups" row says
"switched off".

## Readings chosen where the rule was silent (conservative; for Ali)
1. ~~Peak shifts 12:00–16:00 and 19:00–23:00~~ — decided by Ali on 2026-10-06: 06:00–15:00 and
   15:00–02:00. **Open:** the 10,000 amount was set for a 4-hour shift; these are 9 and 11 hours, so the
   amount (and perhaps the 3-job minimum) may need to change. Not changed.
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
