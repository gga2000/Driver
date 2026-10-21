# «أكل بيت» — home kitchens (2026-10-11)

People who cook at home sell through Driver like a small restaurant (Ali's concept A). Each dish is either
**ready** («جاهزة»: cooked today, so many plates left) or **by reservation** («بالحجز»: the customer
books a day and a pickup time). There is no kitchen visit or health inspection (Ali, 00:47Z 10-11). The
commission is 10 % (tier `home`). Customers see the kitchen's name, dishes and distance, never the home;
the courier gets the door only for the pickup.

Behind the city switch `homeKitchens.launched` (`packages/contracts/src/city-config.ts`), off by default.
While it is off, kitchens stay hidden from customers and home orders are refused. Switching it on is Ali's
call.

## Model
- A kitchen is a `restaurant` org whose storefront has `home: { monogram }` (null monogram → the first
  letter of the name's last word, `kitchenMonogram`).
- Each dish's `homeSale` lives on `catalog_items.home_sale` (migration `20261010590000`):
  `{ mode: 'ready', cooked, cookedOn, setAt }` or `{ mode: 'reserve', rule: ReserveRule }`.
- Limits are in `HOME_KITCHEN_RULES` (`packages/contracts/src/home-kitchens.ts`): subtitle ≤ 60 letters,
  portion ≤ 30, book ahead 4 h / 1 day / 2 days, ≤ 4 pickup times, ≤ 50 plates per time, booking up to
  7 days ahead, ≤ 200 plates cooked a day. The city keeps UTC+3 all year.

## Customer procedures
- `catalog.homeKitchens({ cityId })` → the city's kitchens with ready and reservation counts, plus
  `open` (the switch).
- `catalog.homeSlots({ merchantId, itemId })` → the next free pickup times of a reservation dish and how
  many plates each has left.
- A reservation is an ordinary food pre-order at that time (`scheduledFor`). There is no second system.
  `homeOrderProblem` (`apps/api/src/modules/orders/home-kitchen.ts`) refuses a cart that mixes ready and
  reservation dishes, a ready dish with a time, a ready dish beyond its plates left
  (`catalog_item_unavailable`), and a reservation outside the dish's own times or over `maxPerSlot`
  (`order_schedule_invalid`).

## Reservation no-show (Ali, 22:51Z 10-11; courier pay 21:58Z 10-12)
When the courier can't reach the customer on a home reservation (`unreachableDispute`), the order becomes
`failed` and the cook is paid in full. The courier who made the trip is paid too, and the customer owes
both («Customer pays»). One ledger group `order:<id>:home_no_show` (a replay posts nothing):
- `cancellation_fee` payer → `merchant_cash:<org>` for `itemsTotalIqd`, memo `home_no_show`.
- When a courier was on the trip that gave up (the order's courier link for that trip): the delivery fee,
  split exactly as at order close (`courierDeliveryIqd` in `ledger/postings.ts`): his part payer →
  `driver:<id>` (his earnings, never `cash:`, since no cash changed hands), memo `home_no_show`; a batched
  second trip's 30 % margin payer → `platform`, memo `batched_margin`.
- Free delivery from the kitchen (a merchant delivery deal): the customer owes only what checkout showed
  (fee − deal). The courier still gets his full part; the gap is one line `platform` → `driver:<id>`,
  memo `home_no_show:delivery_deal`, paid by Driver.

Example: 2 plates for 16,000 دينار with a 2,000 دينار delivery fee: the cook gets 16,000, the courier
2,000, and the customer owes 18,000. The payer is the account the order used (his wallet or his
household's). It reads below 0, the amount is added to the next order (M-3 style), and a new reservation
is refused with `home_reservation_owed` while his own wallet, or the household wallet the new order would
pay from, is below 0.

## Cook procedures (Merchant app, «أكلاتي»)
- `merchantAdmin.home.get({ merchantOrgId })` → her dishes, today's plates and the reservations coming.
- `merchantAdmin.home.saveDish(…)`: owner only. Staff can't change dishes or prices.
- `merchantAdmin.home.setToday({ merchantOrgId, itemId, left, cooked? })`: owner and staff.

## Joining («تطبخ من البيت؟ سجّل مطبخك»)
- `ops.homeKitchenApply({ cityId, kitchenName, cookName, door, landmark? })`. Any signed-in person can
  call it from the Merchant app's gate. It creates the org (owner = the applicant, no role grant yet), the
  door as its location (`outside_zone` when the door is outside the city's zones), and an onboarding of
  type `home_kitchen` in state `submitted` with a follow-up task. Her name goes to the identity vault only
  if she has none (`nameIfMissing`). Each person has one pending application; a second call returns it.
  The input never carries a commission, tier or price.
- `ops.myHomeKitchenApplication()` → `{ state: none | submitted | active | rejected, kitchenName,
  submittedAt, rejectReason }`.
- Staff approve it in the Console's approvals queue («مطبخ بيت»). Nobody can approve their own
  application (`approval_own_item`: she is both its sender and its contact). Approval grants `merchant_owner` and emits `merchant.activated` with `type: 'home_kitchen'`.
  `HomeKitchenActivation` (`apps/api/src/modules/merchant/home-kitchen-activation.ts`) then makes the
  storefront a hidden home kitchen with tier `home` and no «جهّز محلك». It is keyed on the org, so a
  second delivery changes nothing. The welcome message links to `/home-kitchen` instead of `/setup`.

## Demo
- Customer demo API: four kitchens (`@driver/contracts/demo-home-kitchens`), never in `pnpm db:seed`.
- Merchant demo cook: `0770 888 0000` (`scripts/demo/home-kitchen.mjs`).
- Screenshots: `scripts/shots/home-kitchen.mjs`, `scripts/shots/join-kitchen.mjs`. Map pictures need
  `EXPO_PUBLIC_MAP_TILES_URL` and `_GLYPHS_URL` in the export.
