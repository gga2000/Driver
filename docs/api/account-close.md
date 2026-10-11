# Deleting a partner's or merchant's account

Both stores require that anyone who can sign in can ask for their account and data to be deleted. For
couriers, drivers (taxi, tuktuk, الرجعة, خطوط), fleet owners, field ops and restaurant owners and staff
the path is: they ask in their own app, support settles what is left with them, and an admin closes
the account from the Console. (Customers get their own in-app deletion with a code, built on the
waiting `claude/lane-d-account-deletion` branch; it sends anyone with a work role to this path.)

## 1. The request: `identity.requestDeletion`

Any signed-in person. Partner app: الحساب › «احذف حسابي». Merchant app: المحل › «احذف حسابي». The
screen says what is erased and what stays, takes an optional note (≤ 500 characters) and sends.

- Opens a support case of kind **`deletion`** («حذف حساب»), channel `in_app`, with him as the case's
  person (`customerId`), subject «طلب حذف الحساب», one per person (`source_key = deletion:<personId>`).
- Asking again while the case is open returns it (`alreadyOpen: true`); after it was resolved, asking
  again reopens it.
- Output: `{ ticketId, openedAt, alreadyOpen }`. His account keeps working until it is closed.

## 2. The close: `identity.closeAccount.check` / `.close` (admin only)

Console: on the `deletion` case (context pane) and at the bottom of a driver's book
(`/drivers/<id>/ledger`). Implemented in `modules/control-room/account-close.service.ts`.

`check({ personId })` → `{ personId, closable, closedAt, blockers }`. `closable` is true when he holds
or held one of `CLOSABLE_ROLES` (courier, shopper, driver, intercity_driver, khat_driver, fleet_owner,
field_ops, merchant_staff, merchant_owner). Customers and staff are not closed here.

Blockers (the close is refused with `account_close_blocked` while any is present):

| Kind | When |
|---|---|
| `cash_held` | his `cash:` account is negative (cash collected, not handed in) |
| `open_jobs` | a trip in progress as courier/driver, or a الرجعة departure of his not finished (scheduled, boarding, departed) |
| `unpaid_settlement` | his `driver:` earnings are not zero (we owe him, or he owes us), or a store he owns has a `merchant_cash:` / `merchant:` balance |
| `wallet_balance` | money in his own customer wallet (`customer:` positive) |
| `sole_owner_of_open_store` | he is the only live owner of a store that still takes orders (`count` = stores). Close it until reopened by hand (a short pause that reopens by itself is not enough) or give it another owner first |

`close({ personId, note (5–500), ticketId? })`:

1. Refused for the admin himself (`forbidden`), for a non-partner account (`account_close_not_work`),
   with blockers (`account_close_blocked`), or with a `ticketId` that is not this person's open
   `deletion` case (`invalid_input`). Already closed: returns the closed state, nothing done.
2. In one transaction:
   - the blockers are checked again (refused with `account_close_blocked` if any appeared);
   - identity closes the account (`people.deleted_at` set; `identity_vault` person identity, children he
     enrolled, names he gave or was given deleted; sessions, devices, sign-in codes and guardian links
     deleted, each deleted session announced as `session.signed_out`; every live role revoked,
     `role.revoked` events);
   - notify deletes every push token of his (`push_tokens`, with or without a session);
   - a `console_audit_log` row `account.close` with the note;
   - the case resolved with the note (no «هل انحلت مشكلتك؟» survey).
3. After that commits, the storage files the vault pointed at are deleted: document photos, check-in
   selfies, his main photo, photos of children he enrolled (their refs were read in the transaction, a
   logged staff vault read, purpose `account_close`). A rollback leaves everything, files included; a
   file that fails to delete after the commit is logged.
4. Output: the closed state plus `filesRemoved`.

Kept, under his opaque id that no longer leads to a name or a number: the ledger, trips and orders,
departures, document status rows (`driver_documents`, `driver_check_ins`: kind, dates, result), the
vault access log (append-only). His number is free again: signing in with it later makes a new
account.

Open: how long backups keep a closed account's data (policy question Q06 for Ali).
