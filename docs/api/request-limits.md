# Request limits (W5: SEC-03, SCALE-20)

Every API call is counted, so a client stuck in a retry loop or a script cannot take the API from
everyone. The numbers live in `REQUEST_LIMITS` (`packages/contracts/src/request-limits.ts`); the
counting is `apps/api/src/trpc/request-limits.ts`, in the shared window counter (Redis across
machines when `REDIS_URL` is set, in process otherwise), one counter per key per minute.

| Rule | Limit | Mode |
|---|---|---|
| Calls in one HTTP request (tRPC batch) | 50 (the apps split at 25) | refused whole with 400 |
| Calls per signed-in person | 600 a minute | enforced |
| `pricing.quote` per signed-in person | 30 a minute | enforced |
| `pricing.quote` per address, guests | 300 a minute | enforced |
| Calls per address, guests | 1,200 a minute | alert-only (`REQUEST_LIMIT_IP_MODE=enforce` to enforce) |

- Over a limit the call answers `rate_limited` (HTTP 429) with `retryAfterSec` = the seconds until
  the minute ends. The first refused call of each minute writes one warning to the log
  (`request limit reached: …`).
- Guests are counted per address only. Carrier NAT puts a whole town behind a few addresses, so that
  rule only logs at launch (decision D-5). `pricing.quote` keeps every quote it gives (LOAD-01), so
  its own lower address limit is enforced. Sign-in calls (`identity.*`, which have the OTP guard) and
  health checks are never counted against an address.
- Live streams (`live.*` subscriptions) are not counted; their stream token (`live.token`) is.
- If the counter fails (Redis down) calls go through, with one error a minute in the log: a limit
  must never take the API down with it.

Tests: `trpc/request-limits.test.ts` (each rule, the minute rolling over, alert vs enforce, a failing
counter), `trpc-limits.smoke.test.ts` (a batch of 50 served, 51 refused, over HTTP) and
`shared/window-counter.redis.test.ts` (the count shared by two machines on Redis).
