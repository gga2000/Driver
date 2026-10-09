# A second OK on refunds over a limit

Ali, 2026-10-08 (Console item 4): a refund over a staff limit needs a second staff member's OK before
it goes through. The limits are the existing ones. Only what happens at the limit changes: before, the
refund was refused; now it waits.

| Limit | Who it applies to | Where |
|---|---|---|
| One refund above 25,000 (`per_refund`) | everyone, **admins too** | `support.refund` |
| 10,000 a day per agent (`agent_daily`) | support and dispatch (not finance, not admin) | `support.refund` |
| 25,000 a month per customer, all agents together (`customer_month`) | everyone but admin | `support.refund` |
| A complaint refund above 25,000 (`dispute`, `ORDER_OUTCOME_RULES.disputes.agentLimitIqd`) | everyone, **admins too** | `orders.staff.resolveDispute` (`refund_full`, `refund_partial`) |

A refund larger than the order (less earlier refunds) is still refused outright (`refund_exceeds_order`).

## What happens

1. **Asked.** Over a limit, nothing posts. A `refund_approvals` row is written, keyed by the request: a
   double click is one row. On a ticket, the case gets a note «تعويض 30,000 دينار ينتظر موافقة ثانية (…)»
   and `TicketCase.pendingApproval = { id, amountIqd, requestedAt }`. A complaint stays `disputed`, and
   `StaffActionResult.pendingApprovalId` names the request. One pending request per complaint: asking
   again returns the same one. Audit rows: `ticket.refund_requested` / `order.refund_requested`.
2. **Approved** (`support.refundApprovals.approve`, **finance or admin**, never the person who asked:
   `approval_own_item`). The refund posts through the same path as a refund within the limits, in the
   same transaction as the decision. On a ticket, the refund line is the agent's, with `approvedBy` in
   its `meta`, and the audit row is the approver's. On a complaint, the outcome the agent picked is
   applied with the approver as the actor. If it can no longer post (case closed, complaint settled
   another way, more than the order), the approval fails with that error and the request **stays
   pending**: decline it or let the agent cancel it.
3. **Declined** (`decline`, finance or admin, with a note) or **cancelled** (`cancel`, only the person
   who asked). Nothing posts. A ticket gets a note. On a complaint the agent may ask again (a new request).

A decided request never moves again (`approval_state_conflict`). Every step emits
`support.refund_approval` (`{ refundApprovalId, kind, state, amountIqd, limit, requestedBy, ticketId, orderId }`;
aggregate `refund_approval:<id>`). A decision also writes a Console audit row,
`refund_approval.approved|declined|cancelled`.

## API (`support.refundApprovals.*`)

- `list({ state?: 'pending' | 'decided', cityId? })`: desk roles. Pending rows are oldest first; decided
  rows are newest first (200 at most). Each row is `RefundApproval`: `{ id, kind: 'ticket' | 'dispute',
  cityId, ticketId, orderId, amountIqd, method, faultParty, note, limit, requestedBy { id, name },
  requestedAt, state, decidedBy, decidedAt, declineNote }`.
- `approve({ id })`, `decline({ id, note })`: finance and admin.
- `cancel({ id })`: desk roles, but only the person who asked.

`support.get`'s `limits.availableIqd` is what the agent may give **without** a second OK.

## Where

`refund_approvals` (migration `20261010480000_refund_approvals`): ids and amounts only.
`RefundApprovalsService` lives in `apps/api/src/modules/orders/refund-approvals.ts` and is shared by
both paths. Support registers how an approved ticket refund posts, and orders registers the complaint
path.
