# Request limits (W5: SEC-03, SCALE-20; CON-21)

Every API call is counted, so a client stuck in a retry loop or a script cannot take the API from
everyone. The numbers live in `REQUEST_LIMITS` (`packages/contracts/src/request-limits.ts`); the
counting is `apps/api/src/trpc/request-limits.ts`, in the shared window counter (Redis across
machines when `REDIS_URL` is set, in process otherwise), one counter per key per minute.

| Rule | Limit | Mode |
|---|---|---|
| Calls in one HTTP request (tRPC batch) | 50 (the apps split at 25) | refused whole with 400 |
| Calls per signed-in person | 600 a minute | enforced |
| `pricing.quote` per signed-in person | 120 a minute (the ride screen asks 4 per pin move) | enforced |
| `pricing.quote` per address, guests | 300 a minute | enforced |
| Calls per address, guests | 1,200 a minute | alert-only (`REQUEST_LIMIT_IP_MODE=enforce` to enforce) |
| Console writes per staff person | 60 a minute | enforced |
| Console reads per staff person | 1,200 a minute (three Console tabs polling) | enforced |

- Over a limit the call answers `rate_limited` (HTTP 429) with `retryAfterSec` = the seconds until
  the minute ends, also sent as the `retry-after` header (any refused call with a wait, OTP resend
  included). The first refused call of each minute writes one warning to the log
  (`request limit reached: …`); never a ban, the next minute works again.
- Console calls (CON-21): a procedure whose roles are all Console roles (`STAFF_ROLES`: admin,
  dispatcher, support, finance, field_ops) is a staff call, counted per staff person after the role
  check, writes and reads apart; each call in a batch counts once. Once a person has made a staff
  call, their overall per-person ceiling is the two Console limits together (1,260) instead of 600,
  for 10 minutes after their last staff call. The log names the person and the
  call at the first refusal of the minute and every 50th after it, so a Console screen stuck in a
  loop shows up without flooding the log. A procedure also open to an app role (e.g. courier and
  field_ops) is not a staff call.
- Guests are counted per address only. Carrier NAT puts a whole town behind a few addresses, so that
  rule only logs at launch (decision D-5). `pricing.quote` keeps every quote it gives (LOAD-01), so
  its own lower address limit is enforced. Sign-in calls (`identity.*`, which have the OTP guard) and
  health checks are never counted against an address.
- Live streams (`live.*` subscriptions) are not counted; their stream token (`live.token`) is.
- If the counter fails (Redis down) calls go through, with one error a minute in the log: a limit
  must never take the API down with it.

Tests: `trpc/request-limits.test.ts` (each rule, the minute rolling over, alert vs enforce, a failing
counter), `trpc-limits.smoke.test.ts` (a batch of 50 served, 51 refused, 429 with `retry-after`, over HTTP),
`contracts/src/trpc.test.ts` (which procedures are staff calls) and
`shared/window-counter.redis.test.ts` (the count shared by two machines on Redis).
