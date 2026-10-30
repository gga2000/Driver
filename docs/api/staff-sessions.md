# Staff sessions

People who hold a Console role (`field_ops`, `dispatcher`, `support`, `finance`, `admin`;
`STAFF_ROLE_KINDS` in `packages/contracts/src/auth.ts`) sign in like everyone else, with these
extra rules.

## A staff session lasts at most 12 hours

`STAFF_SESSION_MAX_SEC`. A staff sign-in's refresh token ends 12 hours after the sign-in, however
often it refreshes; then the Console asks for a new code. A person made staff while signed in with an
older session is asked to sign in again at the next refresh. Customers, drivers and merchants keep
the 30-day refresh.

## A new device alerts the admins

The first time a staff account signs in (or refreshes) from a device fingerprint never seen on it,
identity writes `staff.new_device` (`personId`, `deviceId`, `platform`, `adminIds`) and every admin
gets the `staff_new_device` push: «جهاز جديد بحساب زينب». Push only, at any hour.

## «طلّعه من كل الأجهزة»

`identity.endAllSessions({ personId })`, admins only, from the Console's «الموظفين» page (`/staff`).
Every live session of that person ends on every device in one transaction: the next call or refresh
is refused, the sign-in memory drops them on every API machine (`auth-cache.md`), each session's
push tokens are dropped (`session.signed_out`), and the Console audit gets a `staff.end_sessions`
row. The person keeps the role and signs in again on their own device. An admin can't end his own
sessions from here.

## Taking a staff role away ends every session

`identity.revokeRole` of a staff role ends all of that person's sessions in the same transaction
(`session.all_ended`, reason `role_revoked`), so a device signed in before can't pick the role up
again when it is granted back. Merchant and other roles leave the person signed in.
