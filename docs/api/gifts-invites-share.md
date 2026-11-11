# Gifts, invitations, stickers and the share card (joy J7b, 2026-10-07)

Plan: `docs/superpowers/plans/2026-10-07-j7b-generosity.md`. Migration: `20261007200000_j7b_gifts_invites`
(two order columns, `invite_codes`, `referrals`; ids and codes only). **No money rule changes.**

## «عزيمة» — a meal as a gift (g1)

### `orders.place` → `gift`

`PlaceOrderInput.gift?: { hidePrices: boolean }` marks a food or grocery order as a gift for the person who
receives it. The server checks (`modules/orders/gift.ts`, `giftProblem`):

| Case | Answer |
|---|---|
| no `recipient` participant | `gift_needs_recipient` |
| `hidePrices` with `paymentMethod: 'cash'` | `gift_hidden_prices_need_wallet` (the person at the door must hear the amount) |
| a ride, errand or parcel | `invalid_input` |

Payment is unchanged: the recipient pays cash at the door, or the sender pays from his wallet (o12). Stored
on `orders.gift` / `orders.gift_hide_prices`; every `Order` view carries `gift: { hidePrices } | null`.

- **Courier** — `PartnerJobStop.gift` on the order's stops. The partner app shows «هدية» on the drop-off,
  «هدية · لا تذكر السعر» when the prices are hidden (nothing to collect: wallet), and at the kitchen «هدية ·
  خلي المطعم ما يحط الوصل بالكيس».
- **Kitchen** — `BoardOrder.gift`: a «هدية» chip on the card; with hidden prices the printed ticket carries
  no amount at all («هدية · بدون أسعار: لا تحطون الوصل بالكيس»).
- **The card line and the heads-up never reach the server.** The sender's app keeps the recipient's name,
  number and line on the phone (`features/gift/gift-store.ts`, last 10) and sends «عازمك على أكلة من مطعم خالد…
  «بالعافية يمه» تابعها من هنا: <link>» from his own WhatsApp or SMS, with `tracking.createShareLink`'s page.
  No WhatsApp template, no cost, nothing personal stored.

## Invite as a gift (g2)

The referral rule already in the ledger (decisions §1, `MoneyRules.referral`): **200 points to each side**
(worth 2,000 دينار: 100 points = 1,000), once the friend completes his **2nd cash order of at least
10,000 دينار**, at most **10 friends a month** for the inviter (`PostingService.referral`). It could never
pay before: no closed order named the inviter. Now the orders module sends `referredBy` with the closed
order's money fact (`OrdersService.bindReferrals`), and the ledger decides as before.

| Procedure | Who | What |
|---|---|---|
| `referral.mine` | signed in | `{ code, path: '/i/<code>', rule, invited, rewarded, friends }`; the code (6 characters, no 0/O/1/I/L) is made on the first ask. `rewarded` = the inviter's own `referral_bonus` lines. |
| `referral.preview({ code })` | public | `{ valid, inviterFirstName, rule }` for the landing page. The first name is the inviter's own choice to share (read as himself). Limited per caller (the person, or the address for guests): 120 a minute, and after 30 unknown codes in an hour the preview answers `rate_limited` for the rest of that hour (`INVITE_PREVIEW_RATE`). |
| `referral.claim({ code })` | signed in | Once per person, never your own code, only before your first order: `invite_invalid`, `invite_own`, `invite_already_claimed`, `invite_not_new`. Claiming the same code again answers like the first time. Returns the inviter's first name (a logged vault read, `invite_claim`). |

`rule` = `{ pointsPerSide, pointValueIqd, minOrderIqd, unlockOnOrder, monthlyCap }` from the money rules: the
apps word these numbers and never write their own.

Web: `scripts/deploy/prepare-web.mjs` writes `invite.html` (the app with a preview card: title, description,
`og:image` = `<base>/invite-card.png`) and `_redirects` (`/i/* /invite.html 200`), so WhatsApp shows the card
when an invitation is sent. Base URL: `--base-url` or `EXPO_PUBLIC_SHARE_BASE_URL`.

### The fingerprint: device + phone + home place (decisions §1)

A referral pays only when the friend shares none of these with the inviter, nor with anyone on a referral
that already paid (either side). Marks are one-way and peppered; nothing raw leaves its module:

| Part | Source | Mark |
|---|---|---|
| phone | identity (`phoneHashOf`) | `p:` the peppered phone hash |
| device | identity `devices.fingerprint` (every device the person signed in from) | `d:` peppered by identity (`referralMarks`) |
| home | places, the person's own `label = home` pins | `h:` the pin's map cells (≈ 44 × 37 m, four grids shifted by half a cell so pins under half a cell apart always share one), peppered by identity |

Checked when the claim is accepted and again at payout (each closed order of the friend, until
`referral:<friend>` exists in the ledger). Stored on `referrals.referee_marks` / `referrer_marks`; a block sets
`blocked_reason` (`shared_device|shared_phone|shared_home|device_earned|phone_earned|home_earned`) and
`blocked_at` once, never cleared, and the closed order then carries no `referredBy` (no points). The friend
sees no error; `referral.mine.friends[]` lists each friend as `waiting` («بعده»), `counted` («انحسبت») or
`not_counted` («ما انحسبت»), first names by a logged vault read (`invite_list`).

## Stickers (g7)

Eight stickers from the sketchbook (`STICKERS` in `@driver/ui`), exported by
`apps/customer/scripts/stickers-export.mjs` to `apps/customer/assets/stickers/` — 512×512 WebP under 100 KB,
`tray.png` 96×96, `contents.json` (WhatsApp's sticker-pack metadata). The app sends one at a time through the
share sheet (web: Web Share with the file, else a download). Adding the whole pack to WhatsApp needs an
Android ContentProvider and an iOS pasteboard bridge (a native part, a later development build).

## Share card (l5)

App only, no API. `features/share-card/`: one model (`shareCardModel`), drawn as a view (phone: captured with
react-native-view-shot at 1080×1920, shared with expo-sharing) or on a canvas (web). No price, number or
address; the first name only when «حط اسمي» is on. On the order screen once delivered or finished, and under a
finished الرجعة trip.
