# Staging test numbers

Staging has no SMS gateway (`SMS_PROVIDER=fake`), so nobody could sign in to it. A small range of
numbers signs in with one fixed code instead: **0770 000 0100 to 0770 000 0199** (100 numbers, in
E.164 `+96477000001xx`). Code: `apps/api/src/modules/identity/staging-test.ts`.

## Switching it on

Set the secret on the staging API host only (`fly secrets set STAGING_TEST_OTP=… DEPLOY_ENVIRONMENT=staging`).
The code is never written in code, docs, a PR or chat: the repository is public. Ali gets it privately.

| Variable | Rule |
| --- | --- |
| `STAGING_TEST_OTP` | 6 digits, not an easy one (`123456`, a repeated digit…). Unset = off |
| `DEPLOY_ENVIRONMENT` | must be `staging` on the API host, or the API refuses to boot while `STAGING_TEST_OTP` is set |
| `STAGING_TEST_DAILY_CODES` | optional, default 200 fixed codes a day across the whole range |

The boot also stops when the code is malformed or easy, or when `STORE_REVIEW_PHONE` falls in the range.

## What a test number gets

- **Sign-in.** `identity.requestOtp` sends nothing (no SMS, no WhatsApp); `verifyOtp` takes the
  fixed code. The guard's limits per number, device, sender and IP still count each request, and at
  most `STAGING_TEST_DAILY_CODES` such codes go out a day across the range (`rate_limited` beyond).
  The resend wait, 3-minute expiry and 5-try lock are the same as everyone's.
- **Other codes** (guardian consent, a phone change) for a test number are the same fixed code, so
  guardian and phone-change flows can be tried on staging.
- **Customer and partner roles** work as usual (a courier test account is granted in the Console).
- **Never staff.** Granting a Console role (`field_ops`, `dispatcher`, `support`, `finance`,
  `admin`) to a test number is refused (`forbidden`); a test number that holds one anyway (a seed, a
  direct write) is refused at sign-in (`forbidden`); staff can't move their account onto a test number.

Everywhere else (production, local dev) the range is an ordinary set of numbers and the fixed code
means nothing.
