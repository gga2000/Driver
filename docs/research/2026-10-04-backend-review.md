# Backend review — wave 2 (partner, merchant, driver-account, khat, fleet, ops, merchant-admin, promotions)

Date: 2026-10-04. Scope: `git diff a9b3cb6..HEAD -- apps/api packages/contracts packages/db` (HEAD e15df39).
Read against `docs/architecture.md`, `docs/specs/2026-10-03-edge-case-decisions.md`,
`docs/specs/2026-10-02-money-and-ops.md`, `docs/specs/2026-10-02-scoring-and-safety.md`,
`docs/api/partner-merchant-wave2.md`.

Each finding: severity, where, what, fix, proof test. Status `fixed` means a failing test was written
first, then the fix made it pass. `documented` means the fix is outside this pass (large, or in an area
other agents are changing) and is left as a follow-up.

Severity: **High** = money or another person's data reachable by a normal client; **Medium** = a
safety/state rule bypassable or a narrower leak; **Low** = hygiene with a real but small impact.

## Findings

| # | Sev | Area | Status |
|---|---|---|---|
| 1 | High | ops cash receipts: race, duplicate reference | in progress |
| 2 | High | fleet.addDriver: any phone → name, earnings, cash, documents | in progress |
| 3 | High | ledger.merchantBalance / requestSettlement open to merchant staff | in progress |
| 4 | Medium | khat tap-out without tap-in fires the guardian's "arrived" push | in progress |
| 5 | Medium | online gate: heartbeat grace never ends | in progress |
| 6 | Medium | merchantAdmin.staffInvite: phone → full name oracle | in progress |
| 7 | Medium | driverAccount.reviewDocument: reviewer approves own document | in progress |
| 8 | Medium | handover code brute-force (4 digits, no attempt limit) | in progress |
| 9 | Medium | double "اطلب فلوسك" opens two requests / two assignments | in progress |
| 10 | Low | merchantAdmin.insights: staff see sales money (bestSellers.salesIqd) | in progress |
| 11 | Medium (perf) | OrdersService.merchantOrders loads every order of the merchant | documented |
| 12 | Low | menu import applied twice concurrently duplicates items | documented |

Details follow as each is fixed.
