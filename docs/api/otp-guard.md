# Sign-in codes: the OTP guard

Launch plan W5 (audit SEC-01, SEC-04, SEC-05, SEC-17; decision D-5). Code:
`apps/api/src/modules/identity/rate-limit.ts` (the guard), `otp.service.ts` (codes).

## Who can ask for a code

| Code | Asked through | Counted against |
|---|---|---|
| Sign-in (`login`) | `identity.requestOtp` (public) | the number, the device, the client IP |
| Guardian consent | `identity.linkGuardian` (signed in) | the number, the signed-in sender |
| Phone change | `identity.changePhoneStart` (signed in; two codes) | each number, the signed-in sender |

`identity.requestOtp` accepts only `purpose: 'login'`: the other codes go out only from their own
signed-in flows.

## Rules

| Rule | Launch value | Mode at launch | Setting |
|---|---|---|---|
| Per destination number | 5 an hour, 10 a day | enforce | `OTP_RATE_LIMIT_PER_NUMBER_HOUR` / `_DAY`, `OTP_GUARD_MODE_NUMBER` |
| Per device | 5 an hour | enforce | `OTP_RATE_LIMIT_PER_DEVICE_HOUR`, `OTP_GUARD_MODE_DEVICE` |
| Per signed-in sender | 5 an hour, 20 a day | enforce | `OTP_RATE_LIMIT_PER_ACTOR_HOUR` / `_DAY`, `OTP_GUARD_MODE_ACTOR` |
| Per client IP | 1,000 an hour | **alert only** | `OTP_RATE_LIMIT_PER_IP_HOUR`, `OTP_GUARD_MODE_IP` |
| SMS budget (rolling 24 h) | 4,500 SMS (3 × expected day-one installs) | throttle | `OTP_SMS_DAILY_BUDGET`, `OTP_BUDGET_MODE` |
| Spiking number block | 30 codes an hour to one 7-digit block | used once the budget is spent | `OTP_BLOCK_SPIKE_PER_HOUR` |

`OTP_GUARD_MODE=enforce|alert` sets the number, device and sender rules together; a per-rule
setting wins. The IP rule stays alert-only unless `OTP_GUARD_MODE_IP=enforce` is set by name:
Iraqi carriers put a whole town behind a few IPs, so blocking on IP would lock real people out.

Over an enforced limit the answer is `rate_limited` with `retryAfterSec`; the refusal is logged as
`otp.rate_limited` with the rule and the carrier (Asiacell 077, Zain 078/079, Korek 075), never the
number.

## When the SMS budget is spent

The town is never locked out:

1. Alerts go out at 50 % and 80 % of the budget, and again at 100 %.
2. At 100 %, a 7-digit number block (for example `0770 123`) that had 30 or more codes in the last
   hour is throttled (`rate_limited`, try again in 15 minutes). A 4-digit carrier head is never
   throttled: it would cut off a whole carrier.
3. Everyone else who did not choose a channel gets the sign-in code on WhatsApp
   (`channel: 'whatsapp'` in the answer; the customer app's code screen says so).
4. Someone without WhatsApp taps «دزلي رسالة ثانية», which asks for SMS by name and gets it, still
   inside the per-number limit.

`OTP_BUDGET_MODE=alert` keeps the alerts and changes nothing else. The Partner and Merchant apps
always ask for SMS by name (they have no WhatsApp option on their code screens).

## Alerts

Each alert is written once per rule and key per window as a `security.otp_alert` event
(aggregate `security/otp`) and logged as `otp.alert`. Payloads carry the rule, counts, limit, mode,
carrier and, for a spike, the 7-digit block; never a full number or an IP.

| `rule` | When |
|---|---|
| `ip` (or `number`, `device`, `actor` in alert mode) | the count passed the limit in its window |
| `sms_budget` | 50, 80 and 100 % of the budget (`level`) |
| `block_spike` | a block reached the spike count (`throttled: false`), or was throttled (`throttled: true`) |

## Wrong codes

A code has 5 attempts. Each guess first claims one attempt with a single conditional
`UPDATE … RETURNING`, committed on its own before the code is compared, and before the sign-in
transaction opens. Twenty guesses at once still count exactly 5, then the code is locked for
15 minutes (the right code too). A right code is used up only if it is still unused and unlocked, so
two parallel right answers sign in once.
