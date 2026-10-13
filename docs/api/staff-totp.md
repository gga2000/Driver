# Staff authenticator — the second sign-in step for admin and finance (2026-10-13)

Decided by Ali on 2026-10-13: "Require an authenticator-app code for admin and finance Console sign-in:
Yes, before launch." The roles that can move money or change who works here now need two things at
sign-in: the SMS code to their phone, then a 6-digit code from an authenticator app (Google
Authenticator, Microsoft Authenticator, 1Password …). Everyone else (support, dispatch, field ops,
drivers, merchants, customers) signs in exactly as before.

Rules are server constants in `packages/contracts/src/auth.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `SECOND_STEP_ROLE_KINDS` | `admin`, `finance` | the roles that need the step |
| `STAFF_TOTP_RULES.digits` / `stepSec` | 6 / 30 | RFC 6238 codes, HMAC-SHA1, a new code every 30 seconds |
| `STAFF_TOTP_RULES.window` | 1 | the code one step before or after now is also accepted (phone clocks drift) |
| `STAFF_TOTP_RULES.maxTries` / `lockMinutes` | 5 / 15 | 5 wrong codes in a row lock the step for 15 minutes |
| `STAFF_TOTP_RULES.recoveryCodes` | 8 | one-time recovery codes given at set-up |

## What a staff member sees (Console, `/login`)
1. Phone, then the SMS code — unchanged.
2. **First time** («اربط تطبيق المصادقة»): a QR code (an `otpauth://totp/` link, issuer `Driver`) and the
   same key as text for typing by hand. He adds it to his app and types the first code to confirm.
3. **Recovery codes** («رموزك الاحتياطية»): 8 codes `XXXXX-XXXXX`, shown this once, with a copy button.
   Each lets him in once if the phone is lost.
4. **Every later sign-in** («رمز تطبيق المصادقة»): the app's current code, or one recovery code
   («ضاع موبايلك؟ استعمل رمز احتياطي»); after a recovery code the screen says how many are left.

A session that still owes the step (a tab opened before it was passed) is sent back to `/login`. The
step belongs to the session, not the person: every new sign-in asks again.

## How the server enforces it
- After the SMS code an admin or finance session is **pending** (`sessions.second_step_at` is null).
  `identity.verifyOtp` and `identity.me` return `secondStep: 'enrol' | 'code'` so the Console knows.
- The role gate itself refuses: `protectedProcedure(roles)` (and the live-stream gate) answers
  `totp_required` to a pending session for any procedure whose roles include admin or finance — unless
  the person also holds another role that procedure allows (an admin who is also a dispatcher keeps the
  dispatch desk). Inside a request, identity's own role reads leave admin and finance out for that
  session too, so service-level checks agree with the gate.
- Passing the step stamps `second_step_at` on that session only.
- Procedures (`identity.authenticator.*`):

| Procedure | Who | What |
|---|---|---|
| `enrol` | signed in | a new secret (QR link + text); refused once a set-up is confirmed |
| `confirm` | signed in | the first code confirms the set-up and passes the step; returns the 8 recovery codes once |
| `verify` | signed in | an app code or a recovery code; passes the step |
| `demoCode` | signed in | demo only, see below |
| `locks` | admin | staff whose step is locked right now (the Console strip) |
| `reset` | admin | clears another staff member's set-up (below) |

### Codes, replay and wrong tries
- A code is accepted for the current step ±1. The step it matched is stored (`last_step`); that step and
  every older one are refused afterwards, so a code is never accepted twice.
- Each try is counted before the code is compared, in its own statement outside the main transaction,
  so parallel guesses cannot slip past the count. A right code resets the count.
- The 5th wrong code in a row locks the step for 15 minutes (`totp_locked`, with a retry time). The lock
  raises `staff.totp_locked`: a push to every admin and a row on the Console's alert strip for admins
  («فلان: 5 رموز مصادقة غلط ورا بعض …», linked to the staff page) until the lock ends.

### Storage
One row per staff member in `identity_vault.staff_totp` (migration `20261010620000_staff_totp`, ends with
`driver_harden`):
- the secret, **encrypted with AES-256-GCM** under `STAFF_TOTP_KEY`, a fresh IV each time and bound to
  the person (it cannot be moved to another row);
- the recovery codes only as **salted scrypt hashes**, each removed when used (every use is an event,
  `staff.totp_recovery_used`);
- the last used step, the wrong-try count and the lock.

Every read of the secret or the hashes writes a vault access row with its purpose first (fail closed:
no log row, no read). Closing an account deletes the row with the rest of the vault data.

### The key: `STAFF_TOTP_KEY`
64 hex characters (`openssl rand -hex 32`), its own value. Staging and production refuse to boot
without it, with a malformed one, or with a value another secret already uses. A laptop uses a fixed
dev key. Changing the key means every admin and finance member sets the app up again
([runbook](../deploy/runbook.md)). Never put it in code, docs or a chat.

## Reset by an admin (Console › الموظفين)
For a staff member who lost the phone with his app: «صفّر تطبيق المصادقة» on his row (admin and finance
rows only).
- Needs the resetting admin's **own fresh code** typed in the dialog (checked and used like a sign-in
  code; wrong ones count toward his own lock).
- **Never on yourself** (`forbidden`), in the Console or the API.
- In one transaction: the set-up is deleted, every session of that person ends on every device, and the
  Console audit trail gets a row («صفّر تطبيق المصادقة مال …»).
- The person is told: `staff.totp_reset` → push, with an SMS if the push is not opened.
- At his next sign-in he sets the app up again and gets new recovery codes.

## Break glass (no admin can do it)
When no admin can pass the step to reset someone (for example the only admin lost his phone and his
recovery codes), someone with Fly access to the API runs a one-off script on the API machine. It is not
reachable from any app or API procedure.

```sh
# Look only: is the number a person, is an authenticator set up?
fly ssh console --config deploy/fly/api.toml -C "node dist/staff-totp-break-glass.js --phone 07XXXXXXXXX --operator 'your name' --reason 'why'"
# Clear it: add --yes
fly ssh console --config deploy/fly/api.toml -C "node dist/staff-totp-break-glass.js --phone 07XXXXXXXXX --operator 'your name' --reason 'why' --yes"
```

It does what the Console reset does — deletes the set-up, ends every session, sends the reset notice
(through the outbox the running API delivers) — and writes a Console audit row naming the operator and
the reason (actor `system:break_glass`), plus a vault access row. It prints the number masked and
nothing secret. Source: `apps/api/src/staff-totp-break-glass.ts`.

## Demo
The Console demo API (`apps/console/scripts/demo-api.mjs`) sets `STAFF_TOTP_DEMO=1`. Then
`identity.authenticator.demoCode` returns the signed-in person's current code, and the Console shows it
under the code box with «عبّيه», like the SMS code. Signing in as `0770 000 0001` sets the app up the
first time (QR, then recovery codes) and asks for a code after that, both filled in by the strip.
Outside the demo the procedure answers `{ code: null }`; on a deployed server it answers `dev_only`, and
the API refuses to boot at all when `STAFF_TOTP_DEMO` is set there (the same rule as the dev push
provider).

## Errors
| Code | When |
|---|---|
| `totp_required` | an admin or finance procedure called before the step; or a reset by an admin with no set-up |
| `totp_invalid` | wrong, expired or already used code |
| `totp_locked` | 5 wrong in a row; retry after the lock |
| `totp_already_set` | `enrol` after the set-up was confirmed (ask an admin for a reset) |
