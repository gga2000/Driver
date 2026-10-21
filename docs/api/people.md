# «الناس» — customers and drivers in the Console (2026-10-21)

Ali asked for a tab that lists every customer and every courier or driver (all services), each with a
detailed profile and analytics, for support and for building the app. He picked "a mix of all ideas"
(list + side panel, full profile page with charts, «القصة» timeline). Router `people`, contracts
`@driver/contracts/people`, server `apps/api/src/modules/console/people.reads.ts`. Read-only except
the number reveal. It owns no tables and needs no migration.

## Procedures
- `people.customers({ cityId, filter, q?, cursor?, limit })` → `CustomersPage`. The segments, the counts
  and the 8-week sparkline all come from one 90-day scan of the city's orders, cached for 60 s. `q` is a
  name, the last 4 digits (a logged vault match) or an id. Roles: dispatcher, support, finance, admin.
- `people.customer({ cityId, personId })` → `CustomerProfile`: name and masked number (one
  `console_people` vault row), lifetime totals, the weekly and hourly charts, services, places, live
  and recent orders, tickets, credits from the last 30 days, and signals. Same roles.
- `people.driver({ cityId, personId })` → `DriverPeopleProfile`: roles, live pin, scorecard, this week
  against last week, 14 days of net, a 7×24 heatmap over 28 days, cash against the cap, papers, ratings
  and complaints (tickets on their jobs, with whose fault it was). Same roles.
- `people.story({ cityId, personId, who, kinds?, cursor?, limit })` → `StoryPage`: orders or jobs, money,
  tickets and ratings, newest first; the next page is `cursor = nextBefore`. Same roles.
- `people.revealPhone({ personId, reason })` → `{ phone, at }` (mutation). Roles: support, dispatcher,
  admin. It calls `IdentityService.staffRevealPhone(actor, personId, reason)`, which:
  - checks the role inside identity;
  - refuses the reader's own record;
  - refuses other staff records unless the reader is an admin;
  - takes `reason` only from `PhoneRevealReason` (call_about_order, call_back, safety, account_help);
  - allows at most 30 reveals an hour per staff member, then answers `rate_limited` and emits
    `security.phone_reveal_limit`;
  - writes one VaultAccessLog row with purpose `console_phone_reveal` and fields `phone_e164`, in the
    same unit of work as the read (a fail-closed staff purpose).

  The Console then adds an audit row, `people.phone_reveal`, with the reason in its detail.
  **Waiting for Ali's OK:** the reveal is a new privacy rule (decision card in the «الناس» thread).

## Not here
Refunds and credits stay on support tickets and their limits. «مشكلة؟» and «افتح تذكرة» only open a
ticket tied to the person or the order.
