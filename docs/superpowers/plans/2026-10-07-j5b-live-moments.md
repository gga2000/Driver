# J5b — Live order and ride moments — Implementation Plan

> **For agentic workers:** implement task by task, TDD where there is logic, commit after every task
> (plain-English message ending in the Co-Authored-By line). Steps use checkbox (`- [ ]`) syntax.

**Goal:** a live order or ride feels looked after from the first yes to the door: the kitchen's real
steps show as they happen, the person who is coming arrives as a warm reveal (face, name, car, plate,
rating), the delivered moment has the courier in it and lets the customer say a kind word he actually
receives, an Android phone keeps the order on the lock screen, the app icon has long-press shortcuts,
and the ETA box wears the Istikan "live" colour (kashi) instead of the food orange.

**Spec:** `docs/specs/2026-10-05-customer-joy.md` §5.5 (J5b: l1, l2, l3, l4, t1), §2 J-D1 (kashi = live
and moving), §6 cross-cutting rules. Ideas: `docs/research/ui-ux-audit/2026-10-05-joy/3-live-moments.md`
(S-1 lock screen, S-2 reveal, S-3 kitchen theatre, S-4 «شكراً حيدر», L-02, L-06, L-08, L-23),
`6-delight-strategy.md` (F1 lock-screen live, F3 app shortcuts, D8 compliments), `5-design-system.md`
(kashi row of the palette, S2-21 numbers).

**Money rules: none change.** Compliments carry no money. The tip flow (`orders.tipOptions` /
`orders.tip`, `docs/api/tips.md`, `TipOffer`) is not touched: the rating panel keeps rating → tip, and
the compliment card sits between the thanks and the tip without changing either. The shift guarantee
stays off.

**Do not touch:** `packages/map/**`, map feature folders, zones/places API, Console map pages (another
session); the driver-photos module and its approval flow (we only *read* `CourierCard.photoUrl`, which
is already the approved main photo); the tips flow; `docs/before-launch.md` items.

---

## Architecture

- **Kitchen progress (l3)** is a pure function over the order's real timestamps (`acceptedAt`,
  `preparingAt`, `readyAt`, `pickedUpAt`). A stage is *done* only when its event exists; *cooking* is
  *active* only between `preparingAt` and `readyAt`. Nothing fills over time: no event, no movement
  (S-3 honesty rule). The strip lives in the collapsed sheet of a food order before pickup.
- **Driver reveal (l2)** is a new moment in `moments.ts`: rides already have `matched`; food gets
  `courier_assigned` (no courier → courier). The reveal card plays once per order (a stored key, like
  the delivered moment f2) on a live transition, or when the order is opened within 60 s of the
  accept (he tapped the push). Feedback goes through `momentFeedback` (quiet days: no sound, no
  celebratory buzz) and the sparkle ring around the photo only when `season.celebrations` and not
  reduce-motion. The rating it shows is real: `CourierCard.rating` was always `null`; the tracking
  module now fills it from the delivery scores customers gave him (last 50, shown only from 5).
- **Compliments (l4)**: a new `order_compliments` table (one row per order: courier, customer, keys)
  owned by the orders module (`OrderComplimentsService`, beside tips, own file, no shared code with
  tips). `orders.complimentOptions` / `orders.compliment` for the customer (orderer only, delivered,
  rated ≥ 4 for the courier/driver, within 24 h, a courier carried it, keys from the order type's set,
  once per order — a replay returns the first). Event `order.complimented` → notify template
  `compliment_received` to the courier («زينب قالتلك: سريع، مؤدب»). The Partner app reads them through
  `driverAccount.compliments` (all-time counts + the last 20) and `ShiftSummary.compliments` (this
  shift's counts). Customer names never travel: the push uses the vault's logged first-name read like
  the tip push; the Partner list shows keys, the order ticket and the time only.
- **Lock screen (l1, Android)** mirrors the الرجعة pass that already ships
  (`features/rajaa/lockscreen/*`): a pure content mapper (`liveNoticeCard`, tested), a device file
  (`ongoing.native.ts`: expo-notifications, own LOW-importance channel «تتبع الطلب», `sticky`, replaced
  in place by identifier, a dismissible «وصل طلبك · قيّم» at the end) and a web/test no-op
  (`ongoing.ts`), driven by a root watcher that follows the active order (`orders.mine` + `orders.track`)
  and refreshes as soon as an order push arrives. Not on web, not in Expo Go (no native notifications
  module there for this), not on iOS.
- **iOS Live Activity: not built in this slice (designed below).** It needs a widget-extension target
  (Swift/SwiftUI) added by a config plugin, an Apple team with the push key, and APNs live-activity
  pushes (push-to-start and update tokens) sent by the API. We can't compile or run any of that here
  (no iOS dev build, no Apple developer account yet — joy open question 1, `docs/before-launch.md`
  accounts), and the candidate packages are pre-1.0 (`expo-live-activity` 0.4.2) or a general target
  tool (`@bacons/apple-targets` 5.0.0). Building it blind would not be "clean". Design: §iOS below.
- **Shortcuts (t1)**: `expo-quick-actions` 6.0.2 (Evan Bacon, maintained, works on SDK 57: an Expo
  module with a web stub; installed with `npx expo install`, pinned). Items are dynamic
  (`setItems`): «وين طلبي؟» only while an order is live, «اطلب نفس الطلب» when there is a last
  delivered meal, «احجز الرجعة» always. Routing by `params.href` (`useQuickActionRouting`, in the tabs
  layout, as the package asks). Pure mapper tested. iOS icons are SF Symbols; Android shows the app icon
  until the brand symbol exists (f20).
- **ETA box (kashi)**: `DepartureTime` gets a `live` tone (tiles `liveText`, digits `surface`), the box
  a `liveTint` wash and a `liveText` eyebrow. Late stays the warning look. In the `light`/`dark` themes
  `live*` equal the accent values (J3a), so the Partner/Merchant apps don't change. A range instead of
  one time is **an open question for Ali**: built behind `ETA_BOX_SHOWS_RANGE = false` (and `?etaRange=1`
  in dev-tools web builds, for the comparison screenshot only).

## File map

| File | Change | Responsibility |
|---|---|---|
| `packages/ui/src/components/DepartureTime.tsx` | modify | `live` tone |
| `packages/design-tokens/src/tokens.ts` | modify | contrast pairs for the live tiles and the box |
| `apps/customer/src/features/track/eta-display.ts` (+test) | create | `ETA_BOX_SHOWS_RANGE`, `etaBoxContent()` |
| `apps/customer/src/features/track/SheetParts.tsx` | modify | kashi ETA box, range variant |
| `apps/customer/src/features/track/kitchen-progress.ts` (+test), `KitchenProgress.tsx` | create | l3 stages from events; the strip |
| `apps/customer/src/features/track/moments.ts` (+test) | modify | `courier_assigned`, `revealPlays()` |
| `apps/customer/src/features/track/DriverReveal.tsx` | create | l2 reveal card |
| `packages/contracts/src/tracking.ts` | modify | `publicCourierRating()` rule (min 5, last 50) |
| `apps/api/src/modules/tracking/*` | modify | `TRACKING_RATINGS` port; card rating |
| `packages/contracts/src/order-compliment.ts` (+test) | create | keys per order type, offer/result schemas, rules |
| `packages/db/prisma/schema.prisma` + `20261007210000_j5b_order_compliments` | create | `order_compliments` |
| `apps/api/src/modules/orders/compliments.ts` (+test), repository | create | rules, store, event |
| `packages/contracts/src/routers/orders.ts`, `orders.rpc.ts` | modify | `complimentOptions`, `compliment` |
| `packages/contracts/src/domain-events.ts`, `notify-io.ts`, notify subscribers | modify | `order.complimented` → `compliment_received` |
| `packages/contracts/src/driver-account-io.ts`, `driver-account.service.ts`, router | modify | `compliments` query, `ShiftSummary.compliments` |
| `apps/partner/app/compliments.tsx`, `ShiftParts.tsx`, account tab | create/modify | «كلام الزبائن» |
| `apps/customer/src/features/track/Compliments.tsx`, `Arrival.tsx` | create/modify | courier in the delivered moment; chips after the thanks, before the tip |
| `apps/customer/src/features/track/lockscreen/*` | create | l1 Android ongoing notice |
| `apps/customer/src/lib/push.native.ts` | modify | the live notice is listed, never a banner, never a sound |
| `apps/customer/src/features/shortcuts/*`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app.json` | create/modify | t1 |
| `packages/i18n/src/locales/ar-IQ.json`, `en.json` | modify | all copy |
| demo APIs, READMEs, `docs/api/compliments-and-live.md` | modify/create | demo hooks and docs |

---

## Task 1 — Tracking ETA box: tea → kashi

- [ ] Test `eta-display.test.ts`: `etaBoxContent({eta, now, basis:'road', showRange:false})` →
  `{kind:'time', minutes}`; `showRange:true` → `{kind:'range', low, high}` from `minutesRange(m,
  'estimated')` (the same honest spread the map pill uses); past ETA → minutes 1.
- [ ] `DepartureTime` tone `live` (`liveText` tiles, `surface` digits); contrast pairs `surface` on
  `liveText` (tile digits), `liveText` on `liveTint` (eyebrow), `textMuted` on `liveTint` (sub line).
- [ ] `SheetHeader`: box `liveTint`, eyebrow `liveText`, tiles `live`; late keeps `warningTint` +
  `warning`. Range variant: big «12–18» in `liveText` (Alexandria, tabular) over «دقيقة». The range
  shows only with `ETA_BOX_SHOWS_RANGE` or `?etaRange=1` in a dev-tools web build.
- [ ] Commit.

## Task 2 — l3 kitchen progress from real events

- [ ] Test `kitchen-progress.test.ts`: rides / cancelled / waiting → null; accepted only → `accepted`
  done, `cooking` todo; `preparingAt` → cooking active (time = preparingAt); `readyAt` without
  `preparingAt` → cooking done with no time; `pickedUpAt` → all done; never "active" without its event;
  `stageLabelKey` for each (picked up names the courier when known).
- [ ] `KitchenProgress`: four segments (palm done, tea active with a soft pulse that stops under
  reduce motion, line for todo), labels under them, the time under each done one (Western digits), one
  accessible sentence («المطعم قبل 6:10 · يطبخون من 6:12 · …»).
- [ ] Order screen: in the collapsed sheet (`below`) for food from accept until pickup; the collapsed
  height grows by the strip.
- [ ] Commit.

## Task 3 — l2 driver reveal (+ the real rating)

- [ ] Contracts: `publicCourierRating(scores)` → `{rating, count} | null` (newest 50; null under 5;
  one decimal) + test.
- [ ] API tracking: `TRACKING_RATINGS` (`courierScores(courierId)`, built from trips `forDriver` and
  orders' delivery scores); `courierCard` fills `rating`/`ratingCount`; cached with the card. Test in
  `tracking.service.test.ts`.
- [ ] Customer moments: `courier_assigned` (food, no courier → courier, not at the door); feedback
  `light`, no cue; `revealPlays({seen, liveTransition, acceptedAt, now})` (60 s window) + tests.
- [ ] `DriverReveal` card over the map: photo 72 (initial fallback), eyebrow «لگينالك سايق» /
  «دليفري طلبك», name, vehicle words, plate (rides `lg`), «★ 4.8 · 37 تقييم» only when the server has
  it, «متحقق اليوم»; sparkle ring only when celebrating; closes by itself after 8 s or by «×»;
  `accessibilityLiveRegion="assertive"`. Stored key `reveal-seen:<orderId>`.
- [ ] Commit.

## Task 4 — l4 compliments (server)

- [ ] Contracts `order-compliment.ts`: `ComplimentKey` (`fast`, `polite`, `hot_food`, `found_home`,
  `smooth_ride`, `clean_car`); `complimentKeysFor(type)` (food-like: fast, polite, hot_food,
  found_home; ride: polite, smooth_ride, clean_car, fast); `COMPLIMENT_RULES` (`minRating` 4,
  `windowHours` 24, `maxKeys` 4); `ComplimentOffer`, `ComplimentInput`, `ComplimentResult`,
  `CourierCompliments`; `complimentReason(order, now)` pure + tests. Errors `compliment_not_offered`,
  `compliment_invalid` (+ copy).
- [ ] Prisma `OrderCompliment` + migration `20261007210000_j5b_order_compliments` ending with
  `driver_harden`.
- [ ] `OrderComplimentsService` (in-memory + Prisma repository): `options`, `send` (orderer only,
  once per order, replay returns the first), `forCourier(courierId, {from?, to?})`; event
  `order.complimented`. Tests with the orders test harness.
- [ ] Router + rpc. Notify: `compliment_received` (Partner, push, `orders` channel, deep link
  `driver-partner://compliments`), vault purpose `notify_compliment_received`.
- [ ] `driverAccount.compliments` + `ShiftSummary.compliments` (default `[]`).
- [ ] Commit.

## Task 5 — l4 compliments (apps)

- [ ] Customer: `ArrivalOverlay` (food) shows the courier — photo, «{name} وصّل طلبك» — under the
  title (rides already say «ويا عباس»). `RatingPanel` done step: thanks/points → `ComplimentCard`
  (only when `complimentOptions.offered`: «شنو عجبك بـ حيدر؟», multi chips, «دزها لـ حيدر», then «وصلت
  لـ حيدر») → `TipOffer` unchanged.
- [ ] Partner: shift summary «قالوا عنك بهالشفت» (chips with counts, hidden when none); account row
  «كلام الزبائن» → `/compliments` (all-time counts, then the last 20 with ticket and time; empty,
  loading, error and offline states).
- [ ] Commit.

## Task 6 — l1 Android lock-screen notice

- [ ] `lockscreen/content.ts` + test: `liveNoticeCard(input, t, clock)` for food (sent, accepted,
  cooking, ready, courier coming, on the way, at the door, delivered) and rides (searching, matched,
  at pickup, on the trip, arrived): title, body (ETA «يوصلك ~7:05 م» when known, plate for rides once
  matched), `sub` = stage dots «●●●○○», `sticky` until the end, a dismissible end card, null when
  cancelled/failed; `liveNoticeKey` for "same card, don't re-post".
- [ ] `ongoing.native.ts` / `ongoing.ts` (no-op), `useLockScreenOrder` root watcher (Android only,
  signed in, push permission granted), end card once per order watched live; push arrival → refetch.
- [ ] `push.native.ts`: data `kind: 'live_order'` → listed, no banner, no sound.
- [ ] Commit.

## Task 7 — t1 app shortcuts

- [ ] `npx expo install expo-quick-actions` (pinned 6.0.2), plugin in `app.json`.
- [ ] `shortcuts.ts` + test: `quickActionItems({signedIn, activeOrderId, canReorder}, t)` → ordered
  items with `params.href` (`/order/<id>`, `/?reorder=last`, `/rajaa`); guests only get الرجعة.
- [ ] `QuickActionsSync` at the root (`setItems` when the key changes; no-op on web), routing in
  `app/(tabs)/_layout.tsx`, home starts the reorder sheet for `?reorder=last`.
- [ ] Commit.

## Task 8 — Demo, docs, screenshots

- [ ] Customer demo: `/demo/track?scenario=kitchen_accepted` (accepted, no courier, not cooking),
  `/demo/track/kitchen?orderId&step=preparing|ready`, `/demo/track/assign?orderId` (a courier with
  rated history takes it now), `&rated=1` on scenarios (the courier gets six rated past deliveries),
  `/demo/ride/accept` already exists. Rated arrival for compliments.
- [ ] Partner demo: `/demo/compliments?who=courier` (compliments on his recent jobs).
- [ ] `docs/api/compliments-and-live.md`; READMEs' demo hooks; `docs/api/driver-photos.md` untouched.
- [ ] Screenshots 390 and 360 to the scratchpad `j5b/`: ETA box (time, late, range option), kitchen
  strip (accepted, cooking, ready), reveal (ride, food), delivered with the courier, compliments,
  compliments sent + tip, Partner shift summary and «كلام الزبائن». Look at each; fix.
- [ ] Commit.

## Task 9 — Finish

- [ ] `git fetch origin && git rebase origin/main`; migration still sorts last.
- [ ] Fresh `pnpm install --frozen-lockfile`; `pnpm build && pnpm typecheck && pnpm lint && pnpm test`.
  No order/ledger money path changes (compliments are a new side table), so no sim run is needed; run
  it anyway if anything in `orders.service.ts` changes.

---

## iOS Live Activity (designed, not built)

1. **Native target.** A widget extension `DriverLive` (SwiftUI, iOS 16.2+) added at prebuild by
   `@bacons/apple-targets` (or the `expo-live-activity` plugin once it reaches 1.0), with
   `NSSupportsLiveActivities = YES` in the app's Info.plist. One `ActivityAttributes` type
   `LiveOrderAttributes { orderId, kind: food|ride, merchantName }` with `ContentState { stage,
   stageIndex, stageCount, title, body, etaAt?, plate?, ended }` — exactly the fields
   `liveNoticeCard()` already produces, so the mapper is shared.
2. **Views.** Lock screen: stage segments, the ETA as a clock (kashi), the name and plate; Dynamic
   Island compact: stage glyph + minutes; expanded: name, plate, «اتصل» deep link. RTL by
   `layoutDirection`, Western digits, IBM Plex Sans Arabic bundled in the extension.
3. **Start/update.** The app starts the activity when an order turns live (foreground), and registers
   its push token with the API (`notify.registerLiveActivity({orderId, token})`). The API sends APNs
   `liveactivity` pushes (`apns-push-type: liveactivity`, topic `iq.driver.customer.push-type.liveactivity`)
   on each stage change, with the same content state; push-to-start (iOS 17.2+) lets the server start
   it when the app is closed. Ends with «وصل طلبك» and `dismissal-date` +30 min.
4. **Needs:** the Apple developer account and the APNs key (before-launch accounts), an EAS dev build
   for iPhone, the API's APNs sender (token-based auth). Effort: M.

## Deviations (decided while planning)

- **Compliments after the rating, not instead of it.** The research put a heart on the delivered screen
  and chips after 4–5 stars. We keep one place (the rating panel's done step) so the delivered screen
  stays calm and the order rating → (compliments) → tip is preserved; the delivered moment gets the
  courier's face and name instead of a second button.
- **Kitchen strip stops at pickup.** After pickup the map, the ETA and the timeline carry the story;
  the strip would only show four ticks.
- **Shortcut icons on Android** wait for the brand symbol (f20): the launcher shows the app icon.
- **The reveal's rating** needed a server source (`CourierCard.rating` was a placeholder): delivery
  scores customers already gave, newest 50, shown from 5 ratings. Same window the scorecard uses.
