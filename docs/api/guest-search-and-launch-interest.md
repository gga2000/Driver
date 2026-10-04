# Guest browsing, search, "خبرني" and WhatsApp codes (customer Phase 1, 2026-10-04)

Audit items C-01, C-03 and C-18 (`docs/research/ui-ux-audit/customer.md`) and Ali's decision 4
(guest browsing). Everything here is additive.

## Public catalog (`catalog.*`)

`catalog.restaurants`, `catalog.menu` and the new `catalog.search` are `publicProcedure`s: home,
the restaurant list, search and menus open without an account. Nothing in a card or a menu is
personal (names, cuisine, prices, a fee preview for a zone). A request with a valid token is read as
that person (same cards); without one the reader is a guest seen only by the client IP, limited to
`CATALOG_PUBLIC_RATE` (120 reads a minute per IP, shared window counter, Redis when `REDIS_URL` is
set). Over the limit: `rate_limited` with `retryAfterSec`.

## `catalog.search`

```ts
catalog.search({ cityId: 'aziziyah', query: 'التكه', dropoff?: DeliveryPoint })
  → { folded: 'تكه', restaurants: RestaurantCard[], dishes: CatalogSearchDish[] }
```

- Folding (`foldArabic` in `@driver/contracts`, shared with the apps): tashkeel and tatweel go;
  أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ → و, ئ → ي; گ ک → ك, چ → ج, ڤ → ف, پ → ب; Eastern digits → 0–9;
  a leading "ال" drops from every word longer than three letters.
- Every query word has to match. Kitchens match by name (ranked first), cuisine line or tag; a
  kitchen that matches only through its dishes is listed after them. Dishes match by name, or more
  weakly by their menu section ("ريوگ" → كاهي وقيمر، مخلمة…).
- Closed kitchens are included and marked (`open: false`, `opensAt`); their dishes carry
  `restaurantOpen` / `restaurantOpensAt` and sort after open ones. Sold-out dishes: `available: false`.
- At most 20 kitchens and 30 dishes (`CATALOG_SEARCH_LIMITS`). An empty fold returns empty lists.

## "خبرني لمن تنفتح" (`notify.launchInterest`)

| Procedure | Who | What |
|---|---|---|
| `notify.launchInterest({ service, zoneKey? })` | signed in | Records (or refreshes) interest in `grocery` / `khat` / `parcel`; returns `{ services }` |
| `notify.myLaunchInterests()` | signed in | The services this person asked about |
| `notify.launchDemand()` | admin, dispatcher, support, field_ops | Per service: people, by zone (most first), last asked |

Stored in `launch_interests` (one row per person and service; migration
`20261005010000_launch_interests`). The launch push goes to these people when a service opens.

## Login code over WhatsApp (`identity.requestOtp`)

`requestOtp({ phone, purpose: 'login', channel: 'whatsapp' })` sends the code with the WhatsApp
template `otp_login` (one body parameter: the code) through the shared WhatsApp port
(`shared/messaging/whatsapp.ts`, `WHATSAPP_PROVIDER=dev|meta`, the same provider notify uses). Same
challenge rules as SMS: 30 s cool-down, 5 attempts, 3-minute expiry; a WhatsApp code replaces the
SMS one. The output says the `channel`. Without a WhatsApp port, or for another purpose:
`otp_channel_unavailable`. In development `identity.devLastOtp` returns the WhatsApp code when that
was the last one sent. Before launch: get the `otp_login` authentication template approved in Meta.
