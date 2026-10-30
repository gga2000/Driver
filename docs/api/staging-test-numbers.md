# Staging test numbers

Staging has no SMS gateway (`SMS_PROVIDER=fake`), so nobody could sign in to it. A small range of
numbers signs in with one fixed code instead: **0770 000 0100 to 0770 000 0199** (100 numbers, in
E.164 `+96477000001xx`). Code: `apps/api/src/modules/identity/staging-test.ts`.

## Switching it on

Ali chooses the code himself and types it only into GitHub: **Settings → Environments → staging →
Add environment secret**, name `STAGING_TEST_OTP`. Then run Staging setup and Deploy → staging
(`docs/deploy/staging.md`); setup also marks the host `DEPLOY_ENVIRONMENT=staging`. The code is never
written in code, docs, a PR or chat: the repository is public.

| Variable | Rule |
| --- | --- |
| `STAGING_TEST_OTP` | 6 digits, not an easy one (`123456`, a repeated digit…). Unset = off |
| `DEPLOY_ENVIRONMENT` | must be `staging` on the API host, or the API refuses to boot while `STAGING_TEST_OTP` is set |
| `STAGING_TEST_DAILY_CODES` | optional, default 200 fixed codes a day across the whole range |

The boot also stops when the code is malformed or easy.

## What a test number gets

- **Sign-in.** `identity.requestOtp` sends nothing (no SMS, no WhatsApp); `verifyOtp` takes the
  fixed code. The guard's limits per number, device, sender and IP still count each request, and at
  most `STAGING_TEST_DAILY_CODES` such codes go out a day across the range (`rate_limited` beyond).
  The resend wait, 3-minute expiry and 5-try lock are the same as everyone's.
- **The «عبّيه» button** (Ali, 8 Oct). On the customer app's code screen, a test number shows
  «رمز التجربة: …» with «عبّيه», which fills the code in. The app asks `identity.stagingTestCode`,
  which answers with the code only on staging (the range is on), only for a number in the range and
  never for one that holds a staff role. On every other host, and for every other number, it answers
  null and nothing shows. So on staging the fixed code is open to anyone who tries a test number:
  fine for made-up test accounts, and the reason they can never be staff.
- **Other codes** (guardian consent, a phone change) for a test number are the same fixed code, so
  guardian and phone-change flows can be tried on staging.
- **Customer and partner roles** work as usual. No screen grants a partner or restaurant role yet: on staging, **Actions → Staging test kit** makes 0770 000 0150 a restaurant owner and 0151/0152 courier + driver (`docs/launch/staging-test-kit.md`).
- **Never staff.** Granting a Console role (`field_ops`, `dispatcher`, `support`, `finance`,
  `admin`) to a test number is refused (`forbidden`); a test number that holds one anyway (a seed, a
  direct write) is refused at sign-in (`forbidden`); staff can't move their account onto a test number.

Everywhere else (production, local dev) the range is an ordinary set of numbers and the fixed code
means nothing.
