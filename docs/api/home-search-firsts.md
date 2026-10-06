# Home by the hour, one search, firsts (customer joy J5c)

Plan: `docs/superpowers/plans/2026-10-06-j5c-home-search.md`. All three reads are server-side truths the
app only displays; nothing here prices anything.

## `catalog.picks` (public query)

`{ cityId, words: string[1..12], dropoff?, limit = 3 (≤ 12) } → CatalogSearchDish[]`

Real dishes for a meal's words, only from kitchens **open now** and only dishes orderable now. A dish
counts when every word of the pick starts a word of its name (`searchScore ≥ 2`: «تمن» finds «تمن
وقيمة», never «ثمن»). Order: earlier words first, the dish named exactly before one that only carries
the word («باچة» before «تشريب باچة»), then price. Variety: one dish per kitchen first, then a dish of a
word not yet shown, then the rest. Guests are rate-limited like the rest of the catalog.

Used by the home's daypart band (`features/home/daypart.ts` → `bandWords`) and by search's meal words
(«فطور», «غدا», «عشا», «حلو», «عصير» in `features/search/intents.ts`).

## `search.unmet` (public mutation) and `search.unmetList` (Console)

`search.unmet { cityId, term (2–60), zoneKey? } → { ok: true }` — sent only when the customer answers
«إي، گولولهم» on an empty search. Stored anonymously in `public.search_unmet` (folded term, as typed,
deliver-to zone, signed in or not; **no person id**). At most 10 per caller per minute (IP for guests,
person when signed in), then `rate_limited`.

`search.unmetList { cityId, days = 30, limit = 30 } → UnmetSearchRow[]` — admin, dispatcher, support,
field ops. One row per folded term: searches, how many signed in, busiest zones, the latest spelling and
time. Shown on the Console controls page («شنو يدورون وما لگوه»).

## `orders.firsts` (protected query)

`→ { foodOrderId, tuktukOrderId }` — the caller's first delivered food order and first finished tuktuk
ride, chosen from all their orders by when each reached them, so once claimed no later order can take
it. The app shows the «أول مرة» stamp on that order's arrival screen once per phone, never on a quiet
day. The first الرجعة seat is the earliest booking that became a real seat (`routes.myBookings`).
