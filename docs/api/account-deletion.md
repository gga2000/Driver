# Account deletion (W7, store rule REL-01)

Both stores require that an app with sign-up lets people delete their account **inside the app**.
A customer opens حسابي → حذف الحساب (`apps/customer/app/profile/delete.tsx`), sees what is erased and
what is kept without his name, clears anything in the way, gets a code on his own number and taps
«احذف حسابي». The phone then forgets everything (like «سجّل خروج»).

What happens to each table is in `docs/launch/data-inventory.md`; a test keeps that list complete.

## Procedures (`identity.deleteAccount.*`, signed in)

| Procedure | Input | Output | Notes |
|---|---|---|---|
| `check` (query) | none | `{ available, blockers[], points }` | `available: false` when the switch is off (the screen sends people to support). `points`: what he gives up. |
| `start` (mutation) | none | `{ phoneMasked, expiresAt, resendAfterSec }` | Sends a code (purpose `account_delete`) to his own number. Refused with `account_delete_blocked` while anything is in the way, `account_deletion_off` when switched off. The per-number resend wait and lock-out of sign-in codes apply. |
| `confirm` (mutation) | `{ code }` (6 digits) | `{ deletedAt }` | Checks the code and the blockers again, closes the account in one transaction, then erases. `otp_invalid` for a wrong code. |
| `devCode` (query) | none | `{ phoneMasked, code }` | Dev only (refused in production): the demo fills the code. |

A deletion code can never be asked for through `identity.requestOtp` (its `purpose` excludes
`account_delete`), so a code for someone else's number can't be sent.

## Blockers (`DeletionBlocker.kind`)

| Kind | When | What the screen says |
|---|---|---|
| `open_order` (`count`) | an order of his is not delivered, completed or closed | wait until it arrives |
| `open_booking` | a الرجعة booking is live, a door-pickup post or ride request is open | finish it first |
| `active_subscription` (`count`) | a خطوط subscription in trial, active or past due (his seat or a child's) | cancel it first |
| `wallet_balance` (`amountIqd`) | money in his wallet | spend it or talk to support (money rule M-6 open) |
| `wallet_owes` (`amountIqd`) | he owes money | settle it |
| `household` (`count` or `amountIqd`) | he pays for a household with other people in it, or its wallet holds money | hand payment over / spend it |
| `work_role` | he has or had any role but customer (driver, courier, restaurant, staff) | support closes it (their records have their own retention) |

## How deletion runs

1. **Close (one transaction, identity):** lock the `people` row; keep the number only as a peppered
   hash in `identity_vault.retired_phones` (with the account's start date, no person id); delete his
   vault identity, the names he gave others and others gave him, his children's names, guardian links,
   sign-in codes, sessions (every phone is signed out) and devices; revoke roles; set
   `people.deleted_at`; emit `person.deleted`.
2. **Erase (each module's step):** every module that keeps rows about people registers an
   `ErasureStep` with `ErasureRegistry` at start-up (identity imports none of them). Steps erase or blur
   their tables; pins are snapped to a 0.01° grid (about 1.1 km). `people.erased_at` is set when every
   step has finished. A step that fails, or can't run yet (`ErasureNotReady`), is retried by
   `AccountErasureJob` every 10 minutes (on job processes only); steps are idempotent.
3. **The same number later:** signs up as a new, empty person. It is not "new" for invite rewards
   (`invite_not_new`), so deleting and joining again earns nothing twice.

## Switch

`ACCOUNT_DELETION=off` turns it off (default on, plan 7.6): `check` returns `available: false`,
`start` and `confirm` refuse with `account_deletion_off`.

## Open items

- Money left in a wallet (M-6): only an empty wallet deletes now. Points are given up.
- The store reviewer's demo account must not delete itself out of the review build: when the
  store-review step lands, the reviewer's deletion is answered without erasing the shared demo data.
- Retention of receipts and SOS records is confirmed by the lawyer (L1).
