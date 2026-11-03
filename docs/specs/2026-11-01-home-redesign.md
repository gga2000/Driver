# Customer home redesign — design guide

Status: **approved look, being built.** Ali picked both screens on 2026-11-01 and changed the layout on
2026-11-02 (§12 wins wherever it differs from §1–§11). This guide is the
only source for the build: any session (this Mac or Claude Code on the web) builds from it, not from
memory or from Stitch. Change it when a decision changes.

- **Scope: the customer app only** (Ali, 2026-11-01). Partner, Merchant and Console keep today's brand
  (`2026-10-03-brand.md`). For the customer app, the colours here replace that brand's cream + saffron.
- **Backup of the app before this work:** git tag `backup-before-home-redesign-2026-11-01` (commit
  `a6ac485a`). To go back, restore the customer app from that tag; nothing else needs to change.
- Explored in Google Stitch, project «Driver home — new directions (Oct 2026)» (`8111245244662889446`).

## 1. The two approved pictures

| | Picture | Stitch screen | Shows |
|---|---|---|---|
| **Light** | [`home-redesign/light-order-running.jpg`](home-redesign/light-order-running.jpg) | «تتبع الطلب الحي (النسخة الثانية)» `22ace7eb39d842e9a629ce8a211800f5` | home **while an order is on the way** |
| **Dark** | [`home-redesign/dark-no-order.jpg`](home-redesign/dark-no-order.jpg) | «درايفر نيون — Warm Orange + Emerald» `9c792b47bfa241639b600ccbb20606d3` | home **with no order** |

Rejected on purpose, don't use: Stitch's "cleaned-up" light version `533efee5…` (broke two photos), the
«Amber + Gold» dark versions (`2f62c460…`, `605ee2ae…`, `ab6a05cc…`, `84331534…`), and every tinted
light background (mint, celadon, lavender, blue, rose, grey, clay).

The two pictures are two **states** of one home, each drawn in one **theme**. The build needs all four:

| | No order | Order on the way |
|---|---|---|
| Light | layout from the dark picture, light colours | **the light picture** |
| Dark | **the dark picture** | layout from the light picture, dark colours |

## 2. Decisions

| Decision | Choice | Who / when |
|---|---|---|
| Accent orange | `#FF7A1F` in **both** themes (light's persimmon `#E46A3E` is retired) | Ali, 2026-11-01 |
| Dark mode | follows the phone's setting; a switch in حسابي (تلقائي / فاتح / غامق) overrides it | Ali, 2026-11-01 |
| Map card | a **real map**, styled to look like the pictures (not a drawing) | Ali, 2026-11-01 |
| Map card is permanent | always at the top: living town map with no order, courier tracker during an order; tapping it with no order opens the services screen | Ali, 2026-10-28 |
| Services | custom-drawn local symbols, food biggest, live facts under each (no pastel tiles) | Ali, 2026-10-27 |
| Signature | the Tigris river line flowing down the page | Ali, 2026-10-27 |
| Points corner | «120 نقطة · 1,200 دينار» (100 points = 1,000 دينار, `support-credit.ts`) | Ali, 2026-10-27 |
| Fonts | headings Alexandria, body Almarai | Ali, 2026-10-28 |
| Search | right under the map card | critique, 2026-10-27 |

## 3. One layout, top to bottom

> **Changed on 2026-11-02, see §12:** the services are now always their own section «شنو تحتاج؟» (the
> live board), the map card always has a panel under it (order / offers / calm), and the intercity row
> is gone (Baghdad/Kut open at launch, they live in the board's «محافظات» tile).

Everything below exists in both themes. "Idle" = no order; "Order" = an order (or ride) is running.

1. **Header.** Wordmark «درايفر» (dark: a small glowing emerald dot beside it). Points pill
   «120 نقطة · 1,200 دينار»; hidden when the customer has 0 points.
2. **Address.** «نوصلك: البيت ⌄» (`home.deliver_to_none` when no place is set).
3. **Headline.** Idle: the daypart line (`home.daypart.*`, `home.ramadan.*`), e.g. «شنو عشانا اليوم؟».
   Order: «أكلك من مطعم خالد بالطريق» + «يوصل الساعة 1:42 م».
4. **Map card** (radius 28, ~320 tall).
   - *Idle:* live town map (restaurant pins, nearby taxis/tuktuks, carts), a «بث حي · العزيزية» tag, the
     line «العزيزية هسة: 22 مطعم مفتوح · 6 سواق يمّك · 3 عربانات», the «افتح الخريطة ‹» pill and the
     service symbols row (أكل biggest, then تكسي, تكتك, طرود, عربانات). Tap → services screen.
   - *Order:* map with the dashed route, the courier disc and «مطعم خالد ← البيت»; «تحديث مباشر» tag;
     a panel with «عندك طلب شغّال», the stage line («الدليفري بالطريق»), big minutes «12 دقيقة» and
     the four steps طلبت / دا يتحضّر / بالطريق / وصل. A ride uses the same card (`home.active_trip`).
5. **Search** «دور على مطعم أو أكلة» (52 tall, full width).
6. **Services band «شنو تحتاج؟»** — *Order only* (the map card is busy, so the services move here): food
   as a wide row («أكل · 34 مطعم مفتوح هسة»), then four symbols with a live fact each
   («تكسي 4 دقايق», «تكتك 3 دقايق», «طرود لأي باب», «عربانات 5 فاتحة»).
7. **Intercity row:** «قريباً: مقاعد لبغداد والكوت من كراجات العزيزية» + «نبّهني».
8. **Dish.** *Idle:* the big dish card: daylight photo, daypart tag (`home.band.*`, e.g. «للعشا»), dish
   name, «restaurant · price · minutes», full-width «أضيفه +». *Order:* the compact row «للغدا اليوم»
   (photo, name, «restaurant · price», round + button).
9. **«طلبك المعتاد»** (Fridays: «مثل كل جمعة»): photo, restaurant + items on one line, price on the next,
   «اطلب نفس الطلب». Hidden until the customer has a past order.
10. **«مفتوح هسة»** + «كل المحلات ‹», category chips (none selected at first), restaurant cards
    (photo, full name in up to 2 lines, filled star + rating, minutes, «توصيل 1,500 دينار»).
11. **River line** along the left edge (the end side in RTL, so it never crosses right-aligned
    headings), passing behind the sections; it meets the map card's river at the top.
12. **Tab bar:** الرئيسية · طلباتي (dot while an order runs) · المحفظة · حسابي.

## 4. Colours

### Light («sage»)
| Role | Hex | Notes |
|---|---|---|
| page | `#E4EAE1` | never pure white |
| card | `#F1F4EF` | border `#E0E7DC` |
| forest (panels, primary outline buttons) | `#1F3A2B` | raised inside forest `#274836`, line `#2F523E` |
| ink (text) | `#1A231C` | 13.2:1 on page |
| muted text | `#4E5A50` | 5.9:1 on page |
| text on forest | `#F1F4EF` / `#E8EFE5` | muted on forest `#BDCABE` (7.3:1) |
| accent | `#FF7A1F` | text on it `#160D05` (7.4:1) |
| river | `#9DB08A` | lighter inner `#AAC096` |
| map (card style) | land `#EAE5D9`, blocks `#DED6C5`, palms `#99A878`/`#758655`, streets `#FFFFFF` | |
| service symbols | taxi `#E3B23C`, tuktuk `#A9C25B`, parcels `#D2A46B`, carts `#E07A8E`, food = accent | ink outlines `#1A231C` |

### Dark («emerald night»)
| Role | Hex | Notes |
|---|---|---|
| page | `#09110D` | |
| surface (cards) | `#0F1D16` | raised `#15261D`, hairline `#1F372A` |
| headline text | `#F2FFF6` | |
| muted text | `#9FB8A8` | 8.2:1 on cards |
| emerald (river, live dots, glows) | `#00E575` | never body text |
| light emerald (prices, minutes, info) | `#6CFFAE` | 13.7:1 on cards |
| accent | `#FF7A1F` | text on it `#160D05`; glow `0 0 20px rgba(255,122,31,.35)` |
| map (card style) | land `#0A160F`, blocks `#12241A`, streets `#1F3527`, river emerald glow | |
| service symbols | food disc `#C82828`, taxi `#FFE14D`, tuktuk `#00E575`, parcels `#FFB35C`, carts `#FF5FB8` | rings on surface, food filled |

### Rules (checked with WCAG maths on 2026-11-01; the token tests must enforce them)
- **Orange is never text on a light page or card** (`#FF7A1F` on `#E4EAE1` is 2.1:1, fails). In light,
  orange appears as a **fill with `#160D05` text**, or as **text on the forest panel** (4.7:1).
- **Never white text on orange** (2.6:1).
- Light: orange is reserved for the live order (route, courier, minutes, active step), the food symbol
  and the main button. Dark: orange for actions (buttons, selected chip, active tab); emerald for
  anything live or informational.
- Stars on light cards: not plain orange (2.35:1). Use the orange star with an ink outline, or forest.
- The upcoming step label («وصل») on forest: `#75897A` fails (3.3:1) → use `#93A596` (4.75:1) or lighter.
- Dark search placeholder: full `#9FB8A8`, not 60 % opacity (that is 3.5:1).

## 5. Type, size, touch
- Alexandria for headings, numbers and labels; Almarai for body text. Western digits; «دينار» after amounts.
- Sizes: idle headline 32–34; order headline 27; section titles 20–21; card titles 15–16; body 13–15.
  **Nothing below 13 px** (the pictures use 11–12 in a few labels; raise them).
- Tap targets ≥ 44 px (chips 44, buttons 48–52, «نبّهني» and «اطلب نفس الطلب» grow to 44).
- RTL: chevrons in «افتح الخريطة» and «كل المحلات» point left; the route label arrow is «←».

## 6. The map card
- A real map with two card styles that match the pictures: **sage day** (beige land, sage river, white
  streets) and **emerald night** (near-black, glowing emerald river, dim streets). Full-screen maps keep
  the Golden hour style (`2026-10-09-map-golden-hour-design.md`). Another session owns `packages/map`;
  agree the two card styles with it before building.
- Drawn on top: route (dashed orange), courier disc (orange, bike), restaurant pin, home pin; when idle,
  restaurant pins (forest / emerald), tiny taxis (yellow), tuktuks, carts (pink).
- Cheap phones and the data saver: the `lite` map; if the map fails, a designed still picture of the
  town with the live line still showing. Reduce Motion: no pulsing.

## 7. States the pictures don't show (all must be built and screenshotted)
- Loading (the card's shape, not a spinner), offline (`live_map.offline`, `net.offline_*`), map failed.
- Night, all restaurants closed (`home.night_title`, `home.night_first`).
- First visit: no points, no past order, no saved place.
- Every order stage: طلبت, دا يتحضّر, بالطريق, وصل (the river "arrives"), late (the honest-delay new
  time, `docs/api/late-promise.md`), cancelled. A taxi/tuktuk ride running instead of food.
- Two things running at once: the card shows the nearest one with a «+1» chip to switch.
- Fridays, Ramadan dayparts, very long restaurant and dish names, the largest phone text size,
  small (360) and large (430) phones.

## 8. Fixes over the pictures
- Photos: real daylight restaurant photos; a designed fallback when a photo is missing (both pictures
  show broken or dark-wood images).
- The reorder line wraps badly in the light picture: restaurant + items on one line, price on the next.
- No chip is selected at first (the dark picture pre-selects «مشاوي»).
- The light picture lost «قريباً:» on the intercity row; keep it.
- Restaurant names never cut mid-word («مشويات الحاج ك…»).
- The dark search bar has no box inside it.

## 9. Today's home → the new home
Today's home (`apps/customer/app/(tabs)/index.tsx`, surveyed at `a6ac485a`) has more pieces than the
pictures. Nothing is dropped silently: each piece maps somewhere, and Ali confirms the list at review.

| Today | New home |
|---|---|
| `HomeLive` map hero + `HomeHeader` + `SearchField` + `ServicesRow` | header, address, headline, **map card**, search; services move into the map card (idle) or the band (order) |
| `ActiveOrderPill` | replaced by the map card's tracker state |
| `RideHomeCard` | the map card's ride state |
| `BookedRideCard`, `RajaaCard` | the intercity row: shows the real booking / الرجعة state; «قريباً … نبّهني» only where الرجعة isn't open |
| `HourFood` | the dish (big card idle, compact row during an order) |
| `UsualCard`, `FridayCard`, `ReorderCard` | «طلبك المعتاد» (one card; Friday wording on Fridays) |
| `KitchenRows` + its skeleton / failed / night / empty notes | «مفتوح هسة» with chips and restaurant cards, same notes restyled |
| `MapBox` | removed (the map card replaces it) |
| `DinnerCard`, `BaghdadModeCard`, `SeasonCard` | kept, restyled as slim cards under «طلبك المعتاد» |
| `RestaurantRail` (deals), `PromiseDoors`, `QuietEnd` | kept below «مفتوح هسة», restyled |
| `OfflineLine`, `CollapsedBar`, `CartBar`, `FlyToCart`, `ComingSoonSheet`, `WelcomeHome`, `TeaPullScroll`, `SimpleHomeRedirect` | kept as they work today, restyled to the new colours |

## 10. Where it plugs into the code (facts at `a6ac485a`)
- **Theme:** the customer app is fixed to the `istikan` theme (`apps/customer/app/_layout.tsx:53,96-97`,
  status bar fixed dark at :108); nothing reads the phone's setting and there is no theme switch.
  Themes live in `packages/design-tokens/src/tokens.ts` (`themes`, `services` :647, `decor` :686,
  `liveStages` :733) and reach screens through `ThemeProvider` / `useTheme`
  (`packages/ui/src/theme/ThemeProvider.tsx`). Plan: add two themes (light «sage», dark «emerald night»)
  with their own `services` / `decor` / `liveStages`, and choose between them from the phone setting +
  a stored حسابي preference (same pattern as simple mode, `features/simple/pref.ts`).
- **Contrast tests already exist** (`packages/design-tokens/src/contrast.test.ts`: text AA for every
  theme, 3:1 non-text, service tiles, live stages); the new themes join them automatically, and §4's
  rules get explicit cases.
- **Fonts:** Alexandria is loaded only at weight 700 and Almarai not at all (`apps/customer/src/lib/font-files.ts`,
  `lib/fonts.ts`, web `public/index.html:20-24`). Add Almarai 400/700 and Alexandria 500/600/700.
- **Active order:** `useActiveOrder()` (`features/home/queries.ts:37`, polls every 15 s while active).
- **Map:** MapLibre (native `@maplibre/maplibre-react-native`, web `maplibre-gl`), styles as code in
  `packages/map` (`buildMapStyle`, Golden hour lights). The live map only turns on when
  `EXPO_PUBLIC_MAP_TILES_URL` / glyphs are set; otherwise the SVG fallback (`SvgBase.tsx`) draws —
  that fallback becomes the designed still picture of §6.
- **Switch for the new home:** there is no feature-flag system. Use a build-time env var
  (`EXPO_PUBLIC_NEW_HOME`, read in `apps/customer/src/lib/env.ts`) so the studio can show either home;
  remove the old home only after Ali's yes.
- **Tests:** Vitest everywhere; customer tests are logic only (`src/**/*.test.ts`), `packages/ui` renders
  components with Testing Library on react-native-web. No screenshot comparison exists yet.
- **Screenshots:** `apps/customer/scripts/web-shots.mjs` (Playwright, 390 or 360 wide, `SHOTS=` groups,
  `?now=07:30` fakes the hour) has no dark shots; add new-home groups for light/dark and 430 wide.
  The `packages/ui` gallery is fixed to the light theme (`gallery/Gallery.tsx:1210`); add a theme switch.

## 11. How it gets built
Each step is reviewed by Ali from screenshots before the next one starts. The current home stays live
behind a switch until Ali says yes to the whole new home.

1. **Colours as named settings** in `packages/design-tokens`: the two customer themes above, with
   tests that fail on any text/background pair below 4.5:1 (3:1 for icons and large text).
2. **Theme choice:** phone setting + the حسابي switch.
3. **Pieces, one by one, in the component gallery**, each in every state and both themes, each with a
   test written first: map card (idle, tracker), service symbols, search, intercity row, big dish and
   compact dish, «طلبك المعتاد», restaurant card, chips, river line, points pill.
4. **The home assembled** from the pieces, using the demo data and demo hooks (put an order on the way →
   the card turns into the tracker by itself).
5. **Screenshot set:** every state in §7 × light/dark × 360/390/430 wide, compared with the approved set;
   any change is flagged.
6. **Ali's review board:** each picture beside the built screen, yes / fix per screen. Then the switch
   is turned on.
7. **Next slice:** the services screen (map picker «Sage Services - Map picker» `7b270d78…`, taxi chosen
   `d1a21dfc…`), built the same way.

Checks on every step: `pnpm typecheck && pnpm lint && pnpm test`; copy only in the locale files with
`en.json` parity; behaviour tests (which card shows in which state, amounts in دينار, points maths);
accessibility (contrast, 44 px, Arabic screen-reader labels); speed on a cheap Android (map smooth,
fallback works).

## 12. Round 3 decisions (Ali, 2026-11-02) — these win over §1–§11

Reviewed on boards in this thread (files in `/mnt/project-files/home-redesign-v2/round3/`, mocks
`v3.html` same-design light/dark, `v4.html` live board, `v5.html` the four panel states). Ali: "ok build".

### 12.1 One design, two colour sets
Light and dark are **the exact same layout, sizes and pieces**; only the colours change. No piece may exist
in one theme only (the dark picture's glowing dot by the wordmark is dropped; the only glow at night is the
order card's accent). Each component takes its colours from `homeLook[theme]` and nothing else.

### 12.2 The home, top to bottom (with or without an order)
1. Header: wordmark + points pill (**points only**, e.g. «120 نقطة»; hidden at 0).
2. Address «نوصلك: البيت ⌄».
3. Headline. Order: short («أكلك بالطريق»). Idle: the daypart line; Thursday evening «ليلة الخميس».
4. **Map card:** a real map crop (light: day style tinted sage; dark: night style), a live tag that says
   how old the update is («تحديث قبل 20 ثانية»), the route label «مطعم خالد ← البيت» during an order.
   The route line follows the streets and lies on the ground (look B, PR #380, Ali 2026-11-03): driven
   part grey, the road ahead orange with a dark edge and small arrows; step 4 uses `TrackMap3D`'s line.
5. **Panel under the map** (forest in light, deep emerald in dark) in one of three modes:
   - **order** (anything running): stage title, rolling minutes, 4 steps with checks (done = filled
     check, now = orange, next = outlined), the cash row «جهّز 12,500 دينار» + «الخردة علينا، تنحط
     بمحفظتك», the courier (photo or initial, name) and a «راسله» button. A ride uses the same panel.
   - **offers**: «عروض اليوم بالعزيزية» + the meal window («عروض الغدا · لحد الساعة 3»), dish cards with an
     «عرض» badge, the new price and the old price struck through. Offers are merchant-funded deals that
     already exist: **no money rule changes**.
   - **calm**: «أسرع أكل يوصلك هسة», one dish, big minutes, one tap to add.
   - Rule (`panelMode`): order if anything runs; else offers during lunch 12:00–15:00 and dinner
     19:00–23:00 **when at least one offer exists** and the customer hasn't already seen and scrolled past
     that meal's offers; else calm.
6. Search «دور على مطعم أو أكلة».
7. **«شنو تحتاج؟» — the live board, always shown** (concept D «لوحة حيّة», real pictures, no icons, flat
   tiles, no glow):
   - **أكل** (tall, orange): food picture, the open count «22 مطعم فاتح». Unchanged service.
   - **تكسي وتكتك** (one tile, one screen): taxi + tuktuk pictures, live dot, «أقرب سيارة» + «3 دقايق».
     The label is a working name until Ali confirms it.
   - **محافظات** (Baghdad/Kut, open at launch): the GMC picture, the next two real departures
     («بغداد 4:30 العصر», «الكوت 7:00 الصبح») with seat squares (filled = free seat).
   - **طرود** («لأي باب بالعزيزية») and **عربانات** («3 فاتحة هسة»): kept for now; Ali decides the last
     tiles later.
8. Dish, «طلبك المعتاد» (first for regulars, quiet during an order), «مفتوح هسة», chips, restaurant cards,
   as in §3 items 8–10.
9. River line in the end margin, thicker; it fills orange as the order moves forward.

### 12.3 Round 1 picks (Ali: "yes to all", 2026-11-02)
Cash + courier + chat on the order card; one glow at night; food is orange in dark; short headline during an
order and only the order card is forest; the intercity tile shows real departures; the usual order first for
regulars; «+» asks before a second order; points pill shows points only; the live tag shows the update's age;
thicker river; river fills as the order advances; map lit by the real time of day (later, map owner);
rolling minutes, gliding courier, one haptic per step (plays once, honours Reduce Motion); «ليلة الخميس» +
«للعائلة» chip; one local photo look (later, pictures thread).

Round 2 (16–26) is not decided yet; nothing from it is built. Pick 24 (order for parents' house) is a money
rule and waits for Ali.

### 12.4 What step 3 builds (in `@driver/ui/home`, kept out of partner and merchant bundles)
`panelMode` + `mealWindow` (logic, tests first), `HomeMapCard`, `OrderPanel`, `OffersPanel`, `CalmPanel`,
`LiveBoard`, `PointsPill`, `RiverLine`; all in the gallery in both themes. The dish, «طلبك المعتاد»,
restaurant card and chips follow in step 3b.
