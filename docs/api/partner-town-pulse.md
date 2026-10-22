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
