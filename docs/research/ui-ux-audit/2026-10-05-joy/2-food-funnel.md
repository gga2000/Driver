# Slice 2: The food purchase funnel (restaurant → item → cart → checkout → kitchen → reorder)

Audit only, 2026-10-05, current `main` (`0cb0f39`) web export on a private copy (`:8190` + demo API `:3210`).
Screenshots: `shots/` (shared capture run) and `shots-extra/food/` (mine: scrolled cart/checkout, quick-add
timing, item-sheet variants, family order, kitchen wait at 12 s, acceptance, orders + reorder, 360×740 guest
run, second-kitchen conflict). Closed/busy states could not be captured (the demo keeps kitchens open all day)
and were reviewed in code. The OTP rate limit (10 per hour per IP, shared with other agents) stopped a signed-in
360×740 checkout capture, so 360 was captured as a guest.

Methods applied: page-CRO (value, CTA, friction, objections), form-CRO on the item sheet and checkout (field
cost, optional-field hiding, disabled-submit handling), marketing psychology (goal gradient, peak-end,
endowment, anchoring, default effect, mental accounting; ethical only), design critique (first impression →
usability → hierarchy → consistency → a11y), UX copy against `docs/specs/2026-10-02-voice-and-microcopy.md`,
the AI-slop/template test and three persona walk-throughs.

Already fixed since the 2026-10-04 audit: C-04 wallet at checkout, C-05 promo field hidden, C-06 deal
explanation in the cart, C-15 orders rows and reorder, C-17 offline/slow states, C-18 guest browsing.
**Still open in this slice:** C-10 (food imagery), C-23 (push pre-prompt over the map), C-25 (orange
steppers), C-28 (`سلتك فارغة` and the kitchen-wait repetition), C-29 (amounts without دينار), C-31 (cash
change chips), C-35 (most-ordered, favourite, menu search), C-37 (countdown ring), C-42 (64 px sheet thumb),
and the rest of C-04 (points toggle).

---

## 1. Joy score and tap counts

**Joy score: 5 / 10 now → 9 / 10 target.** The slice is correct and honest (about 7.5 for craft and
correctness) but almost joyless. Nothing moves when you add food, every kebab looks the same, and the two
emotional peaks (the kitchen saying yes, and coming back to reorder) have no ceremony. The parts that are
built (per-person cart, deal honesty, rejection recovery) are better than Talabat's. They just don't
feel delicious.

| Journey | Driver today (taps) | Benchmark | Target | How |
|---|---|---|---|---|
| **First order**, signed in, one dish with a required choice (لفة تكة + bread) | **7**: restaurant → dish → bread → ضيف للسلة → cart bar → كمّل الطلب → اطلب هسة | Talabat 7 · Uber Eats 7 · Deliveroo 6 (basket and checkout on one screen) | **6** | Cart and checkout merge into one scroll when address, payment and time defaults are known (F-18, F-25) |
| First order, no-choice dish (quick +) | 5 | 5–6 | 5 | Already good; make it feel good (F-03) |
| **Reorder** from the home card | **3** when nothing changed (card → كمّل الطلب → اطلب هسة), **4** when the sheet shows changes | Swiggy "Repeat" 3 · Talabat reorder 4–5 · Uber Eats "Order again" 4 | **2** | Express reorder sheet with total, address and payment that places directly (F-25) |
| Reorder from the orders tab | 4–5 | 4–5 | 3 | Same sheet |
| **Family order for 4** (kebab kilo to share, 2 kids' wraps with different breads + 1 note, soup, 4 Pepsis) | **22 taps + 2 typed names + 1 note** first time; **18** once the kids are saved on the device | Uber Eats / DoorDash group order: host about 6 taps and everyone adds their own; solo host about 20 | **about 13** | Household members as chips, an "اطلب لـ" mode, a "للسفرة" chip, an inline stepper on the dish card (F-11, F-12, F-03, signature S-2) |

### Persona walk-throughs (red flags)

- **Umm Ali, dinner for 6, different wants.** She opens مطعم خالد and sees nine identical kebab
  cartoons (`food-restaurant-full.png`). "كباب بالكيلو: نص كيلو / كيلو" never says how many it feeds, so
  she guesses. The kilo is for the table but has to belong to "أنا". Her household (منار، حسين) is set up
  in the account but isn't offered in "لمنو؟", so naming each kid takes 3 taps and the keyboard.
  Every add stacks a black toast on the orange bar. At checkout she scrolls past two empty note boxes to
  find out she's paying cash. After she taps اطلب she watches a 90-second countdown, and when the kitchen
  says yes she is shown a notification permission sheet.
- **Student, one wrap, 4,000 دينار cash.** Wrap 2,000 + delivery 500 + service 500 = 3,000, so he can
  afford it, but "أقل طلب 5,000 دينار" blocks him. In the cart the button is disabled and the reason sits
  900 px below it (`shots-extra/food/s360-cart-guest.png`). The upsell rail doesn't know he is 2,500 short,
  so his only way out is to leave.
- **Ordering for an elderly father across town.** "منو يستلم؟ → شخص ثاني" works (name + phone). Nothing
  says who pays: the courier will ask the father for cash unless she spots the wallet row 1,700 px down.
  Nothing offers to send him the tracking link either.

### AI-slop / template test

The restaurant page and checkout would pass as "a generator made this": cream background, a white card
with a soft shadow, orange chips, and one illustration repeated down the menu. The checkout reads as a
form with seven H2 sections. What you could **not** fake is "لمنو؟" with "نقاط هذا الصنف تروح لـ سارة",
the per-person cart, "بالشارع −250", "طبّقنا الأوفر إلك… العروض ما تنجمع" and "انقل سلتي لهنا". Push
that specificity into the visuals.

---

## 2. The roast

1. Nine of the thirteen dishes at مطعم خالد share one cartoon skewer, and شنينة, بيبسي and ماي صحي are
   the same red can. The menu makes you read; it never makes you hungry.
2. The most-repeated action in the app has the least craft. Adding food produces a black toast on top
   of an orange bar: 230 px of chrome covering the next dish's + for 4 seconds. Nothing flies, nothing
   bounces, and the 350 ms and 2 s captures are pixel-identical.
3. The cart shows a disabled "كمّل الطلب" and hides why 900 px further down, below an upsell rail that
   doesn't know you're 2,500 short.
4. A student with 4,000 cash can't buy a 2,000 wrap. "أقل طلب 5,000" is a wall with no door.
5. A 15,000-dinar مشكّل for two opens in a sheet that is 60 % blank cream with a 64 px thumbnail. The
   priciest dish on the menu gets the smallest picture.
6. The menu shouts "خصم 20% على كل المنيو" and then shows every price at full. You find out what you'll
   pay only in the cart.
7. Checkout makes you scroll past two empty note boxes to learn how you're paying, then shows **two**
   check marks on the cash row.
8. When the restaurant accepts your dinner, the moment you should feel "يلا!", the screen jump-cuts into
   a notification permission prompt over a grey map.
9. Family ordering is the best idea in the app. Yet a kilo of kebab for the table has to belong to one
   person, the family you already set up isn't offered, and naming a kid costs a keyboard.
10. The reorder sheet tells Umm Ali the total "يطلع بالسلة من السيرفر". She doesn't know what a server is;
    she wants to know whether it's still 15,000.

---

## 3. Findings

Severity: **P1** hurts conversion, trust or joy · **P2** below best-in-class · **P3** polish. Effort:
**S** < 1 day · **M** 1–3 days · **L** > 3 days. Screenshots in `shots/` unless prefixed `x/`, which means
`shots-extra/food/`.

| ID | Sev | Screen | Screenshot | Evidence | Why (principle + benchmark) | Recommendation (build-ready) | Effort |
|---|---|---|---|---|---|---|---|
| F-01 | **P1** | Menu art (C-10 still open) | `food-restaurant-full.png`, `x/quickadd-feedback-350ms.png`, `food-cart.png` | `FoodArt.tsx:14-22`: one regex sends كباب / تكة / كبد / مشوي / لفة / مشكّل to `skewers`; every drink is the same red can (`:139-148`), including شنينة (a yoghurt drink) and water. In the screenshot, 9 of 13 dishes are identical. | Appetite appeal: food is bought with the eyes, and photo-led menus convert better (Uber Eats and Deliveroo require photos). Repeated art is the strongest template tell. | (1) Photo day per launch merchant (C-10), cream backdrop, 1:1 + 16:9 crops. (2) Until then, art v2 (signature S-3): about 24 archetypes (wrap, plate meal, liver cubes, pale chicken, kilo tray with bread, stew bowl, lentil soup, طرشي jar, laban bottle, water bottle, can, istikan) plus deterministic variation from `hash(item.id)`: rotation ±6°, garnish set, plate tint. Rule: adjacent rows never share a drawing. | M (art) / L (photos) |
| F-02 | **P1** | Menu prices under a deal | `deals-restaurant.png`, `x/itemsheet-initial.png` vs `x/cart-full.png` | The badge says "خصم 20% على كل المنيو". The dish card says "2,500 دينار" and the sheet CTA "ضيف للسلة · 2,500 دينار", but the cart says "2,000 دينار ~~2,500~~". `DishCard.tsx:53-55` shows only `fromPrice`. | Anchoring and transparency at the decision point. Talabat and Deliveroo strike through menu prices under % deals. A deal you can't see doesn't change what people pick. | Server-computed: `catalog.menu` returns `dealPriceIqd` per item when a %/item deal applies (no money-rule change; it's the same rule `orders.quote` already applies). DishCard: "2,000 دينار" in `successText` + "2,500" struck through in `textMuted`. Sheet CTA: "ضيف للسلة · 2,000 دينار". When deals don't stack, the restaurant page says "عرض واحد يتطبّق: الأوفر إلك" under the badges (the C-06 remainder). | M |
| F-03 | **P1** | Add-to-cart feedback | `x/quickadd-feedback-350ms.png`, `x/quickadd-feedback-2s.png` | Quick add: haptic + toast "انضاف بيبسي للسلة" (4 s) stacked over the CartBar. Together about 230 px, which covers the next dish's +. No motion: the 350 ms and 2 s frames are identical. Adding from the sheet gives no haptic at all (`restaurant/[id].tsx:70-73`: `onAdded` only toasts). | Feedback should be proportional and in place (Nielsen #1). Wolt and Uber Eats turn + into an inline stepper and animate the basket button; no toast. Peak moments repeat 10× per order. | No toast when the CartBar is visible. Instead: thumbnail flight to the CartBar count bubble (S-1: 420 ms arc), bubble tick (scale 1→1.18→1, spring), total roll (`useCountUp`, 300 ms), `haptic('light')` on tap and `('success')` on landing. DishCard: the + morphs into `[− 1 +]` (180 ms, neutral surface per C-25). Keep toasts for removal + undo only. Announce adds with `accessibilityLiveRegion`. | M |
| F-04 | **P1** | Cart, below the minimum | `x/s360-cart-guest.png`, `x/cart-scroll-end.png` | The CTA "كمّل الطلب" is disabled with no reason in view. "باقي 2,500 دينار حتى توصل لأقل طلب" renders after the upsell rail and the address card (`cart.tsx:187-196`), about 900 px down at 360×740. | Never disable a submit without saying why next to it (form CRO). Goal gradient: show the progress. Uber Eats and Deliveroo pin "Add X to reach the minimum" to the basket button. | A sticky strip directly above the footer: progress bar 3,250 / 5,000 + "باقي 2,500 دينار وتوصل لأقل طلب". The CTA becomes enabled-looking: "ضيف 2,500 دينار وكمّل", and a tap scrolls to the upsell rail (F-15). Same slot for `cart.deal_unlock` ("ضيف 1,750 دينار وتحصل: توصيل مجاني"). | S |
| F-05 | **P1 · needs Ali** | Minimum order vs a small order | `x/cart-scroll-end.png`, `food-restaurant.png` | Min 5,000 with wraps at 2,000–2,500. The keys `restaurant.small_order_note`, `quote.small_order_fee` and `quote.reason.small_order` exist but the funnel only has a hard block. | The single student or worker with cash in hand is a daily customer in a small town. Deliveroo and Uber Eats use a disclosed small-order fee, not a wall. | Ali decides. **A**: allow below the minimum with a fixed fee (e.g. 500), disclosed on the restaurant facts ("طلب أقل من 5,000 دينار عليه رسوم 500 دينار") and as a named price line with its reason. **B**: keep the wall but make the cart close the gap in one tap: "كمّلها بـ شوربة عدس + بيبسي (1,750 دينار)". Either way F-04 ships. | S (UI) after the decision |
| F-06 | **P1** | Kitchen accepts → order screen (C-23 still open) | `x/r2-accepted-order-screen.png` | On accept, `router.replace('/order/[id]')` (`kitchen/[id].tsx:42-44`) lands under a full push pre-prompt over a grey map. The `accepted` sound cue exists (`lib/sound.ts`) but plays only on phase *changes* inside tracking, not on first load. | Peak-end rule: "the kitchen said yes" is the emotional high of the funnel. Talabat and Deliveroo celebrate acceptance; here it's a permission ask. | On the kitchen screen: ring completes and turns `success`, the bag morphs to a pot with 2 steam wisps (Reanimated, 700 ms), `haptic('success')`, `playCue('accepted')`, then the headline "مطعم خالد قبل طلبك · دا يتحضّر" + "يوصلك تقريباً 7:42 م". Hold 1.2 s, then cross-fade to `/order`. Move the push ask to the waiting screen as an inline card: "نخبرك أول ما المطعم يقبل؟ [إي، خبرني]". | M |
| F-07 | **P1** | Kitchen wait (C-37 and C-28 still open) | `food-waiting.png`, `x/r2-waiting-12s.png` | A countdown ring of the 90 s deadline (`CountdownRing mode="accept"`, which turns danger in the last 5 s). Title "ننتظر مطعم خالد يأكد طلبك" + subtitle "ننتظر المطعم يأكد…" says it twice. The lower 40 % of the screen is empty. No restaurant identity; lines have no person avatars. | Waiting with a visible deadline breeds anxiety (C-37). Domino's Tracker / Deliveroo show progress, not a fuse. Empty waiting is a wasted moment. | Indeterminate "sizzle" loop (steam over the restaurant's FoodArt motif, 2.4 s, off under reduce motion). A mini timeline: "وصل للمطعم ✓ · المطعم يأكّد · يتحضّر". Title "وصل طلبك لمطعم خالد", subtitle "عادةً يأكّد خلال دقيقة". At 45 s: "المطعم بعده ما رد. ننطيه شوية، وإذا ما رد نقترحلك غيره". Show lines grouped by person with avatars and notes ("سارة: لفة تكة · بدون بصل") so Umm Ali sees the kids' notes went through. | S |
| F-08 | P2 | Item sheet layout (C-42 still open) | `x/itemsheet-mix.png`, `x/itemsheet-kilo.png`, `x/s360-conflict-scrolled.png` | `ItemSheet.tsx:103` `snapPoints={[0.9]}` for every dish, so simple dishes leave 40–60 % blank. `:106` uses a 64 px thumb. | Wolt and Uber Eats lead with a big image and size the sheet to its content. Blank space reads as "unfinished". | Content-hugging sheet (min 0.5, max 0.92). A 16:9 hero (FoodArt `hero` variant or the photo) at 200 px, name + price + description under it, swipe-down dismiss. The sticky CTA stays. | M |
| F-09 | P2 | Variants without portions | `x/itemsheet-kilo.png`, `food-item-variant.png` | "نص كيلو 12,000 / كيلو 23,000", "نفر / نفرين": nothing says how many it feeds. | The #1 family question. Wolt shows "serves 2"; Swiggy and Zomato tag "serves 2–3". Prevents over- or under-ordering. | Add a merchant field `serves` (min–max) per variant. Show it under the variant name: "نص كيلو · يشبّع 2–3", "كيلو · يشبّع 4–5". Later, a "للعائلة" filter on the home chips. | M |
| F-10 | P2 | Required choice, disabled CTA | `x/itemsheet-initial.png` | The CTA is disabled with "باقي تختار: الخبز" above it (good), but tapping it does nothing. | Error recovery in place. Wolt scrolls to and highlights the missing group. | Keep the CTA visually enabled; label "اختار الخبز". On tap: scroll to the group, pulse its border (`warning`, 2 × 300 ms), `haptic('warning')`. | S |
| F-11 | P2 | "لمنو؟" people | `x/family-sheet-person.png`, `x/family-sheet-next-defaults.png` | Chips come only from `cartStore.people` (`ItemSheet.tsx:56-62`). Household members (منار، حسين, set up in Account) are absent. A new person costs "ضيف شخص" → name → phone → "ضيفه". | Recognition over recall. The household already exists in the product (wallet approvals). | Seed chips from household members + people used before, most recent first. "ضيف شخص" opens one field (name) with "+ رقمه حتى توصله نقاطه" collapsed underneath. Save on Enter. | M |
| F-12 | P2 | Shared dishes in a per-person cart | `food-cart.png`, `x/itemsheet-mix.png` | "مشكّل خالد … لنفرين" and "كباب بالكيلو" must go to one person, so the cart says "إلي: كباب كيلو" for the whole table. | Iraqi family meals are shared trays plus individual wraps. The model should match the table. | A "للسفرة" chip (shared; points go to the organizer), preselected for dishes with `serves ≥ 2`. In the cart, the "للسفرة" group comes first, with a table icon. | M |
| F-13 | P2 | Points invisible while ordering (C-04 remainder) | `x/itemsheet-initial.png`, `x/checkout-scroll-2.png` | `item.points_eligible`, `cart.organizer_bonus` and `checkout.use_points` are defined but have 0 references. Earn rule: 1 point per 100 دينار, cap 50 (`orders.config.ts:35-37`). | Variable reward and endowment. Talabat Pro and Careem Rewards show "you'll earn X" at the decision point. The loyalty system exists but nobody sees it. | Under the sheet CTA: "تكسب 25 نقطة" (from a server `pointsEstimate` on the quote, never computed on the client). In the cart, "إنت المنظّم: +10% نقاط على كل الطلب" when grouped. At checkout, the toggle "استخدم نقاطي (n نقطة = x دينار)". | M |
| F-14 | P2 | Menu discovery (C-35 still open) | `food-restaurant.png` | No "الأكثر طلباً", no favourite heart, no menu search, no dish tags. `item.spice_level` exists but is unused. | Social proof and scanning. Uber Eats "Most liked", Talabat "Popular"; Swiggy and Zomato filters. | First section "الأكثر طلباً بالعزيزية" (server order counts, top 3, larger cards). Tag chips on dishes: "حار", "جديد", "للعائلة". Heart in the hero bar. A search icon in the sticky bar when there are more than 15 items. | M |
| F-15 | P2 | Upsell rail | `food-cart.png`, `x/s360-cart-guest.png` | `upsell.ts` picks by a static section regex. It doesn't know the minimum-order gap, whether there's already a drink, or whose turn it is. Card names are cut off behind the footer at 390×844. | Contextual cross-sell converts (Deliveroo "Complete your meal"). Irrelevant upsell is noise. | Rank: (1) when below the minimum, items that close the gap with the fewest adds; (2) no drink → drinks; wraps → طرشي / شنينة; (3) never something already there. Title: "يكمّل سفرتك", or when short "كمّل أقل طلب". Bottom padding so cards clear the footer. | S |
| F-16 | P2 | Cart layout | `x/cart-full.png` | The top repeats both deal badges (about 130 px) while the green "طبّقنا الأوفر إلك" card sits at the bottom. Lines have no thumbnails. | Endowment: seeing the food in the basket confirms the choice (Wolt and Uber Eats show thumbs). Don't say the same thing twice. | 48 px FoodArt or photo thumb per line. Drop the top badges once `DealApplied` shows. Keep one compact line under the restaurant name: "عرض المطعم: خصم 20%". | S |
| F-17 | P2 | Checkout payment, double check | `x/checkout-scroll-2.png` | The cash row shows **two** ✓. `checkout.tsx:400` passes a trailing check and `ListRow.tsx:80` already draws one when `selected`. | A glitch at the payment moment reads as "broken" and costs trust. | Remove the trailing icon in `checkout.tsx:400` and `:418`; let `ListRow` own the check. | S |
| F-18 | P2 | Checkout order of sections | `x/checkout-full.png`, `food-checkout.png` | Order: summary → address → recipient → when → **two always-open note areas** → payment → price. Payment and price sit about 1,700 px down; the first fold never says "كاش". | Form CRO: hide optional fields and put decision-critical info next to the CTA. Cash-first users look for "how do I pay" (anxiety point). | New order: summary (with ETA as a time) → التوصيل لـ + للباب/بالشارع → **الدفع** → **السعر** → compact rows "يستلم: أنا · تغيير" and "شوكت: هسة · تغيير" → links "+ ملاحظة للمطبخ" / "+ ملاحظة للدليفري" that expand. Under the CTA, one line: "تدفع 7,250 دينار كاش للدليفري". | S |
| F-19 | P2 | Cash change (C-31 still open) | `x/checkout-scroll-2.png` | The cash subtitle "تدفع كاش للدليفري · الكسور ترجعلك رصيد" wraps "رصيد" onto its own line. There are no "I'll pay with" chips. | "The courier had no change" is the top cash complaint in Iraq (teardown). The ledger already turns change into wallet credit. | Chips under cash: "بالضبط", "10,000", "25,000", "50,000". Line: "تدفع بـ 25,000؟ الدليفري يجيب الباقي أو يصير رصيد بمحفظتك". Send the chosen note to the courier's job card. Subtitle copy: "الباقي يصير رصيد". | S (UI) / M (courier side) |
| F-20 | P2 | Amounts without دينار (C-29 still open) | `food-item-sheet.png`, `x/cart-full.png`, `x/checkout-scroll-2.png` | "+250", "+500", "توفّر 150", and the price lines "2,500 / 500 / −500". | Voice §5: amounts say دينار. | "جبن +500 دينار", "توفّر 150 دينار", and "دينار" on each `PriceBreakdown` line (smaller, muted). | S |
| F-21 | P2 | Scheduling and closed kitchens | `x/checkout-schedule.png`; code | `scheduleSlots` gives 6 half-hour slots from +45 min, with no day and no opening hours (`checkout.ts:205`). On a closed kitchen, DishCard hides + (`DishCard.tsx:63`) and the sheet CTA is disabled, so you **can't pre-order**, even though checkout supports scheduling when closed. | Inventory reachable but not orderable is a dead end (C-02 follow-through). Breakfast (كاهي وقيمر، باچة) is a pre-order culture. | Closed kitchen: + stays, with a banner "مسكّر هسة · اطلب هسة ويوصلك بعد ما يفتح 7:00 الصبح". Checkout preselects the first slot after opening. Slots get day chips "اليوم / باچر" and respect hours. Ramadan: "على الفطور · 5:42 م" (S-6). | M |
| F-22 | P2 | Ordering for someone else | `x/checkout-recipient-other.png` | "شخص ثاني" → name + phone. Nothing says who pays, and there's no tracking link for the recipient. | Elderly-father persona: the courier asks the wrong person for cash. Uber Eats gifting and "send to someone" share tracking. | When the recipient isn't me: a row "منو يدفع؟ [هو كاش] [أنا من محفظتي]". After placing: "دز لـ أبو علي رابط التتبع على واتساب" (reuse `app/share/[token]`). Hint: "الدليفري يتصل بـ أبو علي لمن يوصل، وما يطلب منه فلوس" when wallet-paid. | M |
| F-23 | P2 | Rejection suggestions | `food-rejected.png`, `food-carried.png` | No reason shown, though the server has one ("المطبخ مزدحم"). The cards don't say whether your dishes exist there or what it will cost; you learn after "انقل سلتي لهنا". | Informed recovery. Better than Talabat already (C keep-list); finish it. | Title "مطعم خالد زحمة هسة وما گدر يستلم طلبك". On each card: "كل أصنافك موجودة · تقريباً 14,750 دينار" or "2 من 3 أصنافك" (precompute `carryOver` + quote per suggestion). Secondary ghost button: "خليه لمطعم خالد وخبرني لمن يخف". | M |
| F-24 | P2 | Reorder sheet copy and total | `x/r2-reorder-result.png` | `reorder.total_note`: "المجموع النهائي يطلع بالسلة من السيرفر". There's no total and no replacement for the missing حمص. | Jargon ("السيرفر") and missing price create anxiety at the commit point. | Quote inside the sheet: "المجموع اليوم 15,250 دينار (كان 15,000)". For a missing dish, suggest a same-category swap: "حمص خلص اليوم · بداله متبّل 2,000 دينار؟ [ضيفه]". Copy: "نحسب المجموع النهائي بالسلة بأسعار اليوم". | S/M |
| F-25 | P2 | Reorder speed | `x/r2-orders-list.png`, `x/r2-reorder-result.png` | Home card → (sheet) → cart → checkout → place = 3–4 taps. | Swiggy "Repeat" and Uber Eats "Order again" bring repeat ordering close to one decision. Repeat orders are the business. | Express sheet "اطلب نفس الطلب": items with person avatars, the address (last used), payment (last used), the server total, and "اطلبه · 15,250 دينار" placing directly. Secondary: "عدّل بالسلة". With no changes it's 2 taps. | M |
| F-26 | P3 | Toast over open sheets | `x/family-sheet-next-defaults.png` | The previous add's toast sits over the next sheet's note field and its "باقي تختار" line. | Overlap hides controls. | Suppress toasts while a sheet is open, or raise `bottomOffset` above the sheet footer. With F-03 most add toasts go away anyway. | S |
| F-27 | P3 | Note field copy | `x/itemsheet-initial.png` | Label "ملاحظة للمطعم" + placeholder "ملاحظة للمطعم: بدون بصل، زيادة ثوم…". | Redundant copy. | Placeholder "مثلاً: بدون بصل، زيادة طرشي". | S |
| F-28 | P3 | Empty cart (C-28 still open) | `x/cart-empty.png` | "سلتك فارغة" (MSA) and a single "ارجع للرئيسية". | Empty states should sell the next step. | "سلتك فاضية" + body "اختار من مطاعم العزيزية المفتوحة هسة". Primary "شوف المطاعم", plus the last-order reorder card when there is one. | S |
| F-29 | P3 | Browsing a second kitchen with a cart | `x/s360-restaurant-musafir.png`, `x/s360-conflict-other-kitchen.png` | Only a badge "2" on the hero. The first + opens the sheet, and the conflict appears only after "ضيف للسلة". | Prevent surprises before the user invests (error prevention). | A slim banner under the hero: "سلتك من مطعم خالد (2 أصناف) · شوفها". On the first + here, ask right away: "نبدي سلة جديدة من مطعم المسافر؟". | S |
| F-30 | P3 | "كل طلب من مطعم واحد" in the cart header | `food-cart.png` | A shield icon + rule text in the header. | Reads like a security notice and adds noise. | Remove from the header; it belongs in the conflict prompt (F-29). | S |
| F-31 | P3 | Wallet row at 0 balance | `x/checkout-scroll-2.png` | "رصيدك 0 دينار، ناقص 3,000 دينار" + "اشحن" in the middle of checkout. | An exit path at the commit point. | At 0 balance: one quiet line "المحفظة: اشحن مرة وادفع بلمسة" (link). Show the full row only when the balance is above 0. | S |
| F-32 | P3 | ETA as a duration only | `food-checkout.png` | "يوصلك خلال 30–40 دقيقة". | Absolute times are easier to plan around a family dinner. Deliveroo says "Arriving 19:42". | "يوصلك تقريباً 7:40 م (30–40 دقيقة)", using the one city clock. | S |
| F-33 | P3 | Busy and closing soon | code `restaurant/[id].tsx:260-264` | Busy is a footnote; the facts don't show closing time. | Honest, genuine urgency only. | Facts chip "يسكّر 12:00 بالليل"; when under 60 min: "يسكّر بعد 40 دقيقة". Busy: put "+10 دقايق بسبب الزحمة" in the ETA chip itself. | S |

---

## 4. Signature upgrades

### S-1. "لقمة تطير": add-to-cart flight + a living cart bar
**What.** Tapping + lifts the dish art off its card, arcs it into the cart bar, and the bar answers: the count
ticks, the total rolls, and the latest dish's thumbnail slides into a small stack on the bar.
**Why it delights.** The most frequent action in the funnel becomes a tiny reward, repeated 5–20 times per
order. It also replaces the toast clutter (F-03), so it adds joy *and* removes noise.
**Build sketch.** `useFlyToCart()` in `packages/ui/src/motion`: `measureInWindow` on the source thumb and the
target bubble. Render one absolute clone in a root `Portal` overlay (one at a time, queued). Path: a
quadratic bezier whose control point is 120 px above the midpoint, 420 ms, `Easing.out(Easing.cubic)`,
scale 1→0.35, slight rotate 0→−12°. On landing, the bubble does a spring (`damping 12, stiffness 220`,
1→1.18→1), the total runs `useCountUp` over 300 ms, and the bar stacks up to 3 overlapping 28 px thumbs
(person avatars in family mode). Haptics: `light` on tap, `success` on landing. Sound: an optional 60 ms
soft "tok" via the existing `playCue` system (new cue `added`, respects the sound switch). Reduce motion:
no flight, only the tick. The DishCard + morphs into `[− n +]` (180 ms width spring).
**Benchmark.** Wolt basket button, Glovo's flying product, Uber Eats inline steppers.
**Effort.** M. **Risk.** Low-end Android jank: transforms only, no shadow during flight, one overlay node,
and skip the flight when the JS frame rate drops (measure with `useFrameCallback`).

### S-2. "سفرة العائلة": the family order ritual
**What.** Ordering for the family becomes a mode. Choose who you're ordering for once, add dishes, see the
table fill up, and optionally let everyone pick their own from a WhatsApp link.
**Why it delights.** It matches how Iraqi families order: shared trays plus "شنو تريد إنت؟". The organizer
feels like the host, everyone gets their own name on their wrap, and points split fairly (that already
exists).
**Build sketch.** (1) A sticky chip row under the category bar: "تطلب لـ: [للسفرة] [أنا] [منار] [حسين] [+]",
seeded from household members (F-11). The selected chip tags each add, and the sheet preselects it.
(2) The cart shows an avatar progress row "منار ✓ · حسين ✓ · زينب لسه" with the "للسفرة" group first.
(3) Phase 2 (spec): "خلي كل واحد يختار" creates a share link to a web page (reuse `app/share/[token]`)
where each person picks under their name. The organizer's cart pulses "منار ضافت لفة تكة" through the
live.* SSE. Optional per-person limit ("حدها 5,000 دينار") uses existing household limits. Copy:
`cart.organizer_bonus` "إنت المنظّم: تكسب +10% نقاط على كل الطلب".
**Benchmark.** Uber Eats Group Orders, DoorDash group order with spending limits, Wolt group order.
**Effort.** M for (1)+(2), L for (3). **Risk.** Complexity creep; ship the mode and household chips first,
then the link.

### S-3. Food art system v2 ("مطبخ العزيزية") until photos exist, and the photo pipeline after
**What.** A warm, varied, recognisably Iraqi illustrated set, plus a merchant photo flow that replaces the
art dish by dish.
**Why it delights.** The menu looks hand-made for this town instead of templated. The steam and the
garnish make it feel alive and appetising even before photos.
**Build sketch.** About 24 SVG archetypes in `FoodArt` (wrap, plate meal with rice mound, kilo tray on
خبز تنور, liver cubes, pale chicken skewers, قوزي on تمن, مرق bowl, lentil soup, باچة pot, كاهي with قيمر,
طرشي jar in pink, laban bottle, water bottle, can, istikan). `variantFor(item.id)` picks the garnish set,
the rotation (±6°) and the plate tint, and enforces the no-same-adjacent rule in `DishCard` lists. Hero: 2
steam paths animating opacity 0.3↔0.6 and translateY −4 px over 2.4 s (static under reduce motion).
Photo pipeline: Merchant app "صوّر الصنف" with an on-screen frame guide on a cream backdrop; the server
makes 1:1 + 16:9 crops and holds them for ops approval; `photoUrl` is already plumbed.
**Benchmark.** Uber Eats' photo requirement; Deliveroo Editions photo standards.
**Effort.** M (art) + L (pipeline). **Risk.** Art cost and consistency: one illustrator, one palette (token
colours only), never captioned as a photo.

### S-4. "طبخة اليوم": the kitchen's daily dish
**What.** Each kitchen posts today's dish ("قوزي على تمن · اليوم بس"), with an optional real portion
count, shown at the top of its menu and in a home rail "طبخات اليوم بالعزيزية".
**Why it delights.** It gives people a reason to open the app daily, matches the weekday-stew culture (the
Thursday باچة, the Friday family tray), and gives small kitchens a voice.
**Build sketch.** Merchant app form (name, price, portions optional, photo from the phone, window "من 12
لحد ما يخلص"). `catalog.special` on the API. Customer card: big photo/art, "باقي 8 صحون" **only** when
the merchant entered a count, decremented by the server on each order via live.*. No count means no
urgency copy. Copy: "طبخة اليوم من مطعم خالد", "خلصت اليوم، باچر يطبخون غيرها".
**Benchmark.** Zomato and Swiggy "today's special" rails; Too Good To Go's daily drops.
**Effort.** M/L. **Risk.** Fake scarcity: the server owns the counter; no timers, no invented numbers.

### S-5. The yes moment: acceptance as a celebration (F-06 + F-07 together)
**What.** The waiting screen becomes a calm, alive kitchen scene, and the restaurant's "yes" lands as a
small celebration before tracking opens.
**Why it delights.** Peak-end: this is the high point of the funnel. Right now it's a fuse and a permission
dialog.
**Build sketch.** Waiting: the restaurant's FoodArt motif in a 168 px circle with an indeterminate steam
loop, a 3-step mini timeline, person-grouped lines, and the inline push ask. Accepted: the ring sweeps
closed in `success` (500 ms), the bag morphs into a pot (path interpolation, 700 ms), `haptic('success')`,
`playCue('accepted')`, then "مطعم خالد قبل طلبك · دا يتحضّر" and "يوصلك تقريباً 7:42 م" in the
departure-time style (audit d-2). Hold 1.2 s, then cross-fade to `/order`. Under reduce motion: an
instant swap plus haptic.
**Benchmark.** Deliveroo's restaurant-confirmed animation, Domino's Tracker.
**Effort.** S/M. **Risk.** None material; keep it under 1.5 s so it never delays information.

### S-6. Meal-time and Ramadan modes
**What.** Scheduling that speaks the town's clock: "على الفطور · 5:42 م", "غدا الجمعة", "فطور باچر 7:30
الصبح". Plus an iftar-box category during Ramadan.
**Why it delights.** In Ramadan the whole town orders for one minute. Hitting Maghrib on time is the
product.
**Build sketch.** The server publishes `mealtimes` (Maghrib per day for Aziziyah's coordinates) and
per-kitchen slot capacity. Checkout's "شوكت؟" gets a first chip "على الفطور · 5:42 م" in Ramadan and
day chips otherwise (F-21). Kitchens tag "صينية فطور" items. A home banner runs from Asr. Kitchens
cap orders per slot (server); full slots show "الفطور مليان بهذا المطعم · جرّب 6:00 م".
**Benchmark.** Talabat and Careem Ramadan iftar scheduling.
**Effort.** M. **Risk.** The capacity spike at Maghrib needs slot caps and courier pre-positioning. Ops
must sign off.

---

## 5. Keep list (don't lose these while polishing)

- **"لمنو؟" chips with "نقاط هذا الصنف تروح لـ سارة"** and per-person notes ("ملاحظة خاصة بـ سارة").
  Nobody in Iraq has this.
- **Per-person cart groups with subtotals** ("إلي 13,750 · لـ سارة 3,000") and swipe-to-remove with
  "رجّعه".
- **The total inside every CTA**: "ضيف للسلة · 3,000 دينار", "كمّل الطلب · 17,750 دينار", "اطلب للساعة
  7:00 م · 7,250 دينار".
- **Deal honesty**: "طبّقنا الأوفر إلك: خصم 20%… العروض ما تنجمع" + struck-through line prices with
  "توفّر" pills in the cart.
- **Price lines with expandable reasons** and "السعر مثبّت، ما يتغير".
- **Required-choice guard** "باقي تختار: الخبز" (just make it tappable, F-10).
- **"بالشارع −250"** segmented control with its hint.
- **Idempotent place** and its copy "اضغط مرة ثانية ونتأكد من طلبك، ما راح ينطلب مرتين".
- **Rejection → "ما انخصم عليك شي" → "انقل سلتي لهنا"**, with people and notes carried over.
- **The reorder sheet's honesty** (what comes back, what doesn't and why, what changed price), the home
  reorder card, and day-grouped order history with item summaries.
- **The hero motif per kitchen type** (the tea glass for المسافر): the seed of S-3.
- **"الإلغاء مجاني قبل ما يقبل المطعم"** under the cancel button.

---

**Screenshot index (new captures, `shots-extra/food/`):** `quickadd-feedback-350ms.png`,
`quickadd-feedback-2s.png`, `restaurant-scrolled.png`, `itemsheet-initial.png`, `itemsheet-kilo.png`,
`itemsheet-mix.png`, `cart-full.png`, `cart-scroll-1.png`, `cart-scroll-end.png`, `cart-empty.png`,
`checkout-full.png`, `checkout-scroll-2.png`, `checkout-schedule.png`, `checkout-recipient-other.png`,
`family-sheet-person.png`, `family-sheet-next-defaults.png`, `r2-waiting-12s.png`,
`r2-accepted-order-screen.png`, `r2-orders-list.png`, `r2-reorder-result.png`,
`r2-home-with-history-full.png`, `s360-restaurant.png`, `s360-itemsheet.png`, `s360-after-add.png`,
`s360-cart-guest.png`, `s360-restaurant-musafir.png`, `s360-conflict-other-kitchen.png`,
`s360-conflict-scrolled.png`, `guest-after-start.png`.
