# J5c — Home, search and first run · implementation plan

> For agentic workers: implement task by task, TDD for every pure function, one commit per task.

**Goal:** the customer home knows what time it is in Aziziyah, the search box answers for the whole
town (food, rides, الرجعة, coming-soon), a new person gets one welcome-home moment, and three «أول مرة»
firsts land once each — all quiet on mourning days.

**Spec:** `docs/specs/2026-10-05-customer-joy.md` §5.5 J5c; findings D-02, D-04, D-07, D-09, D-13,
D-15, D-21, D-23, D-24 and ideas 4-1, 4-4, 4-5 in `docs/research/ui-ux-audit/2026-10-05-joy/1-discovery.md`;
B1 in `6-delight-strategy.md`. Board ids: h1, h4, h7, h9, h10, g8 (+ D-23/D-24). Skipped: h8 (maps
session owns places and the place editor).

**Architecture:** pure logic in `apps/customer/src/features/{home,search,firsts}/*.ts` with injected
clocks (tested in Node by vitest); thin React pieces on top. Two server reads/writes are added
(`catalog.picks`, `search.unmet` / `search.unmetList`, `orders.firsts`); everything shown is real data
— no invented dishes, counts or prices. Motion goes through new shared presets in `@driver/ui`.

**Tech:** Expo SDK 52 / React Native 0.76 / Reanimated 3.16 / react-native-svg (installed only), tRPC
+ zod contracts, NestJS modules with in-memory and Prisma repositories, Next.js Console.

---

## File map

| File | Responsibility |
|---|---|
| `packages/ui/src/motion/presets.ts` (+ test) | fadeIn, panelIn, sheetIn, pop (layout `entering` builders) and hop, digitRoll (shared-value animations) on the motion tokens; every one returns `undefined`/a no-op under reduce motion |
| `apps/customer/src/features/home/daypart.ts` (+ test) | `daypart(now)` in Asia/Baghdad (dawn 4–11, lunch 11–16, asr 16–19, dinner 19–23, late 23–4, Friday flag), greeting key per daypart (quiet-day variants), dish words for the band, `orderForDaypart(terms, d)` for the cuisine circles, `kitchenRank` |
| `apps/customer/src/lib/dev-clock.ts` (+ test) | dev-only clock override (`?now=HH:MM` or ISO, only when `EXPO_PUBLIC_DEV_TOOLS=1`) so screenshots show dawn/lunch/night |
| `packages/contracts/src/catalog-io.ts`, `routers/catalog.ts` | `catalog.picks({cityId, words, dropoff?, limit})` → dishes from **open** kitchens whose names start with one of the words, one per kitchen first |
| `apps/api/src/modules/catalog/catalog.rpc.ts` (+ test) | `picks` implementation (same guest rate limit as search) |
| `apps/customer/src/features/home/DaypartBand.tsx` | band title + up to 3 dish tiles (FoodArt, name, price, kitchen); hidden when < 2 qualify |
| `apps/customer/src/features/home/HomeHeader.tsx` | greeting line (daypart, name), deliver-to row, points chip instead of the bell (h9) |
| `apps/customer/src/features/home/points-chip.ts` (+ test) | `pointsChip(balance)` → null at 0 / guests |
| `apps/customer/src/features/home/rajaa-direction.ts` (+ test) | h10: direction from the deliver-to place (Aziziyah zone → outbound), device position in Baghdad → back, morning bias outbound |
| `apps/customer/src/features/home/RajaaCard.tsx`, `features/rajaa/queries.ts` | the card follows that direction; next departure as a big time |
| `apps/customer/src/features/search/intents.ts` (+ test) | folded whole-word matcher → `rajaa` / `ride` (vertical + destination spot) / `tag` / `soon` intents |
| `apps/customer/app/search.tsx`, `features/search/ServiceResults.tsx` | «خدمات» group above restaurants, tag results, zero-result «نگول للمطاعم؟» → `search.unmet`; start screen «فتحتها قبل» + daypart row; filled field + new placeholder (D-23) |
| `apps/customer/src/features/search/viewed.ts` (+ test) | last 3 restaurants opened (device) |
| `packages/contracts/src/search-io.ts`, `routers/search.ts`; `apps/api/src/modules/catalog/*` ; `packages/db/prisma` migration `search_unmet` | unmet-search log (term folded + as typed, zone, signed-in flag; no person id) and the Console read (top terms, 30 days) |
| `apps/console/src/components/unmet-searches-card.tsx` | a small list on the System page |
| `apps/customer/src/features/home/welcome-home.ts` (+ test), `WelcomeHome.tsx` | h7: once-per-device flag set at the end of setup, pin position for the zone, the scene (J4 `welcome` art + pin drop), success haptic unless quiet, static under reduce motion, tap to skip |
| `apps/customer/src/features/firsts/firsts.ts` (+ test), `FirstMoment.tsx`; `orders.firsts` | g8: the server names the person's first delivered food order, first tuktuk ride and first الرجعة seat; the device remembers it played; silent and hidden on quiet days |

## Tasks (one commit each)

1. **Plan** — this file.
2. **Motion presets** — test: under reduce motion every builder returns `undefined` and `hop`/`digitRoll` return the target value without animation; durations equal the tokens. Implement with Reanimated `FadeIn`, `FadeInDown`, `SlideInDown`, `ZoomIn`, `withSequence`/`withSpring`. Export from `@driver/ui`.
3. **h1 daypart logic** — tests for every boundary (03:59 late, 04:00 dawn, 10:59/11:00, 15:59/16:00, 18:59/19:00, 22:59/23:00) in Baghdad time from UTC instants, Friday flag on Friday Baghdad date (Thursday 21:30 UTC is Friday 00:30 Baghdad), quiet greeting variants carry no festive line, `orderForDaypart` keeps unknown terms after known ones in their original order.
4. **h1 picks API** — contract + `CatalogRpc.picks` + rpc test (closed kitchens and sold-out dishes never returned; one per kitchen before a second; at most `limit`).
5. **h1 home** — dev clock, greeting in the header, chip order, kitchens ranked by daypart tags after favourites, `DaypartBand` (hidden < 2). Copy in ar-IQ/en.
6. **h9 points chip** — `pointsChip` test; header chip «{n} نقطة» → wallet; hidden at 0 and for guests; bell removed.
7. **h10 الرجعة direction** — tests (Aziziyah place → from_aziziyah; Baghdad position → to_aziziyah; no place before noon → from_aziziyah, after noon → to_aziziyah); card uses it and shows the next car's time big.
8. **h4 intents** — tests: «بغداد» → rajaa baghdad; «الكوت» → rajaa kut; «كراج»/«رجعة» → rajaa; «تكسي» → ride taxi no destination; «تكتك للسوق» → ride tuktuk to كراج السوق; «تكسي لشارع 30» → ride to zone street_30; «شارع ٣٠» alone → ride to street_30; «فطور»/«ريوگ» → tag breakfast; «بغدادي» does NOT match بغداد; «سوق» → soon grocery; «بيتزا» → none.
9. **h4 search screen + unmet log** — `search.unmet` (public, rate-limited, no person id) + migration + Console card; services group; tag results via `catalog.picks` + kitchens by tag; zero results ask «نگول للمطاعم؟».
10. **D-23/D-24** — filled field, placeholder «دوّر على أكلة، مطعم، أو وين رايح», «فتحتها قبل» (viewed store test), daypart row on the start screen.
11. **h7 welcome home** — flag tests (set only by finishing setup, played once), pin position inside the drawing for every zone; scene + copy «هلا بيك {name}، هذا حيّك: {zone}».
12. **g8 firsts** — `orders.firsts` (tracking service; test), `firstMomentFor(kind, ids, seen, season)` test; FirstMoment card on arrival (food, tuktuk) and on the الرجعة booking once booked.
13. **Gate + screenshots** — rebase, `pnpm typecheck && pnpm lint && pnpm test`, web shots at 390 and 360.

## Self-review

Every board id in scope maps to a task (h1: 3–5, h4: 8–9, h7: 11, h9: 6, h10: 7, g8: 12, D-23/24: 10,
presets: 2). Money: nothing new is priced; points chip only displays the server's balance. Quiet days:
greeting (3), welcome haptic (11), firsts (12).
