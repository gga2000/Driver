# Customer app joy — program design

Date: 2026-10-05. Status: **approved scope** (Ali, joy board https://claude.ai/artifact/TDLpwrrQfVf9gY8Qhamktc:
99 ideas Yes, 2 Maybe, 4 No, 2 blank; all 12 decisions taken; follow-up answers in §2). This is the
program-level design. Each sub-project (§5) gets its own implementation plan before any code is written.
Evidence and findings: `docs/research/ui-ux-audit/2026-10-05-joy/` (README + six reports; finding ids such
as D-03, F-02, L-05, R-04, W-02, S2-01 below point there).

## 1. Goal

Take the customer app from "correct" to "loved". Today it is honest, fast and careful, but it shows no
food, has no sense of time, uses one orange for seven meanings, its peaks are silent (rides) or
interrupted (the push pre-prompt over the map), and a الرجعة trip has no ending. The program gives it:
food people can see, a look that is unmistakably Aziziyah ("Istikan"), moments that land (the kitchen's
yes, the driver reveal, delivered with the courier, the safe arrival), and reasons to come back that come
from usefulness and generosity, never from tricks. Calm by default with a few special moments (maps D5),
applied app-wide and switched off on mourning days.

## 2. Decisions (taken by Ali; do not re-litigate)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| J-D1 | Look | **A · Istikan** | Token roles per research report 5 §5: tea `#E08A1E` = main action and food only; kashi `#0B6577` = live and moving; ink `#24170E` = selected; saffron `#F2C14E` = deals, points, stars; palm = done; pomegranate = danger. Deeper paper `#F6EEDF`, warm surface `#FFFCF6`. |
| J-D2 | Typefaces | **Alexandria + Marhey + IBM Plex Sans Arabic** | Alexandria 700 for headings ≥ 22 px and hero numerals (has tabular digits); Marhey 700 only for brand lines ≤ 6 words, never prices or timers; Plex for all UI and body. ≈ +0.3 MB; fonts load behind the splash. |
| J-D3 | Food pictures | **Photo day + illustrated set**, with Ali's follow-up: **hold the real illustrator and photographer for later; generate AI images now** | J4 produces an AI-generated illustration set in one stylised "Aziziyah sketchbook" style. Never photorealistic dish images: a drawing must not pretend to be a restaurant's real food. Real photos replace drawings dish by dish later. |
| J-D4 | Night theme | **After launch** | Until then the app forces light (`userInterfaceStyle: "light"`) so system keyboards and alerts don't turn dark over light screens. Dark tokens keep being maintained and tested. |
| J-D5 | Retention strategy | **Useful town + generosity first**, certain rewards underneath | No chance-based rewards, no streak shame, no fake urgency or scarcity (report 6 §5 "What not to do" is binding). Weekly rhythms, not daily. |
| J-D6 | Orders below a restaurant's minimum | **Allow with a small-order fee of 500 دينار** | Server-computed (`smallOrderFeeIqd` already exists in pricing and postings). Shown on the restaurant facts and as a named price line with its reason. **Built 2026-10-06** (`docs/api/small-order-and-points.md`). |
| J-D7 | Ride search with no driver | **Offer the other vehicle after 3 minutes** | Matches `customerFreeCancelAfterSec = 180`: at 180 s the customer sees «ما لگينا تكتك فاضي هسة · نجرب تكسي؟» with a server re-quote they confirm, "ضل دوّر", or free cancel. |
| J-D8 | «أني نازل» when unreachable | **2 extra free minutes, once** | Extends `UNREACHABLE_FAIL_AFTER_MS` by 120 s for that stop, one time; the courier sees "الزبون نازل". |
| J-D9 | Minute wording | **Natural Iraqi forms** | «دقيقة» (1), «دقيقتين» (2), «{n} دقايق» (3–10), «{n} دقيقة» (11+). Reverses voice spec §5's single form; update the spec and the glossary test. |
| J-D10 | Points redemption order | **Delivery first** | Reverses `redemption()` in `apps/api/src/modules/ledger/postings.ts` ("service fee first", decisions §2). Update the decisions doc, the function, its tests and the copy together. **Built 2026-10-06** with f13 (`docs/api/small-order-and-points.md`). |
| J-D11 | Tiers (Silver/Gold) | **Later, once points can be spent** | w2 waits for f13 and w1. |
| J-D12 | Expo upgrade | **Before launch, after the fixes** | J2 runs after J1 and before maps SP1's native work, so native modules (MapLibre, background location) are installed once, on the new SDK. |
| J-D13 | Customer app ID | **`iq.driver.customer`** | Already in `apps/customer/app.json` and `docs/deploy/mobile.md`; CLAUDE.md corrected 2026-10-05. |

## 3. Where we are (2026-10-05)

- **Solid base**: tokens with CI-tested contrast, RTL and Arabic line heights; honest delay credit; per-person
  cart; الرجعة seat rule, hold and PIN pass; total in every CTA; guest browse; search with Arabic folding;
  offline strip; tracking moments shipped (story camera, almost-there, glide, delivered burst, four tones);
  maps SP5c shipped (live share page over SSE, nearby vehicles before booking).
- **Biggest gaps** (report ids): no food imagery (D-01, F-01, S2-07); no time awareness (D-02, D-03); one hue
  with seven jobs and warning = brand (S2-01, S2-02); push pre-prompt over the live map (L-01, C-23); rides
  have no moments and drivers no face (L-02, L-06, R-01); الرجعة has no ending (R-04); points can't be spent
  (W-02); celebrations and sounds play on mourning days and on silent Androids (f8, L-24).

## 4. Architecture

- **Tokens first.** Istikan lands in `packages/design-tokens` as new semantic roles (`selected`, `onSelected`,
  `live`, `liveTint`, `liveText`, `inverse`, `onInverse`, `deal`, `onDeal`, `identity.*`, `art.*`), retuned
  `bg/surface/sunken`, a structural warning (inverse banner + saffron icon, no tint-only meaning), new motion
  tokens (`spring.settle/celebrate/hop`, `duration.camera/ambient/celebrate/digitRoll`, `distance.enter/nudge`,
  `stagger`) and a `haptic.events` map. Every new foreground/background pair goes into `contrastPairs` /
  `nonTextPairs` first. Components in `@driver/ui` change once; screens follow.
- **Motion presets.** `packages/ui/src/motion/presets.ts` (fadeIn, panelIn, sheetIn, pop, hop, digitRoll) wired
  to reduced motion; app code stops hand-tuning durations (S2-16, L-19).
- **Moments engine.** `features/track/moments.ts` grows ride moments (`matched`, `driver_here`) and a single
  "celebration allowed" gate that reads the season state (quiet days) and a once-per-order persistence key.
- **Season state.** One server read (`app.season` on a public router, cached; Console writes it) returns
  `{ quiet: boolean, celebrations, sounds, promos, accent?, homeCard? }` for "now" in Asia/Baghdad. J1 ships
  the minimal version (quiet days set by ops) so f8 meets 13 Nov; J6 grows it into the full season system.
- **Art pipeline.** `FoodArt` becomes an image-first component: `photoUrl` → AI illustration asset by dish
  key → current SVG motif as last resort, with the no-same-neighbour rule. Assets are bundled WebP/PNG at
  1×/2×/3× (or served from storage later), each ≤ 40 KB, fixed pigments in both themes.
- **Server-owned money.** Small-order fee, redemption order, ride re-quote, points estimates, stamp cards,
  savings totals and tier progress are all computed by the API and only displayed by the app.

## 5. Sub-projects

Board ids in brackets. Sizes: S days · M 1–2 weeks · L 3–5 weeks (AI-assisted).

### 5.1 J1 — Fix first (phase 0) · ~2 weeks

**Deadline item first: f8 quiet days (before ~13 Nov 2026).** Minimal season state (§4) with ops-set quiet
days; when quiet: no delivered burst, no celebration haptic, no moment sounds, no promotional pushes, no
"firsts". Seed the next dates for ops to confirm: 3 Jumada II (~13 Nov 2026), 25 Rajab (~3–4 Jan 2027).

Then, grouped by surface:
- **Tracking**: f1 push ask moves to the kitchen-waiting screen as an inline card (never a modal over the
  map); f2 delivered overlay once per order (persisted key, or within 10 min of `deliveredAt`); f3
  almost-there at server `courier_near` or ETA ≤ 2 min, swapping to «حيدر عند بابك» at the door; f19 no
  straight line across water when `onRoad = false`, minutes as a range, courier framed with look-ahead;
  f18 unreachable spotlight + «أني نازل» (J-D8).
- **Rides**: f4 `matched` / `driver_here` moments (haptic, cue, card with the plate), on-trip actions
  (share first, cancel hidden in transit); f5 driver photo + plate everywhere incl. request board and
  demand claim, no pre-selected cheapest offer; f6 search stages + the 3-minute offer (J-D7); f9 SOS sheet
  order (emergency 911 first, car card, «فريق درايفر»).
- **Food**: f10 deal prices on the menu and sheet (server `dealPriceIqd`); f11 minimum-order progress above
  the CTA + gap-closing upsell; the **small-order fee** (J-D6) end to end; f12 night home (first to open,
  «خبرني لمن يفتح»); b3 interim food drawings per dish (no identical neighbours, water bottle, laban glass,
  fixed pigments).
- **Money and points**: f13 «استخدم نقاطي» at checkout, redemption **delivery first** (J-D10); f14 referral
  copy = 200 points (2,000 دينار) after the friend's second order.
- **System**: f7 sounds silent on Android ringer silent/vibrate (or moments via a notification channel that
  honours DND); f17 late banner becomes the inverse banner, warning hue moves off the brand hue; f21 live
  regions for status, route line redraw throttled (≤ 15 fps path updates or dash-offset), 12 px floor,
  stars ink + saffron; force light mode (J-D4).
- **Copy and bugs**: f15 (double ticks, orphan dot, stale prep note, chat ticket number, toast over the
  pass, clipped plate at 360, back button on deep-linked screens); f16 wording sweep incl. J-D9 minute forms
  and the voice-spec update; h6 honest welcome copy and live proof.
- **Not in J1**: f20 app icon and splash waits for the brand symbol (open question 1) and moves to J4.

Acceptance: every item has a test where it has logic (moments, gating, redemption order, fee, unreachable
extension, minute forms); web screenshots at 360 and 390 before/after; nothing regresses the honest-delay,
cash hand-off or deal-honesty copy.

### 5.2 J2 — Expo upgrade [t2] · 1–2 weeks

Upgrade SDK 52 → the current stable SDK, one major at a time, with `npx expo install --fix` (never pinned
from memory). Replace `expo-av` with `expo-audio`. Re-verify Reanimated, react-native-svg, expo-router,
notifications and the web export; run every app's tests and screenshot scripts. Coordinate with the maps
session: SP1 (EAS dev builds, MapLibre native, background location) starts on the upgraded SDK.

### 5.3 J3 — Istikan look (phase 1) [b1 b2 b6 b8 b10 b11 b12 b13 + phase-1 UX] · ~2 weeks

- **Tokens** (§4) and **fonts** (`@expo-google-fonts/alexandria`, `@expo-google-fonts/marhey` via
  `npx expo install`), splash hold until fonts load.
- **Components**: Button (haptic only on primary/destructive), Chip/Segmented/Stepper/Radio (ink selected
  + check, neutral stepper), Avatar (identity palette, never semantic colours), Card (`rest` and `lift`
  recipes, no accent border on tint), StatusPill, EmptyState, PermissionPrompt (scene slot), StatusBanner
  (inverse warning), the inverse live-order card, arch frame component.
- **Service glyphs** [b8]: food skewer-on-plate, taxi with roof sign, tuktuk with fringe, garage minibus,
  parcel, basket, school bus, woman, family; duotone active variants.
- **Food on home** [b6]: restaurant rows use FoodArt / photo, cuisine chips become round dish pictures.
- **Sound logo** [b11]: a tea-glass clink family (clink1, clink2, near, logo, coin), ≤ 30 KB each,
  ≈ −16 LUFS, Android `orders` channel sound. AI-generated or synthesised now, real recording later (same
  rule as art).
- **Phase-1 UX items**: o4 tap-to-scroll required choice, o9 checkout order (payment first), l7 chat live
  header, l8 share sheet preview + "ended safely" page state (builds on SP5c), r1 traveller type once +
  personal availability, r4 trips in طلباتي and Help, w1 points rules and expiry, w5 approvals with
  context, w7 wallet moments, w9 safety page, h8 zone-first address, h9 bell → points chip, h10 الرجعة card
  direction.

### 5.4 J4 — AI art set (runs alongside J3) · ~2 weeks

- **Style guide** (one page, in the repo): "Aziziyah sketchbook": flat gouache shapes, one 2 px date-brown
  line, paper grain, arch-topped frames, pigments from `art.*`. Prompts and seeds recorded per asset so the
  set stays consistent and can be regenerated.
- **Set**: ≈ 30 dishes (report 5 S2-07 list), ≈ 15 scenes (welcome, empty states, waiting kitchen,
  rejected, offline, push ask doorbell, arrival door, safe arrival), 4 animated moments later as Lottie.
- **Honesty rule**: stylised illustration only, never photoreal; no people's faces except the generic
  avatar style; no logos or real shop signs.
- **App icon and splash** [f20] once the brand symbol is chosen (open question 1).
- **Later (out of this program)**: real illustrator redraw [b4] and the menu photo day [b5].

### 5.5 J5 — Signature moments (phase 2) · 4–5 weeks, four slices

- **J5a Food**: o14 kitchen says yes (waiting scene, accept celebration with clink, ETA as a clock), o1
  add-to-cart flight + living cart bar, o2 item sheet hero, o3 portions «يشبّع», o5 family mode (household
  chips, «للسفرة»), o7 points estimate, o8 most ordered / favourite / tags, o10 cash change chips (+ courier
  job card), o11 pre-order closed kitchens with day chips, o12 ordering for someone else (who pays,
  WhatsApp tracking link), o13 two-tap reorder, o15 rejection that explains.
- **J5b Live and rides**: l2 driver reveal, l3 kitchen progress from real events, l4 delivered with the
  courier + compliments (courier app receives them), l1 **Android** ongoing lock-screen notification
  (supersedes maps c8 for Android; iOS Live Activity after J2), t1 long-press shortcuts.
- **J5c Home and discovery**: h1 time-aware home (daypart band), h3 live-order card with progress, h4 one
  search for the whole town (+ unmet-search log), h7 welcome-home moment, g8 firsts.
- **J5d الرجعة and account**: r2 «وصلت بالسلامة» ending (rating chips, family told, «احجز رجعتك»), r3
  boarding pass as an object (date, countdown, stub; Apple Wallet later), r7 faster board, w8 tappable
  transactions, w10 account header.

### 5.6 J6 — Seasons [s1 s2 s4] · 2 weeks, start December, Ramadan live by mid-January 2027

Full season system in the Console (Ramadan, Eid, mourning, Friday), home cards, slot rules; Ramadan mode
(iftar slots by the timetable each person picks, suhoor hours, no promos in the 20 minutes before iftar,
courier iftar break); the local taste panel (s4) confirms dates and wording. Ramadan ≈ 8 Feb 2027.

### 5.7 J7 — Habit, family and generosity (phase 3) · 4–6 weeks

h2 «العزيزية اليوم» + «قدر اليوم» (Merchant app one-tap daily pot, follow a dish), h5 «مطاعمنا» (owner consent),
s3 usuals + «غدا الجمعة» (unparks maps p4), w4 family hub «بيتنا» with monthly budgets, w6 «شهرك» insights
and savings, g1 «عزيمة» send a meal, g2 invite as a gift (money rule as decided), g7 WhatsApp stickers, r5
regular trips, r6 «عشاك يوصل وياك», l9 favourite drivers (scheduled rides and الرجعة only), l6 safer rides
(unparks maps s1/s2: auto-share, ride check, PIN), o16 stamp cards (merchant-funded; money rule — Ali
approves the promotion type), w3 rolling points expiry (money rule), l5 share card, g9 year story (first
run December 2027), w2 tiers after f13/w1 (J-D11).

### 5.8 J8 — Later

o6 group link, t3 home-screen widgets, t4 «شنو آكل اليوم؟» helper in search. Maybe (not scheduled): g3
pay-for-me link, s5 summer cold chain. Not doing: g4 charity meals, g5 multi-door «وزّع», g6 Eidiya, t5
voice ordering. Blank (parked): h11 living service tiles, s6 Arbaeen service.

## 6. Cross-cutting rules

- **Money**: every amount, fee, discount, points value, re-quote and savings figure comes from the server.
  J-D6, J-D7, J-D8, J-D10, o16, w3, g2 are approved money changes; anything else touching money asks Ali.
- **Ethics** (J-D5): no chance rewards, no fake urgency or scarcity, no streak shame, real counts only,
  promotional pushes opt-in with quiet hours 23:00–07:00, none before iftar or during Friday prayer.
- **Culture**: quiet days switch off celebration, sound and promotion; Sunni/Shia Ramadan and Eid dates are
  never assumed; no rewards tied to religious travel; no photos of women in marketing surfaces.
- **Privacy**: first names only for couriers and drivers; share cards never show address or price; family
  live status only for members who opt in; town-level popularity needs ≥ 20 orders.
- **Arabic and RTL**: all copy in `ar-IQ.json` / `en.json` with parity; Marhey never for numbers; Western
  digits; «دينار» after every amount.
- **Motion and sound**: every animation has a reduced-motion variant; one ambient loop at a time; sounds
  ≤ 30 KB, respect silent mode on both platforms and the in-app switch.
- **Performance** (reference: 3 GB-RAM Android): transforms and opacity only; no per-frame SVG path
  rebuilds; paper grain as one static layer; font + art payload budget ≤ 1.5 MB added to the bundle.
- **States**: every new surface has loading, empty, error and offline states.

## 7. Order of work

| Step | Sub-project | Gate |
|---|---|---|
| 1 | **J1** (f8 quiet days first, by ~13 Nov) | Tests green; Ali reviews before/after screenshots |
| 2 | **J2** Expo upgrade | All apps build, tests and screenshot scripts pass; maps SP1 informed |
| 3 | **J3** Istikan look + **J4** AI art in parallel | Ali approves the look on the web studio at 360/390 |
| 4 | **J5** a → b → c → d | Each slice reviewed by Ali |
| 5 | **J6** seasons (start December) | Ramadan mode live by mid-January 2027 |
| 6 | **J7** habit and family | — |
| 7 | **J8** | After launch is stable |

Each sub-project: implementation plan (writing-plans) → small commits → `pnpm typecheck && pnpm lint &&
pnpm test` → screenshots → Ali reviews. Another session works on the maps program in the same repo:
fetch and rebase before every push, and check the maps spec before touching tracking, share, routes or
`packages/map`.

## 8. Testing

- Pure logic with injected clocks: moments and celebration gating, season state, minute forms, daypart,
  search intents, reorder, points estimate display, small-order fee and redemption order (API), unreachable
  extension, ride offer timing.
- Contrast: every new token pair in `contrastPairs` / `nonTextPairs` (both themes).
- Visual: `web-shots.mjs` gains 360×740 runs and a deals-flow fix (the conflict prompt broke the capture run
  during the audit); before/after sets per sub-project.
- Devices: J1 and J5b end with a check on a real Android for silent mode, haptics and the lock-screen
  notification (needs the maps SP1 dev build).

## 9. Costs

| Item | Cost |
|---|---|
| Fonts (Google Fonts, OFL) | free, ≈ +0.3 MB |
| AI image generation for J4 | small, per image (provider chosen in the J4 plan) |
| Real illustrator and photo day (later) | to be quoted |
| WhatsApp templates (gifts, family pings) | per message, capped |

## 10. Open questions for Ali

1. The brand symbol (brand spec: direction A/B/C still open). Blocks the app icon and splash (f20).
2. Emergency numbers and the ops line for SOS (also maps §11 question 2).
3. Who sits on the local taste panel (s4), and the trusted calendar source for quiet days.
