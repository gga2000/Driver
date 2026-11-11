# Store reviewers' sign-in and test kitchen (BENCH-04, decision D-4)

Google Play and Apple reviewers test from outside Iraq and cannot receive an Iraqi code. One
reviewer number signs in with a fixed code, and that account lives in a world of its own: a hidden
test kitchen whose orders are walked to the door by a test crew. No real kitchen, courier, message or
dinar is ever involved.

## Switching it on

Set both secrets on the API host (`fly secrets set STORE_REVIEW_PHONE=… STORE_REVIEW_CODE=…`).
They are never written in code, docs, a PR or chat: the repository is public.

| Variable | Rule |
| --- | --- |
| `STORE_REVIEW_PHONE` | an Iraqi mobile number we own and never use for anything else |
| `STORE_REVIEW_CODE` | 6 digits, not an easy one (`123456`, `000000`, a repeated digit…): the API refuses to boot |
| `STORE_REVIEW_DAILY_SIGNINS` | optional, default 10 sign-ins per rolling 24 h |

Only one of the two set also stops the boot. Unset, everything below is off and nothing is created.

## What the reviewer gets

- **Sign-in.** `identity.requestOtp` for the number sends nothing (no SMS, no WhatsApp, no guard
  count); `verifyOtp` takes the fixed code. Codes for anything but signing in (guardian links, a
  phone change) are refused for this number. Over 10 sign-ins in 24 h answers `rate_limited`.
  Every sign-in writes `security.store_review_signin` (no number in it) for the on-call alert.
- **The test kitchen.** «مطبخ التجربة · Test Kitchen», three cheap dishes, always open, auto-accepting.
  `catalog.*` shows it only to the reviewer, and shows the reviewer nothing else; `orders.place` and
  `orders.quote` refuse the reviewer at any other kitchen and anyone else at this one
  (`org_not_found`), and refuse the reviewer any ride, errand or parcel (`service_paused`), since those
  would page real drivers.
- **Only food-flow writes.** Every signed-in write by the reviewer outside `STORE_REVIEWER_WRITES`
  (`packages/contracts/src/trpc.ts`) answers `service_paused` before it reaches any service: الرجعة
  seats, خطوط, rides, wallet top-ups and points, tips, invites, family, disputes, call requests. The
  list is what is allowed (ordering, cancelling, rating, chat, sharing tracking, profile, addresses,
  notifications, sign-out), so a write added later stays closed to the reviewer until it is listed.
  Account deletion joins the list when it is built (the stores test it).
- **The account exists from boot.** The server makes the reviewer's account when it starts (under a
  lock), so every machine knows who the reviewer is before the first sign-in.
- **The walk.** About 5 minutes after the kitchen accepts: cooking (20 s), the crew takes the trip
  (45 s), picked up (2 min), at the door (4 min), handed over (5 min, cash). The order closes on its
  usual timer. The crew is a server-side person (`test_crew`) with no phone and no sign-in.

## Why nothing real can be touched

1. **Ids.** A test-kitchen order and its trip get ids starting `test_` (`shared/test-scope.ts`).
   The id travels with every event, so the fact cannot be lost on the way.
2. **One gate.** The event registry hands an event whose order or trip id is `test_` only to
   subscribers that opted in: the order's own flow (`orders:trip-events`), live screen updates
   (`live:fanout`) and the walk (`store-review:accepted`). Dispatch, the ledger (money, points,
   referral rewards), notifications, the late-delivery credit, ETA learning, door learning and every
   future subscriber never see one, unless it opts in.
3. **Trips.** A `test_` trip can only be taken by the crew, and the crew can take nothing else; test
   and real orders never share a trip.
4. **Lists.** `orgs.is_test` / `orders.is_test` keep the kitchen out of the Console's merchant picker
   and its orders out of the city's live list, zone gauges and launch-wall counts.

`store-review.e2e.test.ts` (in memory) and `store-review.integration.test.ts` (Postgres) sign in as
the reviewer, check both directions of the pairing, walk an order to closed, and assert that no
ledger balance moved and no dispatch request was made.

## Store notes (paste into Play Console "App access" and App Store Connect "Sign-In Information")

> Sign in with the phone number and code below (they are entered in the store console, not here).
> The code arrives automatically for this number; no SMS is sent. This account sees one test
> restaurant, "مطبخ التجربة · Test Kitchen". You can place a cash order there and follow it on the
> map: a test courier picks it up and delivers it in about 5 minutes. No real restaurant or courier
> is contacted and no money is charged. Rides and other services are not available to this account.
