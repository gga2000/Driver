# J7b — Generosity and sharing — Implementation Plan

> **For agentic workers:** implement task by task, TDD where there is logic, commit after every task
> (plain-English message ending in the Co-Authored-By line). Steps use checkbox (`- [ ]`) syntax.

**Goal:** people can treat each other through Driver: send a meal to another house as a gift («عزيمة»),
invite a friend as a gift (the referral rule that already exists, finally wired), carry the brand into
their WhatsApp groups as stickers, and share a warm picture after a meal, a ride or a الرجعة trip.

**Spec:** `docs/specs/2026-10-05-customer-joy.md` §5.7 (g1, g2, g7, l5), §6 cross-cutting rules, §8
testing. Ideas: `docs/research/ui-ux-audit/2026-10-05-joy/6-delight-strategy.md` (D1 «عزيمة», D7
gift-framed referral, A2 stickers, H1 story card; §4 and §10 of the signature list). Art:
`docs/specs/2026-10-06-sketchbook-style.md`. Voice: `docs/specs/2026-10-02-voice-and-microcopy.md`.

**Money rules: none change.**
- g1 uses the two payment ways o12 already has (the recipient pays cash at the door, or the sender pays
  from his wallet). «خلي الأسعار مخفية» is only offered when the sender pays from the wallet: with cash
  the person at the door must hear the amount.
- g2 uses the referral rule that is already in `MoneyRules.referral` and `PostingService.referral`
  (decisions §1, edge-case decisions §1): **200 points per side** (100 points = 1,000 دينار, so 200 =
  2,000 دينار), unlocked by the friend's **2nd completed cash order of at least 10,000 دينار**, at most
  **10 friends a month** for the inviter. The ledger code existed but nothing ever told it who invited
  whom (`referredBy` was never sent), so no referral could ever pay. This slice records the invitation
  and sends `referredBy` with the closed order; the amounts come from the server's rules, never from
  copy. The audit's unused string (`points.referral`, «2,000 دينار نقاط») is replaced by copy built
  from the server's figures.

**Architecture:**
- **Gift (g1)** is two flags on the order (`orders.gift`, `orders.gift_hide_prices`, public, not
  personal). The card message never reaches the server: it goes from the sender's phone to the
  recipient's WhatsApp (or SMS) inside the heads-up text, with the live tracking link (o12's
  `tracking.createShareLink`). That keeps the message private by design (nothing to put in the vault)
  and costs no WhatsApp template. The courier's job card and the kitchen ticket learn the order is a
  gift (and whether to keep prices out of the bag) from the order.
- **Invites (g2)** live in a new `referrals` API module with two public-schema tables
  (`invite_codes`, `referrals`; ids and codes only — names stay in the vault, read through identity's
  logged first-name read). The orders module asks it for the inviter when it builds the closed
  order's money fact; the referrals module asks orders (through a bound function, no import cycle)
  whether a claimant is new.
- **Stickers (g7)** are drawn from the sketchbook set (`@driver/ui` art) by a gallery page and exported
  by a script to 512×512 WebP + a 96×96 tray PNG + WhatsApp's `contents.json`, bundled in the customer
  app. Sharing uses the platform share sheet (native: expo-sharing; web: Web Share with files, else a
  download).
- **Share cards (l5)** are one model (`share-card.ts`, pure) drawn twice: a React Native view (native
  capture with react-native-view-shot, the partner «شارك يومك» pattern) and a canvas on the web (the
  art's SVG serialized onto the canvas, text with the app's loaded fonts). No price, no address, the
  first name only when the person turns it on.

**Tech stack:** Zod + tRPC contracts, NestJS (in-memory + Prisma repositories), Prisma migration, Expo
SDK 52 (expo-sharing 13.0.1 and react-native-view-shot 4.0.3 — the versions the partner app already
uses), `@driver/ui` art, vitest, Playwright (screenshots and the sticker export).

**Not in this slice (other sessions):** home (J7a), الرجعة/wallet/account/safety/share sheet (J5d,
merged — only one-line hook points here), packages/map, tips and driver photos.

---

## File map

| Area | Files |
|---|---|
| Contracts | `order.ts` (`PlaceOrderInput.gift`, `Order.gift`), `partner-io.ts` (`PartnerJobStop.gift`), `merchant-io.ts` (`BoardOrder.gift`), new `referral-io.ts` + `routers/referral.ts`, `router.ts`, `trpc.ts`, `errors.ts`, `index.ts` |
| DB | `schema.prisma`; migration `20261007140000_j7b_gifts_invites` (orders columns + `invite_codes` + `referrals`, ends with `driver_harden`) |
| API | `modules/orders` (gift validation and storage, `referredBy` on the money fact, `placedCount`), `modules/partner` (stop gift), `modules/merchant` (board gift), new `modules/referrals`, `trpc/trpc.module.ts`, `app.module.ts` |
| Customer | `features/gift/*` (gift.ts + test, gift-store.ts, GiftCard.tsx), `app/checkout.tsx`, `app/kitchen/[id].tsx`, `app/order/[id].tsx` (actions), `features/invite/*` (invite.ts + test, queries), `app/invite.tsx`, `app/i/[code].tsx`, `lib/guard.ts`, `features/stickers/*`, `app/stickers.tsx`, `assets/stickers/*`, `features/share-card/*` (share-card.ts + test, ShareCardView, render.ts / render.native.ts, ShareCardPanel), `app/rajaa/pass/[id].tsx` (one hook line), `app/(tabs)/account.tsx` (two rows), `scripts/demo-api.mjs`, `scripts/web-shots.mjs`, `scripts/stickers-export.mjs`, `README.md` |
| Partner | `app/job.tsx` (gift note on the drop-off), `src/features/work/gift.ts` (+test) |
| Merchant | `src/print/receipt.ts` (+test), `src/features/board/OrderCard.tsx` (gift chip), `locales/*.json` |
| UI | `packages/ui/src/art/stickers.ts` (+test), `packages/ui/gallery/Stickers.tsx`, Gallery `#stickers` |
| Copy | `packages/i18n/src/locales/{ar-IQ,en}.json` |
| Deploy | `scripts/deploy/prepare-web.mjs` (`/i/*` page with the preview card, `_redirects`), `apps/customer/public/invite-card.png` |
| Docs | `docs/api/gifts-invites-share.md`, this plan |

---

## Task 1 — Contracts and database

- [ ] `PlaceOrderInput.gift?: { hidePrices: boolean }` (food/grocery only); `Order.gift: { hidePrices } | null` (optional for old clients).
- [ ] `PartnerJobStop.gift?: { hidePrices: boolean } | null`; `BoardOrder.gift?: { hidePrices: boolean } | null`.
- [ ] `referral-io.ts`: `InviteRule` (pointsPerSide, pointValueIqd, minOrderIqd, unlockOnOrder, monthlyCap), `InviteView` (code, path `/i/<code>`, rule, invited, rewarded), `InvitePreview` (inviterFirstName, rule, valid), `ClaimInviteInput`, `ClaimInviteOutput`, `ReferralsPort`. Router `referral.{mine, preview (public), claim}`.
- [ ] Errors: `gift_needs_recipient`, `gift_hidden_prices_need_wallet`, `invite_invalid`, `invite_own`, `invite_not_new`, `invite_already_claimed` (+ ar/en `error.*`).
- [ ] Prisma: `Order.gift`, `Order.giftHidePrices`; `InviteCode {personId @id, code @unique, createdAt}`, `Referral {refereeId @id, referrerId, code, claimedAt}` (+ index on referrerId). Migration `20261007140000_j7b_gifts_invites` ending with the `driver_harden` call.
- [ ] Contract tests: gift input parses, invite path shape. Commit.

## Task 2 — API: gift orders (g1 server)

- [ ] Test first (`orders/gift.test.ts`): `giftProblem({gift, participants, paymentMethod, type})` → null for a wallet gift with a recipient; `gift_needs_recipient` without one; `gift_hidden_prices_need_wallet` for hidden prices with cash; non-food types refuse a gift (`invalid_input`).
- [ ] `orders.place` checks it, stores the flags (in-memory + Prisma), `Order.gift` in every view; idempotent replays keep it.
- [ ] Partner `activeJob`: drop-off and pickup stops carry `gift`; merchant board orders carry `gift`.
- [ ] Service test through `place` → `get` and the partner job. Commit.

## Task 3 — API: invites (g2 server)

- [ ] Test first (`referrals/referrals.service.test.ts`):
  - `mine` makes one code per person (6 characters from an unambiguous alphabet, no 0/O/1/I), stable on repeat; `rule` equals `AZIZIYAH_MONEY_RULES.referral` + `points.pointValueIqd`.
  - `claim`: unknown code → `invite_invalid`; own code → `invite_own`; a second claim → `invite_already_claimed`; a person with orders → `invite_not_new`; success records `{refereeId, referrerId}` and returns the inviter's first name.
  - `referrerOf(id)` → the inviter or null.
  - `mine.invited` counts claims; `rewarded` counts the inviter's `referral_bonus` ledger lines.
- [ ] Orders: `moneyFact` sends `referredBy` from the referrals port; e2e test: friend claims, closes two cash orders ≥ 10,000 → both points accounts get 200 (`referral_bonus`), nothing after one order.
- [ ] Wire `ReferralsModule` (in-memory/Prisma repo), `ctx.referrals`, router. Commit.

## Task 4 — Customer: «عزيمة» at checkout (g1 app)

- [ ] Test first (`features/gift/gift.test.ts`): `giftAllowed(recipientKind)`; `hidePricesAllowed(payment)`; `giftInput(state, payment)` (hidden prices dropped with cash); `giftMessage({sender, merchant, card, url, at})` → the WhatsApp text (card line only when written, trimmed to 80 characters); `smsUrl(phone, text, os)` (`?` on Android, `&` on iOS); `CARD_SUGGESTIONS`.
- [ ] Checkout: when the receiver is not me, a «عزيمة؟» card: switch «هذا الطلب هدية», the card message (chips «بالعافية يمه»، «بالعافية حبيبي»، «سلامتك»، «تستاهل» + a field, 80 characters), «خلي الأسعار مخفية» (only with «أني من محفظتي»; with cash the reason line). Recipients also list the saved people (cart store), not only the cart's.
- [ ] `gift-store.ts` keeps `{orderId → name, phone, card}` on the phone (last 10) so the kitchen screen and the order screen can send the heads-up; `buildPlaceOrderInput` sends `gift`.
- [ ] Kitchen screen: for a gift, the card reads «دز لـ {name} خبر العزيمة» with «واتساب» and «رسالة» (SMS); order screen action «دز لـ {name} خبر العزيمة» while it is live; the order sheet says «عزيمة لـ {name}».
- [ ] Commit.

## Task 5 — Courier and kitchen know it is a gift

- [ ] Partner test (`gift.test.ts`): `giftNote(stop)` → `hidden` («هدية — لا تذكر السعر»), `gift` («هدية»), or null.
- [ ] Job card: the note on the drop-off (above the cash line; with hidden prices there is no cash to take anyway) and on the pickup («هدية · لا تحط الوصل بالكيس»).
- [ ] Merchant receipt test: a hidden-price gift prints «هدية · بدون أسعار» and no amounts (no payment amount, no items total); the board card shows a «هدية» chip.
- [ ] Commit.

## Task 6 — Invite as a gift (g2 app)

- [ ] Test first (`features/invite/invite.test.ts`): `inviteMessage(code, url, firstName)`, `ruleLines(rule)` (amounts and points from the server rule: «200 نقطة إلك و200 إله — تسوى 2,000 دينار»), `inviteUrl(path)`.
- [ ] `app/invite.tsx`: arch art, «عزّم صديقك», the rule in plain words, the code, «ابعثها بالواتساب» (wa.me text), «شارك» (system sheet), «عزمت {n} · وصلتك نقاط من {m}», stickers link; loading / error / offline; guests are asked to sign in.
- [ ] `app/i/[code].tsx` (public): «{name} عازمك على درايفر», the rule, «سجّل وخذ العزيمة» (remembers the page, sign-in, then claims) or the claim result; invalid / own / not-new / already states.
- [ ] Account: rows «عزّم صديقك» and «ستيكرات درايفر». Remove the stale `points.referral` string.
- [ ] `prepare-web.mjs`: writes `invite.html` (index.html with the invite preview tags: title, description, `og:image` = `<base>/invite-card.png`) and `_redirects` `/i/* /invite.html 200`; `public/invite-card.png` (1200×630, from the export script). Commit.

## Task 7 — WhatsApp stickers (g7)

- [ ] `packages/ui/src/art/stickers.ts` + test: 8 stickers `{id, art, lineKey, emojis}` (1–3 emojis each, unique ids, art kinds exist): بالعافية (tray), وصل الأكل (door), يمّه شكد طيب (dolma), جاي بالطريق (tuktuk), وصلت بالسلامة (minibus), على حسابي (kebab), استكان چاي؟ (tea), صحة وعافية (rice).
- [ ] Gallery `#stickers`: each sticker's art alone, transparent, testID `sticker-art-<id>`.
- [ ] `apps/customer/scripts/stickers-export.mjs`: builds nothing itself; serves `gallery-dist`, serializes each art SVG, composes on a 512×512 canvas (white die-cut outline, the line in Marhey with a white rim), exports WebP under 100 KB, a 96×96 tray PNG, the invite preview card, and `contents.json` (identifier, name, publisher, tray, stickers with emojis).
- [ ] `app/stickers.tsx`: the pack in a grid, tap one to send it (native share sheet / Web Share / download), the line under each, «ضيفها كلها للواتساب» explained as a deviation (below).
- [ ] Commit.

## Task 8 — Share card (l5)

- [ ] Test first (`features/share-card/share-card.test.ts`): `mealWord(at)` (ريوگ before 11:00, غدا to 17:00, عشا after, Baghdad clock), `shareCardModel({kind, dishName?, merchant?, vehicle?, toCity?, firstName?, includeName}, at)` → art + headline + sub (no price or address, name only when included and present), `cardFileName`.
- [ ] `ShareCardView` (9:16, the arch with the dish or scene, the headline in Marhey, the sub line, «درايفر · العزيزية»), `render.ts` (web canvas 1080×1920 → Web Share / download), `render.native.ts` (view-shot + expo-sharing).
- [ ] `ShareCardPanel` (preview, «حط اسمي» switch, «شارك»), hooks: order screen action «شارك الفرحة» once delivered/finished; الرجعة pass after `SafeArrival` (one line).
- [ ] Commit.

## Task 9 — Demo, docs, screenshots

- [ ] demo-api: `POST /demo/gift?personId=…` (a wallet gift to «أمي» at مطعم خالد with hidden prices, on the way, so the courier/kitchen/customer views show it); `POST /demo/invite?personId=…` (a friend who claimed the code and two who are on their way); README hooks.
- [ ] Partner demo: the gift order reaches a courier (if the partner demo serves job cards from the same seed) — README hook.
- [ ] `docs/api/gifts-invites-share.md`.
- [ ] web-shots group `gift`: checkout gift card, kitchen heads-up card, invite, invite landing, stickers, share card panel; 390 and 360.
- [ ] Commit.

## Task 10 — Finish

- [ ] `git fetch && git rebase origin/main`; migration timestamp still newest; `git merge-base --is-ancestor origin/main HEAD`.
- [ ] Fresh `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test`.
- [ ] Screenshots at 390 and 360, the sticker images and share cards, looked at.

## Deviations (decided while planning)

- **Native «add to WhatsApp» (Android `ENABLE_STICKER_PACK` intent):** WhatsApp only takes a pack from
  an app that serves the files through its own Android ContentProvider. That needs native code (a
  config plugin), which Expo SDK 52 without a development build can't run and this session can't build
  or check. Shipped: the share fallback on every platform (tap a sticker → share sheet → WhatsApp sends
  the WebP as a sticker), plus the exported pack files and `contents.json` ready for the native part.
- **The card message stays on the sender's phone** (in the WhatsApp/SMS text), not on the server.
- **Household members as gift recipients:** the household view only has masked phones, so a member is
  offered once they are a saved person with a phone (the existing «لمنو؟» flow); not new server reads.
- **Referral fingerprint (device + phone + home place, decisions §1):** not built; this slice checks one
  claim per person, never your own code, and only before the friend's first order. Question for Ali.
