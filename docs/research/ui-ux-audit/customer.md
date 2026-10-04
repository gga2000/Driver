# Driver customer app: UI/UX audit (2026-10-04)

A principal-designer audit of `apps/customer` (Expo SDK 52, react-native-web export) at commit
`2874b7f`, driven against the in-memory demo API. It covers every flow the app ships today: first
launch, sign-in, home, restaurant, item sheet, cart, checkout, kitchen wait and rejection, live
order (each state), taxi and tuktuk booking and live ride, الرجعة board, seat, hold, boarding pass,
demand and request boards, wallet and top-up, account, places, household and chat. It also covers
loading, error, offline and empty states, and 360×740 / 390×844 / 430×932 viewports. Nothing in
product code was changed.

Benchmarks: Talabat, Toters, Baly, Careem, Uber and Uber Eats, DoorDash, Deliveroo, Swiggy, Grab.
Iraqi context: Aziziyah (Wasit), Iraqi Arabic, RTL, cash first, mid and low-end Android, patchy
networks.

**Screenshots**: `scratchpad/audit/customer/`. They are 390×844 @2x unless the name says otherwise.
`*-full.png` captures the whole scroll. `x-*` files come from the supplementary pass (states, edge
data, viewports). The rest come from `scripts/web-shots.mjs`.

**Methods applied**: design critique (first impression → usability → hierarchy → consistency →
a11y), Nielsen heuristics scored 0–4, the cognitive-load checklist, persona walk-throughs, an
AI-slop / template-tell check, onboarding and sign-up CRO, form CRO on checkout and the place
editor, and page CRO on the restaurant → cart → checkout funnel. It also uses marketing psychology
(trust, defaults, peak-end and loss aversion, applied ethically) and a UX-copy review against
`docs/specs/2026-10-02-voice-and-microcopy.md`.

---

## (a) Scorecard

| Dimension | Score | Why (one line) | Target (90 days) |
|---|---|---|---|
| Journeys and time-to-value | **6/10** | Food reorder and الرجعة are short and well staged. Search is dead, there is no guest browse, no reorder, no "see all", and 3 of 6 home services are stubs. | 8: search, guest browse and one-tap reorder; first order in ≤ 7 taps from home |
| Visual design and hierarchy | **6/10** | Calm, consistent cream system with good spacing rhythm. Food has no appetite appeal (monograms, one repeated illustration), the home's first fold holds no food, and the type scale is too flat for Arabic. | 8: real food imagery, a decisive home hierarchy, a 5-step type scale |
| Brand distinctiveness | **5/10** | Warm and pleasant but reads as a generic "cream + orange + rounded cards" template. Ownable only in الرجعة (seat maps, boarding pass) and the per-person cart. | 8: one signature motif (garage boards, Aziziyah landmarks, the cash hand-off) used everywhere |
| Interaction and motion | **7/10** | Haptics on tabs, add and arrival; Reanimated courier glide; sheet detents; count-up points; bobbing kitchen mark; skeletons. Missing: optimistic add animation into the cart, pull-to-refresh beyond home, a reduce-motion audit of every loop. | 8.5 |
| Information architecture and navigation | **5/10** | The four tabs are right. Home is a stack of unequal entry points: two taxi doors, a dark ride block heavier than food, no restaurant list, no help. Back affordances come in 3 styles, and deep-linked screens dead-end. | 8: one super-app grid, one food feed, a help entry, a single back pattern |
| Trust and conversion | **6.5/10** | Best-in-class honesty in places: locked price, named fees, "تأخرنا وهذا غلطنا" with auto-credit, free-cancel windows, masked numbers. Undercut by a dead promo field, a free-delivery deal shown but not applied, a +200 rounding line, a false "first delivery free" promise, demo content and "(مسودة)" leaks, a missing plate, and no wallet at food checkout. | 8.5 |
| Copy and voice | **7.5/10** | Mostly genuine Iraqi ("دزلي الرمز", "شنو نسميك؟", "ما انخصم عليك شي", "انقرت"). Slips: "طعام", "مغلق", "فارغة", "متى", "ما تمت", "منار يريد", "وصل!" for the rider, "2 دقيقة", amounts without دينار in deltas, times without ص/م. | 9 |
| States (loading, empty, error, offline) | **5.5/10** | Skeletons are good everywhere. Error states exist but repeat per rail. **No offline state anywhere** (home shows stale data silently; the restaurant page skeletons forever). Empty states sell weakly, and one makes a false promise. | 8: a global offline strip, a skeleton timeout → offline card, empty states with a next action |
| Accessibility basics (surface only) | **7/10** | ≥ 44 px targets, roles and labels on most pressables, contrast tested in tokens. 12 px Arabic captions, star rows forced LTR, and the stepper "+" as the only accent element are the visible issues. (Deep pass is a separate agent.) | 8.5 |
| **Nielsen heuristics** | **25/40** | Acceptable: a solid foundation with significant gaps (table below). | 32/40 |

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Live order and ride status are excellent. Offline is invisible, and the menu skeleton spins forever. |
| 2 | Match with the real world | 3 | Iraqi voice, garages, "بالشارع −250". Times lack ص/م; the map is abstract hexes. |
| 3 | User control and freedom | 2 | Free cancel and "فك المقعد" are good. Deep links dead-end, there is no help, and sign-out has no confirm. |
| 4 | Consistency and standards | 2 | 3 back styles; "طعام" vs "أكل"; ticket #4 in chat vs #5427 on the order; wallet at ride and الرجعة checkout but not food. |
| 5 | Error prevention | 3 | Min-order and cash-cap blockers explained before submit. The promo field invites a guaranteed error. |
| 6 | Recognition over recall | 3 | Saved places, people chips, recent ride spots. No recent searches (no search), no reorder. |
| 7 | Flexibility and efficiency | 2 | No search, reorder, favourites toggle or "again" on rides. Quick add exists. |
| 8 | Aesthetic and minimalist | 3 | Clean. Home is over-stacked; 34 zone chips on ride search; repeated illustrations. |
| 9 | Error recovery | 3 | price_changed, deal_changed and rejection → carry cart are best-in-class. Generic "ماكو نت" used as the fallback for server errors. |
| 10 | Help and documentation | 1 | No help or support entry in the app at all (spec §10). Only the in-order "عندي مشكلة". |

**Cognitive-load checklist (home)**: 4 of 8 fail (single focus, ≤ 4 choices per decision point, visual
hierarchy, progressive disclosure). Home's first fold presents 13 tappable choices: picker, bell,
search, mic, active order, 6 services, 2 ride shortcuts and the الرجعة card. **Ride "where to"**:
3 fail (chunking, minimal choices: 9 landmarks + 34 zone chips, progressive disclosure).

**AI-slop / template verdict**: if someone said "a generator made this", you would half believe them
on home, account and wallet. The look is warm cream + orange + uniformly rounded white cards with
the same soft shadow, icon-in-tinted-square list rows, and middle-dot meta strings everywhere
("كباب · تكة · كبد", "البيت · شارع 30", "أكل · مطعم خالد"). You would **not** believe it on
الرجعة, the boarding pass, the per-person cart or the honest-delay banner: those are specific to
Aziziyah and nobody else has them. The fix is to push that specificity outward (see §d).

### Persona red flags

- **Jordan, first-timer in Aziziyah (Casey's phone, Jordan's patience)**: opens the app and must
  give a phone number before seeing a single menu or price. On home, types "كباب" in the search bar
  and nothing happens. Taps "سوق", gets "دنجهّز هذي الصفحة". Taps "شوف الكل", nothing. Reads
  "أول طلب عليك توصيله مجاناً" and is then charged 500 for delivery. Three dead ends before the
  first order.
- **Casey, one-handed on a Samsung A-series, 3G that drops**: the restaurant page shows grey
  skeletons forever with no "ماكو نت" message (`x-restaurant-offline.png`). Home shows stale
  restaurants with no offline hint, so Casey taps and waits. Tracking's first view is covered by
  the push pre-prompt. The 12 px captions (tab labels, fee lines) are hard to read in sunlight.
- **Riley, stress tester**: deal badge says "توصيل مجاني فوق 15,000"; at 21,000 delivery is still
  500 (`deals-cart-full.png`). Promo field: every code returns "ماكو عروض". Chat header says
  "طلب #4" while the order says "طلب #5427". The boarding-pass toast covers "الغي حجزي".
- **Umm Ali, booking الرجعة for her daughter (project persona: Iraqi mother, cautious with
  strangers)**: the board shows "السايق #7K2Q", a code with no name or photo. Departure "7:00" has no
  ص/م. Two meeting points read "(مسودة)" (draft). The boarding pass names the car but not the man
  driving it. The gender seating rule is excellent; the identity of the driver is the gap.

---

## (b) Already world class — keep

1. **Honest delay with auto-credit** (`track-late.png`): "تأخرنا 12 دقيقة وهذا غلطنا. الوقت الجديد
   7:13. إذا تعدّى التأخير 20 دقيقة، نرجعلك أجرة التوصيل رصيد." No Iraqi competitor does this;
   Uber Eats does it only via support. Keep the wording; make it a brand line.
2. **Kitchen rejection → cart carried to a similar open kitchen** (`food-rejected.png`,
   `food-carried.png`): "ما انخصم عليك شي" + two matched kitchens + "انقل سلتي لهنا". Better
   recovery than Talabat (which just cancels).
3. **The per-person cart and "لمنو؟" chips** (`food-item-sheet.png`, `food-cart.png`): grouping by
   person with per-person notes and points is genuinely new for Iraqi family ordering.
4. **الرجعة as a product** (`rajaa-board-full.png`, `rajaa-seat-sheet.png`, `rajaa-pass-full.png`):
   live garage boards with seat maps, "leaves at X or when full", the gender-aware seat rule ("ما
   نحط أحد بين غريبين من غير جنسه"), a 10-minute free hold with a ring, a boarding pass with PIN,
   the live car and late-meter rules. Nothing in Baly, inDrive or Careem comes close. This is the
   brand's strongest asset.
5. **Price honesty**: "السعر مثبّت، ما يتغير", every fee named with an expandable reason, the total
   inside the CTA ("اطلب هسة · 17,750 دينار"), and price_changed / deal_changed reconciliation that
   explains what changed.
6. **Free-cancel framing** at each stage ("الإلغاء مجاني قبل ما يقبل المطعم", ride "الإلغاء مجاني
   هسة", hold "فك المقعد").
7. **Chat with masked numbers** (`chat-courier-thread.png`): quick replies in dialect, a location
   card, read receipts "انقرت", and "[رقم مخفي]" with the reason. WhatsApp-native feel.
8. **Wallet transparency** (`acct-wallet-full.png`): "باقي الكاش +500" (change kept as credit) as a
   readable line, points shown in دينار, pending points to claim, and a household approval card
   inline.
9. **Ride booking fundamentals** (`ride-choose.png`): locked fare per vehicle, "أرخص بـ 1,000" on
   tuktuk, street-vs-door pickup with the saving stated, a search counter while matching, free
   cancel, and a fare receipt on arrival.
10. **Skeletons everywhere** (`x-home-loading.png`, `x-restaurant-loading.png`) and a one-screen
    checkout with the total in the button.

---

## (c) Findings

Severity: **P0** broken or blocks a task · **P1** hurts conversion or trust · **P2** noticeably below
best-in-class · **P3** polish. Effort: **S** < 1 day · **M** 1–3 days · **L** > 3 days.

| ID | Sev | Screen | Screenshot | Evidence | Why (principle + benchmark) | Recommendation | Effort |
|---|---|---|---|---|---|---|---|
| C-01 | **P0** | Home search | `x-home-search-typed.png` | Typing "كباب" does nothing: `query` state in `app/(tabs)/index.tsx` is never read, and there is no search route. The mic shows a "soon" toast. | The #1 affordance on the screen is fake (visibility of system status, trust). Talabat, Toters and Uber Eats open a full-screen search on focus with recents, popular terms and dish + restaurant results. | Build `/search`: focus → full-screen with `search.recent` and `search.popular` (keys already exist) → results grouped "مطاعم" / "أكلات" with Arabic folding (reuse `searchSpots` folding from ride), plus the `search.filter_*` chips. Until it ships, make the bar open a restaurant list instead of accepting input. Remove the mic until voice exists. | M |
| C-02 | **P0** | Home rails | `x-home-see-all-tap.png` | "شوف الكل" is `onPress: () => {}` (`RestaurantRail.tsx`). There is no full restaurant list anywhere, and closed restaurants are in no rail, so they can't be reached to schedule. | A dead CTA plus no catalog = unreachable inventory. Every benchmark has an "all restaurants" list with sort and filters under the rails. | Add `/restaurants` (vertical list, sort الأقرب / الأعلى تقييم, filters مفتوح هسة / توصيل مجاني / أسرع من 30 دقيقة; all keys exist). Wire "شوف الكل" to it with the rail's filter preset. Show closed kitchens at the bottom with "يفتح الساعة…" and "جدول طلبك". | M |
| C-03 | P1 | Home, 3 of 6 services | `x-home-grocery-stub.png` | سوق, خطوط and طرود tiles toast "دنجهّز هذي الصفحة". | Half the service grid is dead. That teaches users the app is unfinished and lowers trust in the live half. Careem and Grab hide what isn't live or pre-register demand. | Keep the tiles but badge them "قريباً" (muted tile, no accent). The tap opens a sheet: what it is, the launch window, and "خبرني لمن ينفتح" (stores interest, pushes on launch). This turns a dead end into demand data. Copy: "خطوط المدارس والدوام: نبلشها قريب. تريد نخبرك أول ما تنفتح؟" | S |
| C-04 | P1 | Food checkout | `food-checkout-full.png`, `acct-wallet-full.png` | Checkout offers cash only. The wallet card says "يندفع منه أول شي بطلباتك إذا اخترت المحفظة", and ride (`ride.pay_wallet`) and الرجعة (`rajaa.pay_wallet`) both accept the wallet. The spec's points toggle (`checkout.use_points`) is absent too. | Broken promise plus inconsistency (heuristic 4). Users who topped up 25,000 can't spend it on food, the main vertical. Baly and Toters both let you pay food from the wallet. | Add wallet as a payment row (disabled with "رصيدك 3,000، ناقص 14,750 · اشحن" when short, same pattern as ride). Add the points toggle "استخدم نقاطي (2,500 نقطة = 25,000 دينار)". Default stays cash. Server-side money rules unchanged; the payload already has `paymentMethod`. | M |
| C-05 | P1 | Checkout promo | `food-checkout-full.png` | "عندك كود خصم؟" always answers "ماكو عروض شغّالة هسة". | A visible promo field sends shoppers off-app to hunt for codes and makes them feel they are overpaying (well-documented checkout CRO loss); here it is also guaranteed to fail. | Hide the field until promotions exist. Later, collapse it behind a quiet link ("عندك كود؟") under the price lines, not above them. | S |
| C-06 | P1 | Deals → cart | `deals-cart-full.png`, `deals-restaurant.png` | The badge says "توصيل مجاني فوق 15,000 دينار"; the cart is 21,000 and delivery is still 500. Only the 20 % deal applied, with no explanation. | Expectation violation at the moment of payment, which is the strongest trust killer (Toters' "hidden fees" reviews). Deliveroo and Talabat say "one offer per order, we applied the best one". | In the cart's deal strip: "طبّقنا أحسن عرض إلك: خصم 20% (وفّرت 4,200). العروض ما تنجمع." On the restaurant page, show deals as "واحد من هذني" when they don't stack. Server already returns which deal applied (`orders.quote`). | S |
| C-07 | P1 | Cart / checkout price lines | `deals-cart-full.png` | The "تقريب 200" line *adds* 200 to the total (17,800 → 18,000). | A positive rounding line reads as a hidden fee at the most sensitive moment. Iraqi customers are used to cash rounding, but in the shop's favour it feels like a charge. (Money rule: **ask Ali**.) | Options for Ali: (1) round down in the customer's favour (cost ≤ 249 per order); (2) keep it but relabel "تقريب للكاش" with a reason ("حتى ما يحتاج خردة") and show it only for cash; (3) round to 250 and push the remainder to wallet credit like change. Recommend (3): it matches "باقي الكاش" in the wallet. | S (copy) / M (rule) |
| C-08 | P1 | Orders empty state | `x-orders-empty.png` | "أول طلب عليك توصيله مجاناً". There is no first-order free-delivery rule in the API (`ledger-rules.ts` has only `newCustomerCash`), and the sentence also reads "first order: the delivery is on **you**". | False promise and ambiguous dialect. | Replace with a true, actionable line: "بعد ما طلبت شي. مطاعم العزيزية تنتظرك" + a primary button "شوف المطاعم". If Ali wants a first-order offer, make it a real server promo and say "توصيل أول طلب علينا". | S |
| C-09 | P1 | Home layout | `app-home.png`, `app-home-full.png` | At 390×844, zero food is above the fold; the first restaurant starts at ~1,300 px. The heaviest element is the near-black "وين رايح؟" block. Taxi appears twice (service tile + bar); tuktuk only in the bar. | The spec says food-led, but the hierarchy says ride-led. Talabat shows category chips + restaurants in the first fold; Careem's super-app shows one service grid then contextual cards. Duplicate doors add choice load (Hick). | Reorder: header → search → active-order pill → **one** service grid (food, tuktuk, taxi, الرجعة, then "قريباً" tiles) → **one** contextual card (الرجعة or ride, whichever is live) → food: cuisine chips ("كباب، شاورما، تمن ومرق، فطور…") + "قريب منك" restaurant list. Make the where-to bar a light card (surface + border) with taxi/tuktuk chips; reserve near-black for the wallet hero. | M |
| C-10 | P1 | Restaurant cards, menu | `app-home-full.png`, `food-restaurant.png`, `food-cart.png` | Home cards show a big Arabic letter on a random tint (خ green, ش blue). The menu uses one kebab illustration for لفة كباب, لفة تكة and لفة كبد alike; upsells repeat the same salad bowl. | Food is bought with the eyes; photo-led menus convert measurably better (Uber Eats and Deliveroo require photos). Repeated art signals "template", and letters carry no appetite. | (1) Ops: a photo day per launch merchant (phone + lightbox, 3 shots per dish, cream backdrop matching `bg`); `photoUrl` is already plumbed. (2) Until then, give the restaurant card a cuisine illustration (`motifForKitchen`) instead of a monogram, and vary dish art by taxonomy (wrap / plate / soup / drink / bread). Never show the same art on adjacent rows. | M (art) / L (photos) |
| C-11 | P1 | Food arrival | `track-arrival.png` | "وصل!" moment shows a grey placeholder door labelled "صورة الباب", even though this customer saved a gate photo (`acct-place-editor-full.png`). There is no cash reminder; the ride arrival has one ("تدفع 2,000 دينار كاش للسايق"). | Peak-end rule: the climax shows a placeholder. And the cash hand-off, the real-world moment, isn't prepared for. | Show the saved gate photo (or hide the card when there is none). Add the cash line: "جهّز 17,750 دينار للدليفري · إذا ما عنده خردة، الباقي يصير رصيد بمحفظتك". Change the title to "وصل طلبك" (no "!", voice §2.8). Rider arrival: "وصلت بالسلامة". | S |
| C-12 | P1 | Rating | `track-rating*.png`, `Arrival.tsx` | Stars only: no "what went wrong?" chips on ≤ 3 stars, no tip (spec §4 "tip after delivery"), no path to "عندي مشكلة" from a bad rating. | A low rating without reasons is lost signal and a lost recovery moment. Uber and DoorDash ask for reasons and offer a fix in-flow. | On ≤ 3 stars: chips "تأخر"، "بارد"، "ناقص شي"، "الدليفري ما كان لطيف"، "غلط بالطلب" + "عندي مشكلة" → dispute panel. On 5 stars: optional tip chips "500 / 1,000 / 2,000 دينار للدليفري" (100 % to the courier, said in the line). | M |
| C-13 | P1 | Account | `acct-profile-full.png` | No help or support entry anywhere (spec §10: self-serve, then chat). | "Unresponsive support" is the #1 complaint across Iraqi apps (teardown §0.10). Every benchmark has Help in Account. | Add "مساعدة" section: "مشكلة بطلب سابق" (picks an order → dispute), "اسألنا على واتساب" (deep link to the ops line), "أسئلة متكررة" (5 short answers: cash, change, cancel, delay credit, الرجعة rules). | M |
| C-14 | P1 | Times everywhere | `app-orders.png`, `rajaa-board-full.png`, `rajaa-demand.png` | "6:35", "7:00", "4–6", "الليلة" with no ص/م and no day. The orders list has no date. | For intercity departures, morning vs evening confusion is a missed car. Voice spec §5 says 12-hour, so the period must be explicit. | Use "7:00 الصبح / 7:00 المسا" (or "ص/م") in every clock label (`formatClock`, `clockLabel`). The orders list says "اليوم 6:35 المسا" / "أمس" / "الأحد 2/10". Demand chips: "4–6 العصر". | S |
| C-15 | P1 | Orders list | `app-orders.png`, `x-orders-20-full.png` | Row title is "أكل · طلب #1284"; no restaurant name, no item summary, no reorder. | Recognition over recall. "اطلب نفس الطلب" (`home.reorder` exists) is the single biggest repeat-order lever (Talabat, Toters, Uber Eats "Order again"). | Row: restaurant name (title) · items "لفة تكة، بيبسي…" · date + total · status pill · a "اطلبه مرة ثانية" button on delivered rows. Add a "اطلب نفس الطلب" card on home for the last delivered order. | M |
| C-16 | P1 | Demo or draft content shipped | `rajaa-seat-sheet.png`, `acct-wallet-full.png`, `app-home-full.png` | Meeting points named "جسر ديالى (مسودة)"; wallet says "قائمة الوكلاء مبدئية لحد ما نفتح الشحن" next to a live top-up button; "عرض أهل المنطقة" comes from `FIXTURE_COMMUNITY_DEAL`; a brand-new account gets "مطاعمك المفضلة" with a starred restaurant (`x-home-new-user.png`). | Internal states leaking to customers ("draft"), fake deals and fake personalisation all erode trust. | Filter draft meeting points out of the customer read (or label "نقطة جديدة" without the word draft). Remove the agent-list caveat or the list. Hide `CommunityDealCard` until promotions have a read. Hide the favourites rail until the person has favourites, and replace it with "قريب منك". | S |
| C-17 | P1 | Offline | `x-home-offline.png`, `x-restaurant-offline.png`, `x-checkout-offline-place.png` | Network off: home keeps stale data with no hint; the restaurant page shows skeletons indefinitely; there is no global offline strip (required by CLAUDE.md). `error.offline_queued` exists but is unused. | Patchy networks are the norm in Wasit. Silent failure makes users tap repeatedly. Uber and Careem show a persistent "No internet" bar. | A global `OfflineBanner` in `@driver/ui` (`NetInfo` / `navigator.onLine` + failed-fetch heuristic) under the header: "ماكو نت. نعرضلك آخر شي شفناه". Skeleton timeout (8 s) → card "النت ضعيف. نحاول نرجع نجيب المنيو" + retry. On checkout, block "اطلب" with the reason and keep the cart. | M |
| C-18 | P1 | Sign-up | `app-welcome.png` → `app-otp.png` | No browsing before giving a phone number (`guard.ts` sends signed-out users to /welcome). No WhatsApp OTP, although `onboarding.otp_via_whatsapp` exists and Toters offers it. | Value before commitment (sign-up CRO). SMS delivery in Iraq is unreliable, and an OTP that never arrives is a hard drop-off. | Guest mode: home, restaurants and menus are public; ask for the phone at "كمّل الطلب" / "احجز". On the OTP screen, after 30 s offer "ما وصلك؟ دزلي على واتساب" next to resend. | M |
| C-19 | P1 | الرجعة driver identity | `rajaa-board-full.png`, `rajaa-pass-full.png` | Driver shown as "السايق #7K2Q" (an ID code); no name or photo on the board or the pass, though spec §2 says "driver photo + plate". | Intercity with strangers: identity is the safety signal (Baly reviews: "no plate numbers"; OBR ships route sharing and insurance). A code reads robotic. | Board tile: first name + photo + "متحقق اليوم" (selfie check-in exists) + plate chip. Pass: the same in a "سايقك" row with the masked-call button. | M |
| C-20 | P1 | Ride driver card | `ride-matched-expanded.png` | "تكتك · باجاج · أحمر · و…": the plate is truncated by `numberOfLines`. | The plate is the most important safety detail at pickup (Uber shows it biggest). | Plate in its own chip, styled like an Iraqi plate (white box, black digits, governorate word), larger than the model. Model and colour on a second line. | S |
| C-21 | P1 | Place editor and setup map | `acct-place-editor-full.png`, `app-setup.png` | The home pin is placed on a schematic of grey zone circles (no streets, no landmarks). Destructive "شيل المكان" is a filled red button directly above "حفظ". "شارك ويا العائلة" is a filled accent button acting as a toggle. | Drop-off accuracy drives delivery time. Abstract bubbles can't be matched to a real house. Destructive actions next to primary ones invite errors. | Show the real map (MapLibre style is already in `@driver/map`) with landmark labels (mosques, garages, schools) and "موقعي الحالي" first. Make delete a text button at the bottom with a confirm ("نشيل «البيت»؟ ما يأثر على طلباتك القديمة"). Make sharing a `Switch` row with its state in words. | M |
| C-22 | P2 | Chat header ticket | `chat-courier-thread.png` vs `chat-order-buttons.png` | Chat says "طلب #4"; the order screen says "طلب #5427". `app/chat/[orderId].tsx` never passes `orderNumber`, so it falls back to the id tail. | The ticket-number mismatch the apps review fixed elsewhere (#7) is back in chat. | Pass `orderTicketNumber(orderId)` (or read it from `orders.track`) into `ChatScreen`. | S |
| C-23 | P2 | Push pre-prompt timing | `x-push-preprompt-over-tracking.png` | The first time the live map opens, a full sheet asks for notifications and covers the courier and ETA. | Value-based pre-permission is right, but this placement hijacks the most anticipated moment. | Ask on the kitchen-waiting screen ("نخبرك أول ما المطعم يقبل؟") or as an inline card in the collapsed tracking sheet, not a modal over the map. | S |
| C-24 | P2 | Typography scale | tokens `type` | caption 12 / footnote 13 / label 14 / body 15: four sizes within 3 px, so hierarchy comes from weight and colour only. Arabic at 12 px (tab labels, fee and min-order lines) is hard on low-DPI screens. | Arabic glyphs have smaller x-height, so Arabic UI typically runs +1–2 px over Latin. Too many near sizes = muddy hierarchy. | Collapse to 13 (caption, min) / 16 (body) / 18 (title) / 22 (heading) / 30 (display) + amount. Body line-height 28. Tab labels 13 @ 600. Add tabular-figure amounts at 17/600 for prices in lists. | M (needs a visual regression pass) |
| C-25 | P2 | Accent overuse | `food-cart.png`, `food-item-sheet.png`, `ride-where.png` | Every stepper "+" is a filled orange circle; selected chips are filled orange; the CTA is orange. A cart with 3 lines shows 4 orange blobs. | When everything is accent, the primary action stops standing out. Talabat and Uber use neutral steppers and keep colour for the CTA. | Stepper: neutral (`surfaceSunken`, dark icon); selected chip: `accentTint` + `accentText` + border; keep filled accent for the one primary CTA per screen. | S |
| C-26 | P2 | Navigation consistency | `app-phone.png`, `food-restaurant.png`, `food-cart.png`, `rajaa-demand.png`, `x-restaurant-error.png` | Three back styles (circled chevron, bare arrow, native header). Deep-linked `rajaa/*`, `household`, and the restaurant error have no back button (no history → no header back; no tabs). | Consistency and an escape hatch (heuristic 3). A push notification deep link becomes a dead end. | One `HeaderBack` (circled arrow, end-aligned) everywhere, falling back to `router.replace('/')` when there is no history. Already done for cart and checkout; extend to every stack screen. | S |
| C-27 | P2 | Service and dish naming | `app-home.png`, `app-orders.png` | Tile "طعام" (MSA) vs "أكل" in orders, the active pill and the voice spec. | Consistency and voice. | "أكل" everywhere. | S |
| C-28 | P2 | Copy slips (voice §4, §7) | various | "مغلق" → "مسدود"; "سلتك فارغة" → "سلتك فاضية"; "متى تريد ترجع؟" → "شوكت تريد ترجع؟"; "ما تمت عملية الدفع" → "الدفع ما مشى"; "منار يريد يطلب" → "طلب من منار بـ 32,000 دينار، أكثر من حدها" (no verb gender guess); "2 دقيقة بالطريق" → "دقيقتين"; "وصل!" → "وصل طلبك"; "ننتظر مطعم خالد يأكد طلبك" + "ننتظر المطعم يأكد" repeats itself → subtitle "عادةً يرد خلال دقيقة". | Voice spec rules 2, 3, 8. | Copy PR on `ar-IQ.json` with the voice checklist. | S |
| C-29 | P2 | Amounts without دينار | `food-item-sheet.png`, `food-checkout-full.png`, `ride-choose.png`, `rajaa-seat-sheet.png` | "+500", "+250", "−250", "+1,000", "+2,000"; checkout price lines show bare numbers (only the total has دينار). Apps review #26 is still open for the customer app. | Voice §5: amounts say دينار. | Chips: "+500 دينار". Price lines: keep the numbers but add "دينار" to the column header or each line (the PriceBreakdown prop). | S |
| C-30 | P2 | New-customer cash cap discovered late | `checkout.tsx` | The 25,000 cap for the first 3 cash orders only appears as a checkout blocker. | Error prevention: tell people before they build a 30,000 cart. | Cart strip when the total passes the cap: "أول 3 طلبات كاش حدها 25,000 دينار. ادفع من المحفظة أو قسّمها". | S |
| C-31 | P2 | Cash change | checkout | No "how will you pay?" step; yet the ledger supports change as credit ("باقي الكاش" in the wallet). | "Driver didn't return change" is a top Baly complaint (teardown). This is a differentiator hiding in the ledger. | Under cash: "الدليفري ما عنده خردة؟ الباقي يصير رصيد بمحفظتك" (always on, stated). Optional chips "راح أدفع بـ 25,000 / 50,000" so the courier brings change. | S |
| C-32 | P2 | Error states | `x-home-error.png`, `x-orders-error.png` | Every rail shows its own "ما گدرنا نجيب المطاعم + جرب مرة ثانية" (2–3 identical error cards). The fallback message for any failure is "ماكو نت، جرب مرة ثانية" even when the server erred. | One problem, one message. Don't blame the network for server errors. | Page-level error card once at the top of the food section. Use `error.server` ("مشكلة من عدنا مو منك…") for 5xx and `error.network` only for fetch failures. | S |
| C-33 | P2 | Ride "where to" | `ride-where-full.png` | 9 landmarks plus 34 zone chips in one scroll; saved-place chips show "البيت" three times with no zone. | Cognitive load (Hick). Recognition: identical labels. | Show recents + saved (with zone subtitle: "البيت · شارع 30") + 5 nearest landmarks. Zones behind "كل المناطق". Disambiguate duplicates with the owner ("بيت أهل منار"). | S |
| C-34 | P2 | Ride map labels | `ride-choose.png`, `ride-searching-expanded.png` | The destination pill uses the **home** icon and overlaps zone labels; the pickup label collides with the street label. | Map legibility; wrong iconography. | Destination: flag icon; pickup: dot. Pill offset with a collision check against zone labels (or hide zone labels within 40 px of pins). | S |
| C-35 | P2 | Restaurant page | `food-restaurant.png` | No favourite toggle, no in-menu search, no "الأكثر طلباً" section, no share. | Talabat and Uber Eats offer all four. Favourites already exist server-side (`r.favourite`) but can't be set. | Heart in the hero bar; a "الأكثر طلباً" first section (from order counts); a search icon in the sticky category bar on menus with > 15 items. | M |
| C-36 | P2 | Topup "وين تدفع؟" | `topup-amount.png` | Two rows look tappable (list rows with icons) but are informational. The wallet lists "وكلاء الشحن" yet the top-up flow says "موظف العمليات بأي مكان تشوفه". | Affordance mismatch and inconsistent story. | Present as a short "تدفع لواحد من هذني" bulleted note, or make them real choices that show the right instructions. One vocabulary: "وكيل الشحن". | S |
| C-37 | P2 | Kitchen wait | `food-waiting.png` | A 90-second countdown ring of the merchant's deadline. | Showing a deadline invites anxiety and invites the "it's going to fail" reading. Talabat shows an indeterminate "the restaurant is confirming". | Keep the motion; make the ring indeterminate (or progress, not countdown). After 60 s add "المطعم ما رد بعد. ننتظر 30 ثانية ثانية وبعدها نقترحلك غيره". | S |
| C-38 | P3 | Boarding pass toast | `rajaa-pass-full.png` | The success toast covers "الغي حجزي". | Overlap. | Toasts above the footer or the safe bottom inset; auto-dismiss 3 s. | S |
| C-39 | P3 | Rating stars | `Arrival.tsx` | `direction: 'ltr'` on the star row. | In Arabic UIs stars usually fill from the reading start (right). | Drop the forced LTR (check with Ali; some Iraqi users read stars LTR, so test). | S |
| C-40 | P3 | Pre-prompt scrim | `PrePrompt.tsx` | Hard-coded `rgba(15, 18, 22, 0.45)` scrim. | Token rule (CLAUDE.md). | `theme.colors.scrim`. | S |
| C-41 | P3 | Sign-out | `acct-profile-full.png` | No confirm. | Low risk but irreversible on the device (cart, places cache). | Confirm sheet "تطلع من حسابك؟ سلتك تنمسح". | S |
| C-42 | P3 | Item sheet | `food-item-sheet.png` | A 64 px thumb in the sheet header; no hero image. | Benchmarks lead the sheet with a large photo. | 16:9 hero when `photoUrl` exists; keep the compact header otherwise. | S |
| C-43 | P3 | Welcome | `app-welcome.png` | Six tilted icons on a tint: pleasant but generic, with no sense of Aziziyah, no proof ("4 مطاعم، 12 سيارة للرجعة اليوم") and no language switch. | First impression and distinctiveness. | See signature idea §d-6 (Aziziyah map welcome). Add "English" as a quiet link top-left. | M |

Harness notes (not product findings, but they block the next reviewer): `demo-api.mjs` crashes on
`POST /demo/account` because `orgs.createHousehold` / `addMember` / `requestPayerApproval` are now
async and not awaited (unhandled `org_not_found`). `/demo/chat?scenario=ride` fails with "trip is
not in a state that allows this" since `orders.place` now builds the ride trip itself. On a loaded
machine `web-shots.mjs`'s `waitUntil: 'networkidle'` never settles on `/order/[id]` (the SSE stream
stays open). The audit used a patched scratchpad copy for all three.

---

## (d) Signature moments

Ideas that would make Driver feel uniquely world class and unmistakably from Aziziyah. Each is
specified enough to build.

### d-1. "الخردة علينا": the cash hand-off as a feature
**What**: make change-as-credit the visible promise of cash ordering.
**Build**: checkout cash row subtitle "تدفع كاش · الباقي يصير رصيد إذا ما عنده خردة". Optional
chips "راح أدفع بـ 20,000 / 25,000 / 50,000" are sent to the courier's job card ("الزبون يدفع بـ
25,000، جيب 7,250 خردة أو سجّلها رصيد"). On the arrival screen, a hand-off card shows "جهّز 17,750
دينار" with the note-and-coins illustration. When the courier records 25,000, the customer gets an
instant in-app strip with a coin that flies into the wallet tab: "+7,250 دينار رصيد (الباقي)",
reusing the `PointsEarned` coin animation. Wallet line: "باقي الكاش" (exists).
**Why it's ours**: it fixes the #1 cash complaint in Iraq and uses ledger plumbing already built.

### d-2. The garage board as the brand's face
**What**: the الرجعة board's visual language (departure-board time, seat map, "يطلع 7:00 أو من
تكمل") becomes Driver's signature motif, the way a split-flap board is a station's.
**Build**: a `DepartureTime` component in `@driver/ui`: tabular 34/700 time + ص/م + "بعد 52 دقيقة"
countdown with a split-flap tick (Reanimated `withTiming` per digit, 180 ms, off under reduce
motion). Use it on home's الرجعة card, the boarding pass, khat cards and the food ETA box
("يوصلك 7:00" uses the same component, so ETAs feel like departures). Seat-map glyph as the app's
loading mark.

### d-3. "شوف الدليفري يطلع من المطعم": a kitchen-to-door live strip
**What**: replace the abstract hex map at the most anticipated moment with a horizontal
three-stop strip, readable even when tiles fail: 🏠 بيتك ← 🛵 حيدر ← 🍢 مطعم خالد.
**Build**: in the collapsed sheet, a 56 px strip with the restaurant's photo/initial on the far
(left) end, the home gate photo on the near (right) end, and the courier avatar sliding between
them by progress (`liveEta` fraction). Stage dots with real timestamps under it. It works on the
SVG base without tiles and in low-data mode. Tap expands the map.

### d-4. Aziziyah landmarks as the address system
**What**: Iraqis give directions by landmarks ("يم جامع الرسول، الشارع اللي ورا الفرن"). Make the
map and every address speak that way.
**Build**: seed 60–100 landmarks per zone (mosques, schools, pharmacies, bakeries, garages) in
`@driver/map` with Arabic labels at zoom ≥ 14. The place editor auto-suggests a note from the
nearest two ("يم جامع الرسول · ورا فرن الأمير"). The courier card says "حيدر يم صيدلية الشفاء،
3 دقايق". The ride "where to" offers landmarks first. Every saved place row shows its nearest
landmark under the zone.

### d-5. The honest-delay credit as a promise people can see
**What**: elevate C-world-class #1 into a published guarantee.
**Build**: under the ETA on checkout: "إذا تأخرنا أكثر من 20 دقيقة، التوصيل علينا". In the late
banner, a small progress bar towards the 20-minute threshold. On crossing it, a celebratory
(not apologetic) toast: "رجعنالك 1,000 دينار رصيد. آسفين على التأخير". The receipt shows the
credit line. One line on the welcome screen.

### d-6. A welcome that is a map of home
**What**: replace the tilted-icon card with a stylised, warm illustration of Aziziyah: the Tigris
curve, the three garages, the old market, a tuktuk on the bridge.
**Build**: an SVG (single file, palette tokens only) with 6 hot spots; each slowly highlights in
sequence (one orchestrated 6 s loop, static under reduce motion) with a caption: "أكل من مطاعم
العزيزية"، "تكتك بـ 2,000"، "مقعد لبغداد من كراج النهضة". The CTA stays "يلا نبدي". Under it,
live proof: "اليوم: 4 مطاعم مفتوحة · 6 سيارات للرجعة". Guest browse (C-18) starts right here.

### d-7. Family ordering as a ritual
**What**: the per-person cart grows into a shared family order.
**Build**: on the cart, "ضيف أهلك" makes a share link (spec phase 2). Each person opens it,
picks under their own avatar chip, and their lines appear live with a soft "منار ضافت لفة تكة"
pulse. The organizer sees a progress row of avatars (ticked when done) and "+10% نقاط إلك" (key
exists). One cash hand-off, points split by person (exists).

### d-8. The boarding pass in the lock screen
**What**: the الرجعة pass as a live activity / persistent notification from T−30.
**Build**: Android ongoing notification and iOS Live Activity: time, garage, seat, PIN in large
digits, car distance "1.0 كم", and a "أني بالكراج" action. It updates via push when the car is
boarding. It ends with "وصلت بالسلامة" and the fare. Spec §4 already calls for live activities.

---

## (e) Top 15: do next (ranked)

| Rank | ID | Do | Effort | Why now |
|---|---|---|---|---|
| 1 | C-01 | Real search (full-screen, recents, dish + restaurant results, Arabic folding) | M | The primary affordance is fake |
| 2 | C-02 | "شوف الكل" → full restaurant list with sort and filters; closed kitchens reachable | M | Inventory is unreachable |
| 3 | C-17 | Global offline strip + skeleton timeout + offline checkout block | M | Wasit networks; CLAUDE.md requires it |
| 4 | C-06 | Explain which deal applied ("العروض ما تنجمع") | S | Payment-moment trust break |
| 5 | C-05 + C-08 + C-16 | Hide the dead promo field; fix the false "first delivery free" line; remove "(مسودة)", fixture deal and fake favourites | S | Cheap trust wins |
| 6 | C-04 | Wallet (and points) at food checkout | M | Breaks a promise on the main vertical |
| 7 | C-11 | Arrival: real gate photo + cash amount + "الباقي رصيد" | S | Peak-end; sets up d-1 |
| 8 | C-14 | ص/م and dates on every time label | S | Intercity safety and clarity |
| 9 | C-19 + C-20 | Driver name, photo and plate chip on الرجعة and rides; plate never truncated | M | Safety and trust, especially for women |
| 10 | C-09 | Home re-hierarchy: one service grid, one contextual card, food in the first fold | M | Food-led spec; Hick |
| 11 | C-15 | Orders list with restaurant, items, date + "اطلبه مرة ثانية"; home reorder card | M | Repeat-order lever |
| 12 | C-18 | Guest browse + WhatsApp OTP fallback | M | Activation |
| 13 | C-13 | Help section (orders → dispute, WhatsApp line, 5 FAQs) | M | #1 Iraqi complaint |
| 14 | C-03 | "قريباً" tiles with "خبرني" demand capture | S | Turns dead ends into data |
| 15 | C-12 | Low-rating reasons → dispute; tip chips on 5 stars | M | Recovery and courier earnings |

Next after these: C-10 food imagery (start the merchant photo day now, it has the longest lead
time), C-24 type scale, C-21 real map in the place editor, C-07 rounding (needs Ali's decision on
the money rule), and copy PR C-27–C-29.

---

## Appendix: journeys and step counts

| Journey | Driver today (taps from home) | Benchmark | Notes |
|---|---|---|---|
| First food order (new user) | Install → welcome 1 → phone 1 → OTP auto → name 2 → place 3–5 → restaurant 1 → quick add 1–2 → cart 1 → checkout 1 → place 1 ≈ **13–16 taps** | Talabat ≈ 10–12 (browses as guest first) | Guest browse (C-18) moves 6 taps after value |
| Reorder | Orders tab 1 → order 1 → (no reorder) → home → restaurant → re-add each item → cart → checkout → place ≈ **8+** | Talabat / Toters "Reorder" = **3** | C-15 |
| Taxi / tuktuk | Bar chip 1 → destination 1–2 → vehicle 1 → request 1 = **4–5** | Uber = 4, Baly = 4 | On par; recents will make it 3 |
| الرجعة seat | Card 1 → departure 1 → traveller type 1 → seat 1 → pickup 0–1 → hold 1 → pay 1 = **6–7** | Bus apps (e.g. redBus) ≈ 7 | On par; the 10-min hold is a great buffer |
| Top-up | Wallet tab 1 → شحن 1 → amount 0–1 → code 1 → hand cash = **3–4** | Baly agent top-up ≈ similar | Good; fix C-36 wording |

Viewport checks: 360×740 (`x-s360-*.png`) and 430×932 (`x-l430-*.png`) are listed in the
screenshot directory; see the addendum below for what changed at each size.
