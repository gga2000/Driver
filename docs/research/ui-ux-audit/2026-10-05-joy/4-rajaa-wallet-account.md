# Slice 4 — الرجعة, طلباتي, المحفظة, حسابي: from "correct" to "loved"

Auditor pass, 2026-10-05, at `0cb0f39`. Audit only: nothing in the repo was changed.

**Evidence**
- Main capture: `scratchpad/audit/shots/` (`rajaa-*`, `acct-*`, `app-orders`, `app-profile`; 390×844 @2x). The `topup-*` group never arrived because the capture run died in `deals`, so I captured top-up myself.
- My captures: `scratchpad/audit/shots-extra/rajaa-account/` (`x-*`). These come from the private copy at :8190 / API :3210, signed in as a new user `0770 404 0004` ("زينب"), then seeded with `/demo/history` and `/demo/account`. They cover:
  - new-user wallet, orders and account
  - top-up (amount, code + QR, pending strip, after confirm)
  - طلباتي with history
  - help and help/[orderId]
  - household, invite and member limit
  - places picker, safety, notifications and name
  - the الرجعة board at 390 and 360
  - wallet, account and request at 360
- Not captured: a second booking pass from scratch at 360, and the scrolled wallet transaction list. The demo API's OTP limit (10 an hour per IP, shared with the other auditors) returned `429 retryAfterSec 2734` before that run. Both are covered from code instead (cited per finding).

**Skills applied**
- `design:design-critique`: first impression → usability → hierarchy → consistency → a11y on every screen.
- `marketing-psychology`: endowed progress, goal gradient, IKEA, reciprocity, peak-end, loss aversion and mental accounting, all used ethically.
- `referral-program`: trigger moments, share mechanism, double-sided incentive.
- `churn-prevention`: proactive retention loops, risk signals, no dark patterns.
- `dataviz`: form first; single-hue magnitude; I ran `validate_palette.js` on the brand ramps.

**Benchmarks**
- Apple Wallet boarding passes and Live Activities.
- Intercity: Trainline, Omio, redBus (seat-gender cues), BlaBlaCar (driver profile and verification).
- Careem Plus / Careem Pay, Revolut / Monzo (spend insights, Trends, year-in-review).
- Memberships: Talabat Pro, Uber One (savings counter), DashPass, Swiggy One.
- Starbucks Rewards (stars → rewards ladder), Duolingo (celebration, streak ethics), Airbnb (Trips tab, profile).
- Uber Family / Teens (parent approvals with trip context, PIN).

Live web search was unavailable: the session's shared search budget was used up. The benchmark behaviour cited is from published product patterns up to mid-2026.

---

## 1. Joy score (0–10, now → 90-day target)

| Area | Now | Target | One line |
|---|---|---|---|
| **الرجعة** | **6.5** | **9.0** | Still the most "ours" thing in the app: the calm line, the seat map, the gender rule, the 10-minute hold and the PIN pass. Two things hold it back. It goes anonymous exactly where trust matters most (request offers, demand claim). And the trip has **no ending**: no "وصلت بالسلامة", no rating, no "رجعتك الجاية". |
| **طلباتي** | **6.0** | **8.5** | Now sectioned by day, with restaurant, items, ticket and "اطلبه مرة ثانية" (C-15/C-44 fixed). But it is food-only: **your الرجعة ticket isn't in "my orders"**. Rows also carry no points, receipt or rating loop. |
| **المحفظة** | **5.0** | **8.5** | The balance is clear and the top-up code + QR flow works. But points are a **currency you can see and can't spend**: no redeem anywhere in the app, no earn rules, no expiry warning and no tiers. There are no insights and no savings story. Top-up vocabulary still disagrees with itself. |
| **حسابي** | **5.0** | **8.0** | A tidy settings list with Help now added (C-13 fixed). It has no identity, status, rewards or invite. Safety is one contact field. Family is a form, not a place. Deep links still dead-end. |

Weighted slice score: **5.6 → 8.5**.

---

## 2. The roast

1. You built an airline-grade boarding pass for a 10,000-dinar seat, then **the trip ends in silence**. When the car reaches Aziziyah the pass just flips its pill to "وصلت". There is no "وصلت بالسلامة", no message to Mum, no "شلون كان علي؟" and no "احجز رجعتك الخميس".
2. You fixed "السايق #7K2Q" on the board, then shipped "**السايق #P22 · 45,000 دينار**" on the request board. That is where a woman picks a **private car to Najaf**, and the cheapest anonymous code has the orange button (`rajaa-request.png`).
3. "**باقي مقعد واحد**" on the board, and for a woman that one seat is the middle seat between two men. She finds out three taps later (`rajaa-seat-blocked.png`). The explanation is lovely; the dead end is not.
4. The wallet shows **"2,500 نقطة = 25,000 دينار"** in 30-pt type, and there is **no way to spend a single point** anywhere in the app. Nothing in `apps/customer` sends `pointsRedeemed`. That is a balance you can look at and not use.
5. The spec has Silver/Gold tiers, weekly streaks, referral at 200 points per side, the organiser bonus and 12-month expiry. The copy keys exist (`points.tier_gold`, `points.gold_perks`, `points.referral`, `points.expiring`). **None of them is on a screen.** The loyalty system is written but nobody can see it.
6. Manar asks for 32,000 dinar, and the payer approves blind: "**منار يريد يطلب بـ 32,000 دينار**". It doesn't say from where, for what, or for whom, and it gets her gender wrong (C-28, still open).
7. Top-up says "موظف العمليات بأي مكان تشوفه" and "الدليفري". The wallet, one screen back, says "اشحن من **وكيل** قريب" and "عن طريق **السايق**". That is two names for each of the same two channels (C-36, still open and wider).
8. A brand-new wallet greets you with "**0 دينار**" and "**0 نقطة = 0 دينار**" in display type. In IBM Plex Sans Arabic Bold a lone Latin 0 is wide and round, close to the Arabic-Indic **٥** many Iraqis still read (`x-wallet-new-full.png`).
9. Account is the app's least personal screen: a masked phone, three list cards and a sign-out with no confirm (C-41). There is no tier, no points, no "you saved", no "invite your family". Careem, Uber and Airbnb all put *who you are with us* at the top.
10. At 360 px the Iraqi plate chip, the one safety detail people actually read, is **clipped off the edge of the card** (`x-s360-rajaa-board.png`).

---

## 3. Findings

Severity: **P1** hurts trust or joy · **P2** below best-in-class · **P3** polish. Effort: **S** < 1 day · **M** 1–3 days · **L** > 3 days.
`shots/` = main capture; `x-*` = `shots-extra/rajaa-account/`.

Still-open IDs from the 2026-10-04 audit, re-verified in this slice:
- **C-14** partial: periods are missing on demand windows and the pass has no day.
- **C-19** partial: names are on the board but not on the request board or the demand claim.
- **C-26**: no back button on deep-linked الرجعة, household and profile screens.
- **C-28**: "منار يريد".
- **C-29**: "+2,000" with no دينار.
- **C-36**: top-up vocabulary.
- **C-38**: the toast covers the pass.
- **C-41**: sign-out has no confirm.
- **C-45**: the new-user wallet.
- Fixed since: C-13 (help), C-15/C-44 (orders list), C-16 (draft names now read "مكان تقريبي لحد ما نثبّته").

### الرجعة

| ID | Sev | Screen | Screenshot | Evidence | Why (principle + benchmark) | Recommendation (build-ready, exact copy) | Effort |
|---|---|---|---|---|---|---|---|
| R-01 | **P1** | Request board, offers + matched | `rajaa-request.png`, `rajaa-request-matched.png` | Offers read "السايق #P22 / #P37 / #P12" with a generic person avatar (`request.tsx` → `driverLabel(t, o.driverId)`). Offers are sorted by price, and the cheapest gets the filled primary button. The matched state says "تثبّت السايق #P22 بسعر 45,000 دينار": no name, car, plate, contact or pickup time. It's a dead end. | Choosing a stranger for a private intercity car is a trust decision, not a price decision. BlaBlaCar leads every offer with photo, first name, ★ + count, "ID verified" and "rarely cancels". Uber and Careem show the plate biggest. Pre-highlighting the cheapest is a default nudge on the riskiest variable. C-19 was fixed on the board only. | Reuse `RajaaDriver`/`DriverChip` on each offer: photo, first name, "متحقق اليوم", ★ + trip count, car + plate chip. All offers get the same `secondary` button; no default. Header: "العروض (3) · رتبناها بالسعر". Matched card: "تثبّت ويا حيدر · 45,000 دينار", then "يجيك الساعة 8:00 المسا لـ حي الزهراء", then [راسله] [اتصل] [شارك رحلتك], then the deposit rules (keep them). Server: add the driver card to `RequestPostView.offers`. | M |
| R-02 | **P1** | Demand → claimed | `rajaa-demand-claimed.png` | "المقعد: ورا يسار · **السايق #P2** · صالون · كامري بيضاء · **20417 · بغداد**". `demand.tsx:120` uses `driverLabel` and `vehicleLine` (plate as text). No back button (C-26). This screen is opened from a push. | Same identity gap at the moment a car is *assigned* to you, plus a dead end. Trainline's "your train is here" card is the whole answer in one glance. | Same layout as the board tile: time + garage, then `RajaaDriver` (name, check-in, plate chip), then the seat. Title: "لگيناك سيارة ويا علي". Add `HeaderBack` with a `/rajaa` fallback. | S |
| R-03 | **P1** | Board → seat sheet | `rajaa-board.png`, `rajaa-seat-blocked.png` | The board says "باقي مقعد واحد". For a woman, the only free seat is the back middle between two men, and she learns this after choosing the car, declaring "نساء" and tapping the seat. Traveller type is asked on every booking; nothing remembers it. `useBoard` already accepts `travellingAs`. | Prevent errors rather than explain them (heuristic 5). redBus shows seat-gender cues on the board, so women filter before they tap. A great explanation after a dead end is still a dead end. | Ask once on the board, as a sticky chip under the route: "تسافر: نساء · غيّر". Remember the last choice on the device. Pass it to `useBoard`, so each tile's pill is personal: "باقي مقعد إلك" / "**المقعد الباقي ما يناسبك**" (grey, not tappable, with a one-line reason under it). Pre-select it on the seat sheet. | S |
| R-04 | **P1** | Pass after arrival | code: `pass/[id].tsx`, `rajaa.booking_state_completed` | When the booking completes, the pass shows the same ticket with the pill "وصلت". There is no end card, no rating of the driver, no receipt line, no "safe arrival" message to the emergency contact, and no return-trip prompt. Seat completion *does* post points (`posting.seat` → `pointsForRideTake`), but the rider never sees them. | Peak-end rule: an intercity trip is judged by its ending. Uber sends a trip receipt and asks for a rating plus reasons. Apple Wallet's pass ends gracefully; Trainline offers "book your return". "Arrived safely" is *the* family feature for women travelling to Baghdad. | An end card replaces the ticket's top half when `completed`. Title "وصلت بالسلامة". Body "{route} · وصلت الساعة 7:42 المسا". If sharing is on: "بلّغنا {contact} إنك وصلت". Then "+{n} نقطة" coming in (reuse `PointsEarned`). Rating: "شلون كانت الرجعة ويا علي؟" with ★ and chips "على الوقت" "سياقة هادئة" "سيارة نظيفة" "محترم" / ≤3★: "تأخر" "سياقة سريعة" "ما احترم الدور" + "عندي مشكلة". CTA: "احجز رجعتك" (deep link to the reverse corridor, same weekday + time preset). A push at completion: "وصلت بالسلامة؟ إذا أكو شي، احجي ويانا". | M |
| R-05 | P2 | Board first fold | `rajaa-board.png`, `x-s360-rajaa-board.png`, `x-rajaa-board-full.png` | Above the first car: the calm line, the corridor segment *and* a from/to card (two controls for one decision), then the demand banner. At 360×740 only the time row of the first car shows. A **full** car ("كاملة") keeps the top slot as a 290-pt sunken card. | Hick's law and focus. A departure board's job is "next car I can get", scannable. Trainline and Omio show a compact list of times + availability and expand on tap. | Merge the route into one row: "بغداد ← العزيزية [⇅]", with the corridor as a small chip ("الكوت"). Move the calm line under the first garage heading as a caption. Collapse full cars to a 44-pt row at the bottom of their garage: "6:15 المسا · كاملة · علي". Make tiles denser (time · seats-for-you · price on one row, driver chip under it), so two to three cars fit in the first fold. | M |
| R-06 | P2 | Times and dates | `rajaa-demand.png`, `rajaa-board.png`, `rajaa-pass.png` | Demand chip "4–6", banner "بين 8 و 10", window "بين 5:50 و 6:55" all lack a period. The pass shows "6:15 م" but never the day. (C-14 is fixed on clocks via `formatClock`, but not in `windowLabel`/`hourLabel`.) | Morning vs evening is a missed car. A pass without a date is ambiguous for a booking made the night before. Apple Wallet passes always carry the date. | `windowLabel`: "بين 8 و 10 بالليل" / "4–6 العصر". Pass hero: "اليوم · 6:15 المسا" (or "باچر"), with "بعد 38 دقيقة" under it, ticking per minute. | S |
| R-07 | P2 | "تسافر كـ" heading | `rajaa-demand.png`, `rajaa-request-form.png` | `intercity.travelling_as` = "تسافر كـ" renders as a broken "تسافر ك". | Arabic shaping: a trailing tatweel in a heading reads as a typo. | Rename to "منو مسافر؟" and keep the chips "رجال" / "نساء" / "عائلة". Give each chip its own icon (they all use `user` now): a single person, a woman (headscarf silhouette), and a family (two adults + child). | S |
| R-08 | P2 | Board tile at 360 | `x-s360-rajaa-board.png` | The plate chip "بغداد 12345" overflows the card's left edge; "صالون · كامري بيضاء" wraps to two lines. | The plate is the safety detail. Never clip it (C-20 principle). | In `DepartureTile`, give the driver column `minWidth: 0` and let the chip shrink. Below 380 pt, put the seat map *under* the driver block instead of beside it. Add 360 to the shots script. | S |
| R-09 | P2 | Seat sheet legend | `rajaa-seat-sheet.png` | Six legend states in two rows ("فاضي، قدام، محجوز، راكب من الكراج، ماسكه أحد مؤقتاً، مو متاح إلك"), told apart mostly by fill and dash colour. | Data-viz rule: identity is never colour alone, and show only what is present. Six states is a key you have to study. | Render legend items only for states that appear on this car. Keep seat glyphs (person = taken, shield = not for you, clock = held). Add an accessible label per seat ("ورا نص · مو متاح إلك"). | S |
| R-10 | P2 | Boarding pass | `rajaa-pass-full.png` | Functional but not an object. No date or countdown (R-06). The success toast covers the live-car card (C-38, still open). The share text is masculine ("أني **مسافر**…"), and women share most. There is no wallet or lock-screen presence (d-8 still open). | Apple Wallet: the pass is the thing you open at the gate. A Live Activity carries it to the lock screen. A shared message in your own voice must fit you. | See signature **S-2**. Quick wins: toast at the top safe inset with 3 s auto-dismiss. `rajaa.share_message` → "رحلتي {route} الساعة {time}، السيارة {plate}. تابع الطريق ويّاي: {link}" (gender-free, voice §3). | S (quick) / L (S-2) |
| R-11 | P2 | Amounts without دينار | `rajaa-seat-sheet.png`, `rajaa-board.png` | Meeting points "+2,000"; tile "على الطريق +1,000" (C-29, still open). | Voice §5. | "+2,000 دينار" in `OptionCard.trailing`. Tile: "على الطريق +1,000 دينار". | S |
| R-12 | P3 | Demand posted | `rajaa-demand-posted.png` | A giant "7" in a circle reads like a ticket number or score. There is no back button. | Social proof works when it reads as *people*, not a number (bandwagon, used honestly). | Replace the numeral disc with a row of 7 soft avatar dots (no faces, no names) + "7 ناس ينتظرون وياك على نفس الوقت". Add a progress line once a driver announces: "سايق يحتاج 4 بعد حتى يطلع". Add `HeaderBack`. | S |
| R-13 | P3 | Request form | `rajaa-request-form.png`, `x-s360-rajaa-request.png` | Free-text from/to with no saved places or landmarks. Four fixed hours (8 الصبح / 12 الظهر / 4 العصر / 8 بالليل); past ones are greyed but still look tappable. | Recognition over recall. Spec §2: the request board is the product for Najaf/Karbala visits. | Use saved-place chips for "منين؟" and a destinations list for "لوين؟" (النجف، كربلاء، الكوت، الحلة، بغداد – المطار). Half-hour slots for "باچر". Hide past slots instead of greying them. | M |

### طلباتي and المحفظة

| ID | Sev | Screen | Screenshot | Evidence | Why | Recommendation | Effort |
|---|---|---|---|---|---|---|---|
| W-01 | **P1** | طلباتي (IA) | `app-orders.png`, `x-orders-history-full.png`; code | The tab reads only `orders.history`. الرجعة bookings (`routes.myBookings`) and request posts never appear. "Where is my ticket?" is answered only by the home card or the board's `TripPill`. Help → "مشكلة بطلب" therefore can't reach a seat booking either. | A super-app needs one place for everything you've bought. Careem's Activity mixes rides and food; Airbnb has Trips; Trainline has My Tickets. The pass is the item people reopen most. | Add a pinned section "رحلاتك الجاية" above "شغّال هسة" (live bookings and matched requests): "بغداد ← العزيزية · اليوم 6:15 المسا · ورا نص · الرمز 1102" → opens the pass. Past bookings go into the day sections with a seat icon. A merged client-side list is fine for v1. Help lists bookings too. | M |
| W-02 | **P1** | Wallet points | `acct-wallet-full.png`; code | Points are shown as money ("2,500 نقطة = 25,000 دينار") but **nothing in the customer app can redeem them**. `checkout.tsx` has no points toggle. `pointsRedeemed` exists only in the ledger postings and contracts (`ledger-io.ts`); no client sends it and the orders module never passes it, so redemption isn't wired end to end. The copy says "تنخصم من التوصيل أول"; the contract says "service fee first, delivery second". | Endowment and loss aversion turn into distrust when an owned asset is unusable. Starbucks, Careem and Talabat all make "use my points" a checkout default. | Checkout: a row "استخدم نقاطك · تنزل {amount} دينار" with a Switch. The server computes the applied amount; show it in the CTA total. Wallet points card: add "تنصرف بالطلب الجاي تلقائياً؟" (a remembered preference). **Needs Ali** to confirm the redemption order (fee vs delivery) and to align the copy with the server. | M–L |
| W-03 | **P1** | Household approval | `acct-wallet-full.png`, `x-household-full.png` | "منار يريد يطلب بـ 32,000 دينار، أكثر من حده. توافق؟" It gives only an amount: no restaurant, items, recipient or time. The verb gender is wrong for a known female name (C-28, still open). The payer can't say "this once" vs "raise her limit". | The payer is making a money decision blind. Uber Family/Teen approvals show the trip; Revolut <18 shows the merchant. | "طلب من منار: مطعم خالد · 32,000 دينار", then "4 أصناف · للبيت · هسة" (tap → the cart lines), then "أكثر من الحد بـ 7,000 (الحد 25,000)". Buttons: [وافق هالمرة] [ارفض] + link "غيّر حد منار". No gendered verbs (voice §3). The server adds `merchantName`, `itemsSummary` and `placeLabel` to `PayerApprovalView`. | M |
| W-04 | **P1** | Points: rules, expiry, tiers | `acct-wallet.png`, `x-wallet-new-full.png`; i18n | The card never says how points are earned; `points.earn_rule_food` and `_ride` are unused. Claimed points **expire after 12 months** (domain spec), but no expiry is ever shown for claimed points, only for pending. Tiers (Silver/Gold by 90-day spend, Gold = peak priority + free door pickup) are in the spec and the copy and are never shown. | Hidden expiry breaks trust (people feel cheated). An invisible tier can't motivate (goal gradient needs a visible goal). Starbucks shows the next reward; Careem Plus shows its benefits. | Points card: "تكسب نقطة على كل 100 دينار بالأكل، ونقطة على كل 200 بالمشاوير والرجعة". Expiry line when there is any within 60 days: "1,200 نقطة تنتهي 31/12 · استخدمها بطلبك الجاي". Tier strip: see **S-1**. Server: `wallet.balance` returns `expiringSoon` and `tier` + progress. **Needs Ali** for how tier progress is shown. | M |
| W-05 | P2 | Top-up vocabulary + affordance | `x-topup-amount-full.png`, `x-wallet-new-full.png` | The wallet says "اشحن من وكيل قريب" and "اشحن كاش عن طريق **السايق**". Top-up says "**موظف العمليات** بأي مكان تشوفه" and "**الدليفري** لمن يجيب طلبك الجاي". The rows have icon tiles but aren't tappable (C-36, still open and now wider). | One vocabulary (system audit S-09). Rows that look tappable but do nothing teach users to stop trusting taps. | One term: "وكيل الشحن". Courier channel: "الدليفري أو السايق بطلبك الجاي". Render "وين تشحن؟" as a plain bulleted note (no tiles). The wallet section keeps the same two lines + "قريباً: زين كاش". | S |
| W-06 | P2 | New-user wallet | `x-wallet-new-full.png` | "0 دينار" and "0 نقطة = 0 دينار" in display type (C-45, still open). The bold Latin 0 renders wide and round, close to Arabic-Indic ٥ (crop: `shots-extra/rajaa-account/zoom-zero.png`). The empty transactions state talks about points. | Empty states should sell the next action. A lone glyph that can be misread as 5 is a money-clarity risk where both digit systems are in use. | Balance 0: "ما عندك رصيد بعد" (no numeral) + "اشحن مرة وحدة وادفع بلمسة بالطلب الجاي". Hide the points card until the first points; show instead "أول طلب يجيبلك نقاط · كل 100 نقطة = 1,000 دينار". Transactions empty: "أول طلب أو شحن يطلع هنا". | S |
| W-07 | P2 | Top-up done moment | `x-topup-done.png`, `x-wallet-after-topup-full.png` | The receipt shows only if you stay on the code screen. Reopening `/topup` after confirmation shows the amount picker. The wallet just changes to 25,000 silently (a WhatsApp receipt is sent). | Peak-end: cash handed to a stranger is an anxious moment, and the confirmation is the relief. Careem Pay and Revolut show a "money in" moment. | When the wallet sees a top-up confirmed since the last visit, show a one-time strip: "وصل 25,000 دينار لمحفظتك · الرقم T-4XQ6" with the coin animation (reuse `PointsEarned`) and a success haptic. The transaction line opens the receipt. | S |
| W-08 | P2 | Transactions list | code `wallet.tsx` `LineRow` | Rows aren't tappable (`chevron={false}`, no `onPress`), have no day grouping and no filter. A food line can't open its order, and a top-up can't show its reference. | Every money line must answer "what was this?" in one tap (Monzo and Revolut transaction detail). | Day headers ("اليوم"، "أمس"، "الأحد 2/10"), reusing `sectionByDay`. Tap → order screen / pass / top-up receipt. Filter chips: "الكل · أكل · مشاوير · الرجعة · شحن · نقاط". | M |
| W-09 | P2 | Two balances on one card | `acct-wallet.png` | Under "رصيدك 25,500" sits "محفظة بيت علي: 60,000 دينار", with no explanation of whose money that is or who spends it. | Mental accounting: people need labelled pots. Revolut Pockets and Monzo Pots name their purpose. | "رصيد البيت: 60,000 دينار" + "منه يطلبون منار وحسين · إنت الدافع". Tap → household. | S |
| W-10 | P2 | Orders rows | `x-orders-history-full.png` | Status "وصل" vs "خلص" for two delivered orders (`delivered` vs `closed`), which users can't tell apart. Each row is a separate card with a full outlined reorder button, so 3 orders fill the screen. Rows don't show points earned or "قيّم". | Scannability and the loyalty loop: Starbucks shows stars per purchase, Talabat shows "rate your order". | Map `closed` → "وصل". Group a day's rows in one card; make reorder a compact text button "↻ اطلبه مرة ثانية". Meta: "6:00 المسا · 15,000 دينار · +150 نقطة". Unrated delivered orders get a small "قيّم" chip. | S |
| W-11 | P2 | Referral copy (latent) | `ar-IQ.json` `points.referral` | "ادعُ صديق: **2,000 نقطة** إلك وإله بعد أول طلب". The edge-case decision §1 is **200 points (2,000 IQD) per side after the referee's second cash order ≥ 10,000**, capped at 10 a month. It is also MSA ("ادعُ"). Unused today. | A 10× promise error waiting to ship. | Before referral ships: "دز لأهلك وصحابك: إلك وإلهم 2,000 دينار نقاط بعد ثاني طلب" (200 نقطة). **Needs Ali** (money/points rule). | S |
| W-12 | P3 | Orders empty state | `x-orders-empty.png` | "شوف المطاعم" only. | In a super-app, empty orders should show every door. | "بعد ما طلبت شي" → buttons "اطلب أكل" · "احجز مقعد للرجعة" · "اطلب تكتك". | S |
| W-13 | P3 | Hard-coded colours | `topup.tsx` `'#FFFFFF'`, `wallet.tsx` `'rgba(255,255,255,0.10)'` | Token rule (CLAUDE.md). | | `theme.colors.surface` / `withAlpha(color.neutral[0], 0.1)`. | S |

### حسابي (account, places, household, safety, help)

| ID | Sev | Screen | Screenshot | Evidence | Why | Recommendation | Effort |
|---|---|---|---|---|---|---|---|
| A-01 | **P1** | Safety | `x-safety-full.png`, `app-profile.png` | Safety is a single name + phone form. "Share my trips automatically" is a `Chip` on the account page, not a `Switch`, and not on the safety page; its state is unclear. There is one contact, no "notify on arrival", no night-only option, and no way to share a ride you're *on* from here. | Women travelling Aziziyah⇄Baghdad are a core persona. Uber's Safety Toolkit and Careem both have trusted contacts with auto-share schedules, PIN verification and ride check. Safety must feel like a place, not a field. | A "الأمان" page with three blocks. (1) "ناس نثق بيهم" (up to 3; the household is suggested): name, masked phone, [شيل]. (2) Switches: "شارك رحلات الرجعة والتكسي تلقائياً"; "بالليل بس (9 المسا – 6 الصبح)"; "بلّغهم من أوصل". (3) "شلون نحميك": verified-today drivers, plate on every pass, the PIN, the seat rule, SOS. Account row subtitle: "رقم الطوارئ: أمي · المشاركة شغّالة". | M |
| A-02 | P2 | Deep links dead-end | `rajaa-board.png`, `rajaa-demand*.png`, `rajaa-request*.png`, `x-household-full.png`, `x-household-invite.png`, `x-safety-full.png` | No back button on `rajaa/index`, `demand`, `request`, `household/*`, `profile/*` when opened from a push or link (`_layout.tsx` sets a title but no `HeaderBack`). C-26, still open. | Escape hatch (heuristic 3). The demand claim and approvals arrive *by push*. | `headerLeft: () => <HeaderBack />` on every stack screen; `HeaderBack` falls back to `router.replace('/')` (or `/rajaa` for rajaa children). | S |
| A-03 | P2 | Account IA + identity | `acct-profile-full.png`, `x-account-seeded-full.png` | The header is avatar + masked phone + "عدّل". العائلة and الإشعارات sit under "الأمان". Spec §10's tier badge and payment preferences are absent. Points, savings and invite are missing. | Airbnb, Careem and Uber open the account with *you*: status, savings, invite. A settings list is the template tell from the previous audit. | Header card: name, "ذهبي" pill (when tiers ship), "2,500 نقطة · وفّرت 18,000 دينار هالسنة" (server) → wallet. Then sections "بيتي" (العائلة، الأماكن، ناسك), "الأمان", "التطبيق" (الإشعارات، اللغة), "مساعدة", then a quiet "دز درايفر لأهلك" card (S-6). | M |
| A-04 | P2 | Household: limits + members | `x-household-member.png`, `x-household-invite.png` | The limit is per order only ("حد الطلب الواحد"). The editor is one bare field: no presets, no monthly budget, no "this month she spent", no remove member. The member field shows "25000" without a separator, while the invite placeholder shows "25,000". The hint uses MSA "فارغ = بلا حد". | Families budget by month, not by order. Apple Screen Time and Uber Family give presets and a usage view; IKEA effect: a set-up family *owns* the feature. | Presets: "10,000" "25,000" "50,000" "بلا حد" + "حد الشهر (اختياري)". Show "هالشهر: 46,000 دينار من 100,000" as a bullet bar (S-4). Add "شيل من العائلة" with a confirm. Format with separators. Hint: "إذا تركته فاضي، ماكو حد". Monthly budget is a server change. | M |
| A-05 | P2 | Household invite | `x-household-invite.png` | Phone typed by hand: no contact picker, no WhatsApp invite, and no preview of what the invitee gets. Role chip "فرد" is vague. | Iraqi family coordination happens on WhatsApp. Referral best practice says in-product share beats codes. | [اختار من جهات الاتصال] + "دزله الدعوة على واتساب". Message: "هلا، ضفتك لحساب {household} بدرايفر. تطلب أكل ومشاوير وتدفع من حساب البيت لحد {limit} دينار بالطلب. نزّل التطبيق: {link}". Role labels: "يطلب على حساب البيت" / "يستخدم أماكن البيت بس". | M |
| A-06 | P3 | Places icons + picker | `acct-profile-full.png`, `x-places-full.png` | "الشغل" and the hospital use the **bag** icon, which means food everywhere else in the app. The places picker shows **two** check marks on the selected row (`ListRow selected` + a trailing check). | Icon semantics; a duplicate signifier looks like a bug. | Work → `briefcase` (add to the icon set). Drop the trailing check (keep `selected`). | S |
| A-07 | P3 | Sign-out | `app-profile.png` | No confirm (C-41). | | Sheet: "تطلع من حسابك؟ سلتك تنمسح من هذا الموبايل" [اطلع] [لا، خليني]. | S |
| A-08 | P3 | Help coverage | `x-help-full.png` | Help lists only food orders (W-01). The item summary is cut mid-word ("2× تمن وبامية، حمص..."), and the "عندي مشكلة" label repeats on every row. | | List bookings too. Drop the per-row value text; the section title already says it. Allow 2 lines for items. | S |
| A-09 | P3 | OTP rate-limit copy | debug capture (`429`, `retryAfterSec 2734`) | Re-signing in after sign-out can hit "طلبات كثيرة. انتظر شوية وجرب", though the server knows the wait is 45 minutes. | Honest before polite (voice §2.3): give the time. | "جربت هواي مرات. جرب بعد 45 دقيقة، أو احجي ويانا على واتساب", using `retryAfterSec`. | S |

---

## 4. Signature upgrades

### S-1. "نقاط درايفر": a loyalty system with a soul (non-gambling, family-first) · **needs Ali**
**What**: Turn points from a number into a *relationship*. Everything is earned, known in advance and deterministic. There is **no** chance, spin, scratch card, mystery box, lucky draw or "random double points". Points are always shown in dinar. Four layers:

1. **See it, spend it** (W-02, W-04): earn rules on the card, "+150 نقطة" on every order and pass, a checkout toggle, and honest expiry reminders (60 / 14 / 3 days, never a fake countdown).
2. **أهل الدار tiers** (spec: Silver/Gold by 90-day spend). A single progress bar with a known finish line: "باقي 4 طلبات وتصير ذهبي". Show the threshold in orders or trips rather than dinar, to avoid pushing spend (**needs Ali** for the criterion's display). Gold perks are concrete and local: "توصيل للباب مجاناً بالرجعة" + "أولوية وقت الزحمة" (spec). Tier-up is the one place voice §2.8 allows "مبروك". Use a full-screen card, a soft haptic and a brand-coloured burst. No tier-down shaming; the 90-day window is shown plainly.
3. **نقاط البيت** (family points): points earned by household members show as one family total with each person's share ("منار 600 · حسين 200 · إنت 1,700"). The organiser bonus (+10%, spec) is shown when it lands: "مكافأة المنظّم +45 نقطة". Whether points *pool* or stay personal is a ledger rule: **needs Ali**.
4. **A calendar with respect**:
   - **Ramadan**: no promotional pushes in the 30 minutes before Maghrib. The ETA is framed against the adhan honestly ("يوصل 6:05 · الأذان 6:12"). "سفرة الفطور" family carts. No streak mechanics during the month.
   - **Eid**: **"عيدية درايفر"**, sending wallet credit or points to children and family inside the household, with a card designed like an envelope. This is P2P value transfer: **needs Ali + legal** (CBI e-money rules).
   - **Arbaeen** and visit season: *service, not rewards*. Pre-bookable family cars to Karbala/Najaf on the request board, fixed fares, women-only and family-only cars, mawkib-aware drop-offs. **Never award bonus points for religious travel.** Tying rewards to worship reads as cheapening it.

**Why it delights**: endowed progress (start new users at "أول طلب = نقاطك الأولى"), goal gradient (a visible finish line), reciprocity (gold perks you *feel* on the next الرجعة), and a family identity. Starbucks Rewards' clarity plus Careem Plus's tangible perks, with none of the casino.

**Build sketch**:
- `wallet.balance` returns `{ tier, tierProgress: { have, need, unit }, expiringSoon[], householdPoints[] }`.
- A `PointsCard` in `@driver/ui` with a single-hue progress bar. Use `primary-600 #C27214`, not `#E08A1E`: the validator measured the brand accent at **2.61:1** on white, below the 3:1 floor for marks.
- A `TierUpCelebration` component; reduce-motion → static.

**Benchmarks**: Starbucks Rewards, Careem Plus, Talabat Pro, Duolingo (celebration, *not* streak pressure).
**Effort**: L (server + UI). **Risk**: points are a ledger liability. Every display figure must come from the server, and tier criteria, pooling and عيدية are money rules.

### S-2. The boarding pass as a beautiful object, with an ending (builds on d-2, d-8)
**What**: The pass becomes the most screenshot-worthy screen in Iraq. It works:
- before the trip: a countdown and "boarding opens 5:45"
- at the garage: the PIN in huge split-flap digits (d-2's `DepartureTime`) and "أني بالكراج"
- on the road: the live car, share, SOS
- **after**: R-04's "وصلت بالسلامة", and the ticket stub fades to a sepia "ticket kept" state with seat, driver and time. Tapping "احجز رجعتك" prefills the reverse trip.

**Lock screen (d-8)**: an Android ongoing notification / iOS Live Activity from T−30, with time, seat, PIN and "السيارة 1.0 كم". On iOS, "Add to Apple Wallet" via a `.pkpass` generated server-side (`rajaa.pass.pkpass`), with relevant date and garage location so it surfaces at the garage.

**Why it delights**: peak-end, plus "my seat is mine" made tangible. A pass you can hand your phone to the driver with is a status object.

**Build sketch**:
- Pass layout: a top band in the garage colour, a perforation rule (exists), the PIN section and a stub. The arrival state uses the same card with `state="completed"`.
- `expo-notifications` ongoing notification on Android; a Live Activity needs a native module (dev build).
- `.pkpass` signing on the API (Apple cert).

**Benchmarks**: Apple Wallet boarding passes + Live Activities, Trainline ticket and "book return".
**Effort**: M (in-app, with R-04) / L (Live Activity + pkpass). **Risk**: Live Activities need native builds (Expo SDK 52 dev client). The pkpass cert needs Ali's Apple account.

### S-3. "سفراتي": a الرجعة passport for regulars
**What**: For students and workers who go to Baghdad every Saturday and back every Thursday:
- A "رحلتك الثابتة" card: one tap re-holds the same garage, time band and seat type. A Thursday-noon push: "تحجز رجعتك العادية؟ كراج النهضة 2:00 الظهر · ورا يمين" [احجز] [مو هالأسبوع].
- "سايقك المعتاد": if you rated a driver ★5 twice, his departures get a small "ركبت وياه 3 مرات" tag. This is a familiar face, which matters for women's trust.
- A quiet passport page: "12 رجعة · 1,140 كم · أكثر كراج: النهضة", with an end-of-year "سنتك ويا الرجعة" share card. It is opt-in, stays on the device and shows no other riders.

**Why it delights**: IKEA effect and commitment (the routine is *yours*), and habit loops grounded in a real need, not gamified streaks. It solves the Thursday rush.

**Build sketch**:
- Derive regular patterns client-side from `myBookings` (≥ 3 trips, same weekday ± 1 h).
- A "regular" push via `notify` with the user's opt-in.
- The passport is computed from history; the share card is rendered with `react-native-view-shot`.

**Benchmarks**: Trainline (saved journeys / season patterns), BlaBlaCar ("regular trips"), Spotify Wrapped / Monzo "Year in Monzo" (opt-in recap).
**Effort**: M. **Risk**: none on money. Privacy: never show other riders; the recap stays opt-in.

### S-4. "بيتنا": the family hub (household as a living room)
**What**: The household page becomes the family's home:
- **avatars across the top** with live status ("منار · طلبها بالطريق"، "حسين · بالرجعة لبغداد، 40 دقيقة")
- **this month** per member as bullet bars, where the bar is spend and the tick is the monthly budget (A-04)
- **approvals with full context** (W-03)
- shared places with gate photos
- "منو يوصل البيت هسة" and the trusted-contacts link (A-01)

For a parent whose daughter took الرجعة: "زينب صعدت · السيارة طالعة 6:15 · توصل تقريباً 7:40". On arrival: "زينب وصلت بالسلامة".

**Why it delights**: the per-person cart (already world class) grows into the app's family identity. It also builds switching costs ethically: the family set this up together.

**Build sketch**:
- `household.overview`: members + `liveActivity` (opt-in per member, kid accounts default on) + `monthSpend` + `monthBudget`.
- Bullet bars use a single hue (`#C27214`) with the tick in `text`; labels in text tokens, not series colour (dataviz non-negotiable). The member list doubles as the table view.

**Benchmarks**: Uber Family / Teen accounts (trip visibility, approvals), Life360 (gentle family presence), Apple Family Sharing / Screen Time (presets, Ask to Buy).
**Effort**: L. **Risk**: privacy between adults: live status only for members who opted in, and adults can hide it. Monthly budget is a server rule.

### S-5. "شهرك ويا درايفر": spend insights + a savings counter · totals from the server
**What**: The first card under the wallet hero: "صرفت هالشهر 86,500 دينار".
- Three single-hue bars, *direct-labelled*: "أكل 52,000 · مشاوير 18,500 · الرجعة 16,000".
- "**وفّرت 9,750 دينار**": points used + delay credits ("تأخرنا وهذا غلطنا") + "الباقي رصيد" + deals, each a tappable line.
- Then "1,200 نقطة تنتهي 31/12".

The tone is calm and never judgemental (no "you overspent"). A 6-month sparkline sits behind a tap.

**Why it delights**: mental accounting made friendly. The savings counter is the most effective membership-value device (Uber One, Swiggy One, Talabat Pro show "you saved X"), and here it's honest *free* value.

**Build sketch**:
- `wallet.insights({ month })` sums ledger lines server-side (no client maths on money).
- Form per dataviz: magnitude across three categories → **one hue, horizontal bars, labels in text tokens**, no pie, no dual axis.
- If categories must be colour-coded later, use the validated set **`#C27214` (أكل) · `#245C96` (مشاوير) · `#9A5200` (الرجعة)**: all checks pass, CVD ΔE ≥ 19. Keep direct labels anyway.
- The transactions list is the table view.

**Benchmarks**: Monzo Trends, Revolut Analytics, Uber One savings tracker.
**Effort**: M. **Risk**: no rule change; the figures are aggregation only.

### S-6. "دز لأهلك": WhatsApp-native referral at the peak moments · **needs Ali**
**What**:
- **Triggers**: after a ★5 "وصل طلبك", after "وصلت بالسلامة", after a top-up confirmation and from the account card. Never during a problem flow and never on the public share (safety) page.
- **Mechanism**: one tap opens WhatsApp with a prefilled message in the user's voice: "جربت درايفر؟ أكل العزيزية ومقعد للرجعة محجوز باسمك. سجّل برقمي وكل واحد بينا ياخذ 2,000 دينار نقاط بعد ثاني طلب: {link}". The code is the user's first name + 3 digits (said aloud at the garage).
- **Reward**: per edge-case decision §1, 200 points per side after the referee's 2nd completed cash order ≥ 10,000, capped at 10 a month, with a fingerprint check. The referrer sees progress: "منار سجّلت · باقي طلب واحد وتاخذون النقاط".
- **Student channel** (launch playbook): a "دز للكروب" variant for university groups, promoting الرجعة.

**Why it delights**: reciprocity and unity ("one of us"). Double-sided framing makes sharing a gift, not a sales pitch.

**Build sketch**: a `referral` read (code, invited list with stage); a share sheet with WhatsApp first; the referred person's landing is the guest-browse home with a "{name} دزلك هدية" banner.

**Benchmarks**: Careem and Uber invite flows; Talabat referral; the referral-program skill's loop (trigger → share → convert → reward).
**Effort**: M. **Risk**: abuse (handled by spec fingerprints) and the 2,000-*points* copy error (W-11). The money rule needs Ali.

---

## 5. Keep list (don't touch, or touch only to extend)
1. **The calm line**: "احجز مقعدك من هنا وهو محجوز باسمك. السيارة تنتظرك بالكراج: لا ركض ولا عراك على القدام". Brand-defining.
2. **The gender seat rule and its explanation**: "ما نحط أحد بين غريبين من غير جنسه. اختار مقعد ثاني أو احجز الصف كله". Move it earlier (R-03); keep the words.
3. **The 10-minute free hold** with a ring, "امسك المقعد 10 دقايق ببلاش", "مقعدك ماسكينه إلك", and "فك المقعد" as a calm exit.
4. **Cash vs wallet rules stated before commitment**: grace, the late meter in both directions ("السايق إذا تأخر يدفعلك…"), and "لا تنسى البطاقة".
5. **The request-board deposit honesty**: "إذا السايق ما إجه، نرجعلك ضعف العربون · إذا انت ما حضرت، العربون يروح للسايق". It is fair to both sides.
6. **The PIN** "گول الرمز للسايق من تصعد": verbal, works without a scanner, culturally right.
7. **Board driver chip**: first name, "متحقق اليوم" and the Iraqi plate chip (C-19 on the board). Extend it everywhere (R-01, R-02).
8. **Top-up code + QR** ("142 348", spaced and LTR-isolated), daily limit shown, single-use note, and the WhatsApp receipt.
9. **Notification preferences**: "مو أكثر من مرتين بالأسبوع، وماكو شي بعد 11 بالليل" for offers; safety and codes can't be switched off; WhatsApp receipts plus SMS fallback. Best-in-class respect.
10. **طلباتي** sections ("أمس"، "الجمعة 2/10"), restaurant + items + ticket, and "اطلبه مرة ثانية" (C-15/C-44 done right).
11. **Help** with recent orders → reason chips ("وصل متأخر، ناقص صنف، صنف غلط، ما وصلني") + the WhatsApp line with hours + five dialect FAQs.
12. **Places with gate photos** and the "موقعك مؤكد" badge; "بيت أهل منار · من العائلة" shared places.
13. **Pending points to claim** ("40 نقطة تنتظرك… من طلبات صارت باسمك"): a lovely reciprocity mechanic. Make it a moment (S-1).

---

### Top 8 to do next (this slice)
1. R-01 + R-02: names, check-in and plate everywhere a driver appears. (M)
2. R-04: "وصلت بالسلامة" end card + rating + return prompt. (M)
3. W-02: spend points at checkout, wired end to end. (M–L, needs Ali for the order)
4. W-01: الرجعة trips in طلباتي and Help. (M)
5. R-03: personal availability on the board. (S)
6. W-03: approvals with context. (M)
7. A-01: a safety page that is a place. (M)
8. Quick copy and layout sweep: R-06, R-07, R-08, R-10 (share text and toast), R-11, W-05, W-06, A-02, A-07. (S each)
