# «المدينة حيّة»: the Partner live map home (`partner.townPulse`, `partner.myDay`)

Ali, 2026-10-22: the driver's home becomes the live map of Aziziyah ("A + C, with some of B; the
pulse very subtle, never covering the map"). Rules and schemas: `@driver/contracts/town-pulse`
(`TOWN_PULSE_RULES`, `townPulseSnapshot`, `townPulseFor`).

## `partner.townPulse` (query, driving partners)

What is going on around him, one shared picture per city at most every 20 s (every driver reads the
same picture, cut to 2.5 km around his last position). The app reads it only while he is online and
the app is in front (three times slower in low-data mode).

| Field | What | Privacy |
|---|---|---|
| `kitchens[]` | `{ id, at, state: 'cooking' \| 'ready', progress }`: shops (public places) with an order accepted, cooking or ready; `progress` in quarter steps for the soonest order | No order ids, no per-shop order counts. Home cooks and food carts never show. Nearest 12. |
| `areas[]` | `{ zoneId, n }`: new orders per area placed 13 to 3 minutes ago | Only areas with 3 or more; a few minutes late; never a pin or a house |
| `drivers[]` | `{ at, n }`: online drivers per ~300 m grid cell (cell centre) | Positions from the picture before (≥ 20 s old); cells of 3 or more without him; a count only, never a dot, id or heading. Nearest 8. |

## `partner.myDay` (query, driving partners)

«يومي»: his own deliveries today (Baghdad day) from his earnings lines, each with the kitchen and the
last door of the trip and what it earned (the same lines «ربحك اليوم» adds up), oldest first, plus
the day's total. Only his own completed trips.

## The app

`apps/partner/src/features/livehome/`: kitchen bubbles (a ring filling in quarters, saffron «جاهز»),
a ring and «طلب جديد» where an area's count rose (first picture: the three busiest, once), the
driver counts, and «يومي» as straight pickup → door lines with a money chip at each door. Every
motion plays once per change; reduce-motion keeps everything still. The busy-area glow (N17) is the
same `partner.demandGlow`, drawn at 45 % strength. Fleet owners and field ops keep the hub home.

Demo: `apps/partner/scripts/demo/40-town.mjs` (`POST /demo/town/tick`, `POST /demo/town/day?who=courier`);
shots: `SHOTS=live`.

## `catalog.townNow` (query, signed-in customers): «العزيزية هسة»

Ali, 2026-10-28 ("A + B chip + C once"): the customer's live map reads the same city picture, cut
for a customer around the place they deliver to (`townNowFor`). No extra database reads: it shares
the 20 s per-city picture with the drivers.

| Field | What | Privacy |
|---|---|---|
| `cooking[]` | `{ id, at }`: shops cooking now (ready counts as cooking), nearest 12 within 2.5 km | No progress, no order ids or counts; home cooks and carts never show |
| `drivers[]` | `{ at, n }`: drivers per ~300 m cell | Cells of 3 or more, a picture old; a count only, nearest 8 |

Signed-in only; one shared picture per city every 20 s is the polling floor. A place outside the city's box (the zones' service bounds) gets an empty picture. Kitchens are shops with a food order accepted, cooking or ready (so approved and in the launched food vertical); the app shows only those also in `catalog.restaurants`. No areas, ever. Minutes to the customer and open/closed come from `catalog.restaurants` (with the
drop-off), not from this feed. A customer sees their own courier only through their order's tracking.
Guests get the map without this feed (open kitchens only).
