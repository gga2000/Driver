# Driver customer app: delight and daily-habit strategy

Date: 2026-10-05 · Type: research and ideation only (no product code or repo files touched) · For: Ali
and whoever builds the customer app next.

**Builds on, does not repeat:** `docs/research/2026-10-02-competitor-teardown.md` (Iraqi market gaps),
`docs/research/ui-ux-audit/customer.md` §d "Signature moments" (d-1 change as credit, d-2 garage board
motif, d-3 kitchen-to-door strip, d-4 landmark addresses, d-5 published delay promise, d-6 Aziziyah map
welcome, d-7 family order ritual, d-8 boarding pass on the lock screen), the tracking moments already
shipped (story camera, almost-there card, delivered burst, four soft tones), the maps spec decision
**D5 "calm, with a few special moments"**, and the specced points/tiers/referral/household rules
(`docs/specs/2026-10-02-domain-and-events.md` §10–12, `2026-10-03-edge-case-decisions.md` §1–2).

**Method (skills applied):** `brainstorming` (diverge to ~55 ideas across 8 themes, then converge
with impact/effort scoring and three strategic approaches); `marketing-psychology` (peak-end, goal
gradient, endowed progress, reciprocity, IKEA effect, Fogg B=MAP, loss aversion used only to *protect*
users, never to pressure them); `marketing-ideas` (product-led loops, sticker/brand assets, year
wraps, seasonal campaigns); `referral-program` (trigger moments, share mechanism ranking,
double-sided gift framing); `churn-prevention` (lapse signals, honest win-back, an exit question on
notification opt-out); `onboarding-cro` (aha moment = first hot meal on time, or first seat boarded;
guest browse; goal-gradient on the launch offer). Web research covered ~20 delivery/mobility apps,
~10 habit/delight products, Iraqi seasons and platform surfaces; every claim is linked in §6.

**Money and points:** several ideas below touch money or points rules. They are marked **[Ali]**.
None of them should be built until Ali signs off, and all of them run server-side. The full list,
the proposed local taste panel and the things to check in town are in **Appendix A**.

---

## 0. In one minute

- **Don't chase daily opens with tricks. Make the app the useful thing in town.** Aziziyah is a town
  of tens of thousands, not a metro. Nobody should order food every day. The daily reason to open
  Driver has to be **useful information and shortcuts**: what's cooking today, when the next car
  leaves for Baghdad, where my child's خط is, my usual order in one tap. Food then follows 1–3 times a
  week, and الرجعة weekly for students and workers.
- **Three strategic approaches, compared:**
  (A) *Rewards-led*: points, challenges, tiers. Easy to copy, gets expensive, and drifts towards
  compulsion.
  (B) *Utility-led town dashboard*: the app knows the town today. Cheap to run, and it compounds.
  (C) *Generosity-led*: treat, gift, pay for family, give sadaqa. Culturally native, and it brings in
  new users without ads.
  **Recommendation: B + C first, with A kept quiet and certain underneath them.** Nobody in Iraq owns
  B or C. Talabat, Toters and Baly all compete on A, with discounts and points.
- **Ten bets, ranked in §4.** The first three: an **«العزيزية اليوم» daily card** (today's pot,
  what's open, the next cars); **«المعتاد»**, one-tap and scheduled usuals (Friday breakfast);
  and **«عشاك يوصل وياك»**, where dinner is timed to the الرجعة arrival and the family gets a
  «وصل بالسلامة» ping. That last one is the moment only a super-app can make.
- **Two dates matter now.**
  - **Ramadan 2027 starts around 8 Feb.** The season engine (bet 7) needs to be live by mid-January.
  - **The next mourning day is around 13 Nov 2026** (3 Jumada II). The new delivered burst and soft
    sounds should be suppressible by then. Today they play on every day of the year.
- **Platform reality.** Iraq is about 86% Android, and the apps are on Expo SDK 52. Widgets, Live
  Activities, Rive and custom haptics mostly need SDK 53–56 or newer, and `expo-av` (used for the new
  sounds) is removed in SDK 55. Plan an SDK upgrade before the platform-surface bets. Quick actions
  and an Android widget can start on SDK 52.

---

## 1. The delight thesis: what "joy" means here

"Joy" for Driver is not confetti. In a small Iraqi town, joy comes down to three feelings:
**«ارتاحيت»** (relief: it just worked, no phone calls, no arguing over change),
**«يعرفوني»** (recognition: it knows my house, my usual order, my garage), and
**«بيّضت وجهي»** (pride: it made me look generous in front of family and friends). Five principles
produce those feelings:

### P1. The app knows Aziziyah, and knows me («يعرف الديرة»)
Local knowledge is the delight competitors can't copy from Baghdad. That means landmarks, not
coordinates (audit d-4). It means today's pot at the popular restaurant, the three garages,
Aziziyah's own maghrib time, the Thursday trip home, and the family's Friday breakfast. Memory makes
the second order faster than the first: saved gate photo, usual order, usual seat, favourite driver.
The super-app multiplies this by **joining the dots across services**. If your seat arrives at 6:40 pm,
dinner can arrive at 6:45 and a tuktuk can wait at the garage. *Principles: IKEA effect and
switching costs earned through value; recognition over recall.*

### P2. Generosity is a feature («الكرم ميزة»)
Iraqi hospitality runs on treating others: «على حسابي», العزيمة, العيدية, نذر, صدقة. Most apps model
one person paying for one person. Driver should make **paying for someone else the most beautiful
path in the app**: send a meal to mum's house, pay a son's seat from Baghdad, give Eidiya, hang a
meal for someone in need. Two rules: the giver is the hero, and the receiver keeps their dignity
(anonymous by default). *Principles: reciprocity, unity, social proof without exposure. This is also
the cheapest acquisition channel there is: every gift lands on a new phone.*

### P3. Every wait is honest, and worth watching («الانتظار مكشوف»)
Waiting is most of the experience: the kitchen, the road, the garage until the car fills. Competitors
fail here (late dispatch, silent cancels). Driver already leads on honesty (the delay credit, the
gliding courier, almost-there). The next step is to make each wait **calm, specific and slightly
charming**, never anxious: no fake countdowns, real seat counts, a reason for every delay. *Principles:
Maister's waiting psychology (occupied, explained, finite waits feel shorter), visibility of system
status.*

### P4. Calm by default, joyful at the peaks, quiet in mourning («هادئ، وبي لحظات»)
Ali already chose this for maps (D5), and it should be the rule for the whole app. Craft **3–4 peaks
per journey** and keep everything else calm: first order, arrival, safe arrival from Baghdad,
generosity sent. Peaks are rare, so they stay special. The calendar changes the volume.
Ramadan gets warmth, Eid gets celebration, Muharram and Ashura switch every celebration off, and
Arbaeen is about service, not marketing. *Principles: peak-end rule; the Headspace and Apple
restraint; cultural respect as a design input, not a campaign.*

### P5. Rewards are certain, never luck, and never punish absence («المكافأة مضمونة، مو حظ»)
Every reward is **deterministic, shown in دينار, and earned by doing normal things**: stamp cards,
points that don't vanish, a subscription that refunds you if it didn't save you money [Ali].
There is no wheel, no scratch card, no mystery box and no random cashback. That is a religious and
cultural line (maysir), and it is also simply better trust design. Rhythms are **weekly, not daily**.
Missing a week costs nothing already earned. *Principles: goal gradient and endowed progress
(certain progress motivates without variable-ratio compulsion); the Apple "pause rings" and Duolingo
streak-freeze lessons; Toters' expiring-points complaint as the counter-example.*

### How to know it's working (delight metrics with guardrails)
North star: **weekly useful opens**, meaning sessions that end in an order, a booking, a share, or a
glance at a card that answered a question (today's pot, next car, child's route). Plain DAU doesn't
count. Report it next to:
- **Good-week rate**: the share of active customers with zero bad moments that week (no late order
  beyond the promise, no unanswered chat, no cancel). Delight starts with nothing going wrong.
- **Generosity share**: the share of orders and seats paid by someone other than the consumer. This
  is P2's metric and a growth input.
- **Guardrails**: push opt-out rate, notification-to-uninstall correlation, cancellations after a
  promo, and complaints mentioning pressure or spam. If a feature lifts opens but moves a guardrail,
  it's a dark pattern. Kill it.

---

## 2. Habit loop map (ethical)

The loop is Fogg's **Behaviour = Motivation × Ability × Prompt** with a fourth step,
**Investment**: something the person puts in that makes the next time better for *them*. This
replaces Hooked's "variable reward" with a **certain reward**. The prompts are useful (they answer a
question the person already had), and every one can be switched off in one tap.

**Personas:** **Umm Ali** (a mother ordering for 6, cautious, cash). **Mustafa** (a student at a
Baghdad university, home on Thursdays). **Haider and friends** (19–28, Snapchat, TikTok, late nights,
football). **Hajji Kadhim** (65, cheap Android, big text, voice notes).

### 2.1 Daily

| When | Who | Trigger (prompt) | Action (smallest) | Reward (certain) | Investment | Guardrail |
|---|---|---|---|---|---|---|
| 7:00–8:00 | Umm Ali | خط push: «علي صعد بالسيارة · يوصل المدرسة 7:40 ص» | Glance or tap the live view | Peace of mind, knowing the time | Child profile, stop photos | Transactional only. Never a marketing line attached |
| 10:30–12:00 | Umm Ali, Hajji | The «العزيزية اليوم» card on home or a widget: «قدر اليوم بمطعم أبو حيدر: باميا» | One tap: «اطلب المعتاد» or «خلّيه للغدا 1:30 م» | Lunch sorted before the rush; price locked | Usuals, scheduled slot, household names | No push by default for قدر اليوم. Opt in per restaurant («خبرني يوم الباميا») |
| 13:00–14:30 | Everyone | Hunger (internal) | Reorder from the home card or a shortcut | Hot food on time; honest tracking; arrival moment | Rating; gate photo | The arrival celebration only on the first order, then calm |
| 16:00–18:00 | Mustafa (in Baghdad) | Widget «سيارات العزيزية من النهضة: 5:30 م · باقي مقعدين» | Hold a seat (10 min, free) | A guaranteed seat; boarding pass | Usual garage, usual seat side | Real counts only. No "hurry" copy |
| 21:00–01:00 (summer) | Haider | Heat plus a night with friends (internal) | Group order or «عزيمة» for the boys | A cold شربت that arrives cold; a story-ready share card | Friend list, group usuals | Quiet hours 23:00–07:00 for anything that isn't transactional |

### 2.2 Weekly

| When | Who | Trigger | Action | Reward | Investment | Guardrail |
|---|---|---|---|---|---|---|
| Thursday afternoon | Mustafa plus family | Thursday trip home (internal ritual) + «مقعدك المعتاد؟» card | One tap books the usual 3:30 seat | Seat sure; mum sees «يوصل 5:10 م» | Usual seat; family watchers | Suggestion only, never an auto-booking or charge |
| Thursday evening | Umm Ali | «ابنك يوصل 5:10 م» (from the family share) | «عشاك يوصل وياه» (dinner timed to his arrival) | Hot dinner as he walks in; one cash hand-off | Household usuals | Food fires only after the car passes a checkpoint, so it's never cold |
| Thursday night | Families | Card «غدا الجمعة: فطوركم 8:30 ص؟» | Schedule Friday breakfast (كاهي وگيمر، باقلاء بالدهن) | Friday morning without anyone going out | A recurring order (user-set) | Shown only to households that ordered Friday breakfast before |
| Friday 12:00–14:00 | Families | Family lunch (internal) | Group or family order («شتريدون غدا؟» poll) | Everyone picks; no arguing | Family members, poll history | Respect the prayer pause: «المطاعم ترجع بعد صلاة الجمعة» |
| Saturday early | Mustafa | Widget: first car to Baghdad | Seat + tuktuk to the garage | Two services, one flow | Saved garage pickup | — |
| Any week | Regulars | A stamp card nears completion («باقي ختمين والجاية علينا») | Normal ordering | A certain free item (merchant-funded) [Ali] | Card progress | Shown in the cart, never pushed. Cards don't expire while active |

### 2.3 Monthly and seasonal (next 12 months)

Hijri dates are approximate (±1 day; Sunni and Shia authorities in Iraq often start Ramadan and Eid a
day apart). The local panel (see §4, bet 7) confirms each one.

| Season (approx.) | Trigger | Action | Reward | Guardrail |
|---|---|---|---|---|
| Month start | خط renewal, points summary | Renew; read the «شهرك» card | Savings in دينار; points into wallet | Reminder 3 days before renewal, cancel in 2 taps |
| School year (started Sun 4 Oct 2026) | خط routes; exam days | Track; schedule exam-day breakfast the night before | Child safe; breakfast on time despite the morning internet cut | Exam mornings have national internet shutdowns (06:00–07:30 in 2025–26): orders placed the night before are already on the server |
| ~13 Nov 2026 (3 Jumada II), ~3–4 Jan 2027 (25 Rajab) | Mourning days | — | — | **First live test of quiet mode:** no burst, no sounds, no promos |
| Ramadan (~8 Feb – ~9 Mar 2027) | Iftar countdown (the local timetable the person follows) | Order «يوصل وقت الأذان»; sponsor a فطور صائم | Iftar on the table at the adhan | No promos in the 20 minutes before iftar; courier iftar break; quiet on 19–21 Ramadan |
| ~15 Ramadan (~22 Feb) | ماجينة | Sweets bags for the children | A childhood custom kept alive | — |
| Eid al-Fitr (~9–10 Mar 2027) | Eid eve and morning | Klecha, Eid breakfast, family rides (visits, cemeteries), Eidiya from afar | Celebration, family together | Fixed-amount Eidiya only; no child wallets |
| Results day (summer) | National results | «حلو النجاح»: sweets to several houses | Pride; neighbours treated | No ranking of students; no names on cards |
| Eid al-Adha (~16 May 2027) | Sacrifice | «وزّع»: meat thirds to family, neighbours and the poor | The obligation done, beautifully | Unbranded bags |
| Ghadir (24 May 2027, an official holiday) | Celebration for most of Wasit | Family orders | Warmth | The panel sets the tone; never mocks others |
| Summer (June–Sept; Kut highs 43–49°C; 2026 blackouts up to 12 h) | Heat; generator gaps | Cold drinks, ice, late-night hours | «بارد يوصل بارد» | No noon "heat deals"; courier heat allowance shown |
| Muharram (~6 Jun 2027) and Ashura (~15 Jun) | Mourning (no trigger from us) | Big نذر orders, D10 multi-door distribution | Service that just works | Quiet mode: no celebrations, sounds, promos or bright themes |
| Arbaeen (~24–25 Jul 2027) | Pilgrimage (≈20M visitors in 2026) | Water and ice to a local موكب; seats home from Karbala and Hilla | Being part of the service | Zero commission [Ali]; no ads; no pilgrim photos |
| Iraq match nights (late kickoffs) | Kickoff | Group order «يوصل بين الشوطين» | Food at half-time | No predictions with prizes; no jokes about losses |
| Year end (late Dec) or account anniversary | «سنتك ويا درايفر» | Watch, then share | Identity and nostalgia | Opt-in, free, kind; never in Muharram |

**Habit maths, honestly:** a realistic healthy pattern is a **daily glance** (card, widget or خط),
**1–3 food orders a week** for a family, and a **weekly seat** for a student. Optimise for this
rhythm. Don't optimise for minutes in the app.

---

## 3. Idea bank (50 ideas)

Columns: **Why it delights** starts with the principle it serves (P1–P5, §1). **Eff** = effort (S under a week, M 1–3 weeks,
L over 3 weeks, for one engineer with design help). **Imp** = impact 1–5 on weekly useful opens and
love. **[Ali]** = touches money or points rules and needs his sign-off. Benchmarks are named here;
their URLs are in §6 under the same name. **†** marks a well-known pattern cited from general
knowledge, with no URL. "Teardown" points to `docs/research/2026-10-02-competitor-teardown.md`.
"Novel" means no benchmark was found.

### A. Personality and copy

| # | Idea | What | Why it delights | Benchmark | Eff | Imp | Risk |
|---|---|---|---|---|---|---|---|
| A1 | «خط درايفر» · Driver lettering | A display face for numerals and headings, drawn from Iraqi hand-painted shop signs and garage boards. Used for departure times, amounts and seasonal headers (extends audit d-2). | P1: looks like *our* streets, not a template | Baemin's own typefaces (Hanna, Jua; Red Dot "Best of the Best") | L | 3 | Cost and legibility; numerals and headings only |
| A2 | «ستيكرات درايفر» · Sticker pack and a small character | A WhatsApp sticker pack in dialect («جاي بالطريق»، «على حسابي»، «وصلت بالسلامة»، «صحة وعافية»), added from inside the app. Its tuktuk character doubles as the empty-state friend. It never nags, guilts or cries. | P2/P1/P4: the brand travels inside every family group, for free | Baemin brand goods; Kakao/LINE characters†; Duolingo's Duo, minus the guilt | S–M | 4 | Can feel childish to older users: keep it small |
| A3 | «دارمي الأكل» · Food-poem contest | Once a year, a contest for a two-line Iraqi folk poem (دارمي) about Aziziyah food. Judged by local poets; the best are printed on bags and shared. Prize: «عشا كل خميس لسنة». The prize is won on skill, not chance. | P1/P2: Iraqi folk poetry meets food; huge shareability | Baemin's food-poem contest (≈250k entries in 2019, prize «365 chickens») | S–M | 4 | Content moderation; the judges must be trusted |
| A4 | «سطر الوقت» · Time-aware lines | ~60 lines for empty, loading and offline states that know the hour, heat and season («الكهرباء طافية؟ المطاعم شغالة على المولدة»). Written by an Iraqi copywriter and rotated without repeats. | P1: the app sounds like it lives here | Baemin UX writing (배민다움); Monzo tone of voice | S | 3 | Humour misfires: panel review; never in money or error states |
| A5 | «سمعناكم» · You said, we fixed | A monthly card: three changes made because of complaints, with how many people raised each. Also a public archive of every promotional push we sent, so fakes can be spotted. | P3: honesty you can see | Monzo tone of voice; the fake Zomato "₹370 biryani" push (2026) | S | 2 | Low |

### B. Celebration moments

| # | Idea | What | Why it delights | Benchmark | Eff | Imp | Risk |
|---|---|---|---|---|---|---|---|
| B1 | «أول مرة» · Firsts kit | First order, first tuktuk, first الرجعة, first gift sent: one crafted animation, haptic and line each, shown **once in a lifetime**. | P4: peaks stay rare, so they stay special | Duolingo lesson-complete screens; Airbnb 2025 animated icons | S–M | 4 | Low |
| B2 | «وصل بالسلامة» · Safe arrival | After an intercity trip: a calm «الحمد لله على السلامة» card, an automatic ping to the family circle (D9), and «تكتك من الكراج للبيت؟». | P1/P4: Iraqi mothers wait for exactly this message | Life360 arrival alerts†; OBR family route-sharing (teardown) | M | 5 | Privacy: the rider controls the watchers (guardians always see minors) |
| B3 | «صرت من زباينّا» · Regular | After N orders from one kitchen, a thank-you written by the owner. A fixed perk if the merchant opts in. The customer chooses whether the kitchen sees their name. | P1: the corner-shop "I know you" feeling | Starbucks name-on-cup intimacy† | M | 4 | Privacy: opt-in on both sides |
| B4 | «سنتك ويا درايفر» · Year story | A Wrapped-style story in late December (or on the account anniversary): top dish, kitchens discovered, km between Aziziyah and Baghdad, meals sent to family. Friendly personas («أبو العزايم»، «مسافر الخميس»، «ملك الفطور»). Kind tone only, no roasting. Share cards carry no prices or addresses. Free, and opt-in. | P1/P2: identity and nostalgia; a sharing spike | Spotify Wrapped (200M users in 24h, ≈500M shares, 2025); Uber YOUBER personas (2025); Monzo's nice/savage choice; Strava's paywall backlash | M–L | 5 | Privacy; avoid the Hijri new year (it opens Muharram) |
| B5 | «حلو النجاح» · Results day | When the ministerial results come out: trays of sweets to several houses (uses D10) and a «مبروك» card. No student names stored. | P2: a national joy moment we serve | Iraqi results-day culture (national results published online each summer) | S | 3 | Low |

### C. Loyalty without gambling

| # | Idea | What | Why it delights | Benchmark | Eff | Imp | Risk |
|---|---|---|---|---|---|---|---|
| C1 | «كارت الختم» · Stamp cards | Per-restaurant, merchant-funded («9 لفات والعاشرة علينا»). Starts with 2 free stamps when the merchant opts in (endowed progress). Never expires while you're active. Shown in the cart, never pushed. | P5: certain progress you can see | Nunes and Drèze (34% vs 19% completion with 2 free stamps); Kivetz et al. (people speed up near the goal); Grab Challenges | M | 5 | Merchant pays; **[Ali]** approves the promo type |
| C2 | «نقاطك ما تموت» · Rolling expiry | Points last 12 months from your *last* order, not from when you earned them. Always shown in دينار. **[Ali]** | P5: no "use it or lose it" anxiety | The fix for Toters' expiring-points complaint (App Store reviews) | S | 3 | Points liability (finance page already tracks it) |
| C3 | «درايفر بلس + ضمان التوفير» · Savings guarantee | The planned ~3,000/month subscription with a live savings meter. If a month saved you less than you paid, the difference comes back as credit. **[Ali]** | P5/P3: the only subscription that can't cost you | Baly Pro at 3,000 IQD (teardown); DashPass and Uber One savings tallies; *the guarantee is novel* | M | 4 | Cost is bounded by the subscription price |
| C4 | «إيقاع الأسبوع» · Weekly rhythm | Replaces the spec's "weekly streaks": an order, a ride or a seat in 3 different weeks of a month earns fixed bonus points. Missing a week resets nothing earned. Ramadan and Muharram are automatic rest periods. Coming back after a gap earns a small «هلا بيك» bonus; we never say "you lost". **[Ali]** | P5: rhythm without shame | Apple pause rings; Duolingo's one-lesson streak and Streak Revival; Milkman's megastudy (a reward for returning after a miss) | S | 3 | Still a nudge; cap it |
| C5 | «ذوّاق العزيزية» · Taste map | A map of every kitchen's signature dish. A stamp for each new kitchen tried, and a fixed perk for completing a neighbourhood. Helps small restaurants get discovered. | P1: exploration, local pride | Google Maps Local Guides†; Strava Local Legends; Untappd badges† | M | 3 | Overeating: discovery framing, no time limits |
| C6 | «النعمة ما تنرمي» · Rescued meals | When an order is cancelled after cooking, customers within 2 km see it for a few minutes at a fixed discount. The kitchen (and a prepaid canceller) recover the money. No food goes in the bin. **[Ali]** | P2/P5: thrift and respect for food (النعمة) | Zomato Food Rescue (Nov 2024) | M | 3 | Food safety: hot items only within 15 minutes |

### D. Social, family and generosity

| # | Idea | What | Why it delights | Benchmark | Eff | Imp | Risk |
|---|---|---|---|---|---|---|---|
| D1 | «عزيمة» · Send a meal | Send a meal to another house: mum's, a new mother, a friend who's ill. The recipient gets a heads-up (they can pick the time or decline). The sender sees only «وصل». A card carries a voice note. | P2: generosity made beautiful | DoorDash gifting (recipient needs no account; SMS heads-up); Uber Eats gift orders† | M | 5 | A surprise at the door: the heads-up message and the option to decline |
| D2 | «العيدية» · Eidiya from afar | For the relative who can't be there (a son in Baghdad, an uncle abroad): fixed amounts to an adult family member's wallet, to pass on or spend for the children. An animated envelope opening and the giver's voice note. Hand-to-hand Eidiya stays the real ritual. **[Ali]** | P2/P4: being part of Eid morning from far away | WeChat red packets *without* the random split; Careem Pay and Toters Cash transfers | M | 3 | Wallet transfer rules; no random amounts, ever; no child wallets |
| D3 | «وجبة معلّقة» + «الباقي صدقة» · Suspended meal, change to charity | Pay for meals that a verified local charity or mosque committee distributes. The donor stays anonymous («صدقة السر»); delivery photos show no faces. Optionally, the cash change (today credited to the wallet) goes to the meal fund instead. The platform waives commission. **[Ali]** | P2: an old tradition, made easy | الخبز المعلّق (Ottoman, now Turkey and Egypt); caffè sospeso†; Careem's Right Click "Eat a Plate to Fill a Plate" | M | 4 | Misuse: partners only, with monthly reports |
| D4 | «شتريدون غدا؟» · Family and friends poll | The organizer picks 2–4 restaurants and shares a WhatsApp link. People vote, and the winner opens the per-person cart (extends audit d-7). For friends, each person's share shows («عليك 6,500 دينار») so nobody chases money afterwards. | P2: no arguing, everyone is heard | WhatsApp polls†; Wolt group order with split payment (2026: collecting money is why group orders get abandoned) | M | 4 | Low |
| D5 | «ادفعها عني» · Pay-for-me link | A student or teenager builds a cart and sends a link. The payer approves in one tap: wallet, or cash at the door. The link expires after 1 hour. | P2: the family pays, the kid orders, nobody's embarrassed | Alipay and Shopee "pay for me" (代付)†; the specced household approvals | M | 4 | Pressure or abuse: the payer sees the full cart; minors only via household |
| D6 | «أسطتي» · Favourite drivers | Favourite a taxi, tuktuk or الرجعة driver. Scheduled rides and seats prefer them. Families can choose a known driver for daughters or grandparents. | P1/P2: trust is personal in a small town | Lyft Favorite Drivers (2024) | M | 5 | Dispatch fairness: priority only for scheduled bookings |
| D7 | «هدية لصديقك» · Gift-framed referral | «عزّم صديقك على أول 3 توصيلات», sent on WhatsApp in the sender's name. The sender's points unlock after the friend's 2nd order (existing rule). Offered only right after a peak moment. | P2: you're treating, not recruiting | referral-program skill (gift framing, trigger moments); Careem and Uber invites† | S | 4 | Low |
| D8 | «ماي بارد للدليفري» · Water for the courier | A summer toggle, «أطلعلك ماي بارد», shown on the courier's job card, plus one-tap compliments («لطيف»، «سريع»، «الأكل وصل حار») that couriers collect. | P2: hospitality both ways; couriers feel seen | Uber compliments†; Iraqi hospitality | S | 3 | Low |
| D9 | «أهلي يتابعون» · Family circle | Up to 3 people automatically get the live trip link for الرجعة and night rides. The rider controls it: they choose at the first booking, can pause it, and always see who's watching. | P1/P2: safety, especially for women and students | Uber Share My Trip / trusted contacts†; OBR route sharing (teardown) | S–M | 5 | Coercive tracking: rider-only control, a visible "who sees me" banner |
| D10 | «وزّع» · One order, many doors | One order, several houses: Eid al-Adha meat in thirds (family, neighbours, the poor), نذر pots in Muharram, results-day sweets, Eid klecha to relatives. Unbranded bags, one cash or wallet payment, a delivery photo per door. | P2: the town's real giving logistics, done for you | Novel as a consumer feature; extends the parcel multi-stop route | M | 4 | Courier time per stop: priced per drop **[Ali]** |

### E. Culture and seasons

| # | Idea | What | Why it delights | Benchmark | Eff | Imp | Risk |
|---|---|---|---|---|---|---|---|
| E1 | «العزيزية اليوم» · Town today | A daily card (home and widget): kitchens open now, قدر اليوم, the next cars from your garage, today's heat, iftar time in Ramadan. | P1: a reason to open every day without spending anything | Weather and transit glanceables†; Meituan's local-life home† | S–M | 5 | Low |
| E2 | «قدر اليوم» · Today's pot | Popular restaurants post today's pot each morning (one tap in the merchant app, from a weekly rotation template). Customers can follow a dish («خبرني يوم الباچة»). Each pot has a WhatsApp-shareable link with a rich preview, which opens a light web menu for people without the app. | P1: Iraqi lunch culture, made visible, and shared where people talk | Café plat-du-jour boards†; Wolt daily lunch menus†; Talabat and Wolt share links† | S–M | 5 | Merchants have to adopt it: make it one tap |
| E3 | «يوصلك وقت الأذان» · Ramadan mode | An iftar slot keyed to the local maghrib time (the person picks the mosque timetable they follow; Sunni and Shia start days and maghrib times can differ), with pre-orders batched for kitchens. Late suhoor hours. A calm iftar countdown on home and the lock screen. No promos in the last 20 minutes. A 20–30 minute **courier iftar break**, stated honestly («الدليفري يفطر، يرجع 6:10 م»). | P1/P4: iftar on the table at the adhan; couriers respected | Careem's daily 30-minute iftar pause for couriers (2023); Talabat Ramadan | M | 5 | Kitchen overload at one moment: slot caps |
| E4 | «فطور صائم» · Sponsor an iftar | Sponsor iftar meals for families listed by verified local charities. The donor stays anonymous and gets a receipt. Points can be donated too. **[Ali]** (commission waiver) | P2: Ramadan's generosity, local | talabat "Share an Iftar" (Ramadan 2026, licensed charities); Careem Right Click (Ramadan donations reportedly +240%) | M | 4 | Charity partners and accountability |
| E5 | «ليالي رمضان» · Ramadan nights | Mid-Ramadan (~15th): pre-packed ماجينة sweets bags for the children who knock. Night trays of زلابية وبقلاوة for محيبس gatherings at cafés and homes, sold as a bundle with no "loser pays" mechanics in the app. A small illustrated home touch. | P1: childhood customs remembered | Iraqi customs (ماجينة; محيبس) | S | 3 | Low; the panel checks wording |
| E6 | «أيام الحزن» · Mourning calendar and quiet mode | On mourning days set by the local panel (Muharram 1–13 and Ashura, 20 Safar, 19–21 Ramadan, 25 Rajab, 3 Jumada II and others): celebrations, the delivered burst, sounds and promos switch off, and the accent is subdued. Service for نذر: bulk ingredients, big-pot pickup, D10 distribution, unbranded bags. | P4/P2: respect, plus genuinely useful logistics | Novel (no delivery app found doing this) | S–M | 4 | Sensitivity: the local panel decides the days |
| E7 | «خدمة الزوار» · Arbaeen service | Send water, ice and food to registered local مواكب. Extra الرجعة seats home from Karbala and Hilla after 20 Safar, at cost. A volunteer flag for drivers. Check locally whether Aziziyah's walkers or the 25 Rajab walk to Kadhimiya use the Baghdad road. **[Ali]** zero commission | P2: service, not marketing | Shrine ice factories and restaurant نذر funds; government Wi-Fi on the routes; no Iraqi app campaign found | M–L | 4 | Ops strain; Kut's walkers mostly go via Numaniyah, so local demand is the return trip |
| E8 | «غدا الجمعة» · Friday ahead | A Thursday-night card to schedule Friday breakfast (كاهي وگيمر، باقلاء بالدهن) or a lunch صينية (باچة، دولمة) to the grandparents' house. Only for households that did it before. The prayer pause is stated respectfully. | P1: helps keep a fading family ritual | Toters scheduled orders (teardown); Iraqi press notes the Friday gathering is fading | S | 4 | Low |
| E9 | «بارد يوصل بارد» · Summer cold chain | Insulated bags and ice packs for drinks, an ice and شربت category, late summer hours, and a courier heat allowance as a named line **[Ali]**. Kitchen open/closed status that knows the neighbourhood generator gaps. | P3: it arrives as cold as promised | Swiggy's weather-triggered prompts; Kut's 43–49°C summers and 12-hour blackouts (2026) | S | 3 | Low |
| E10 | «بين الشوطين» · Half-time slot | For Iraq match nights: a half-time delivery slot and a watch-party group order. Optionally, an event-triggered treat that's the same for everyone and costs nothing to enter («العراق سجّل: التوصيل علينا 20 دقيقة»). **[Ali]** | P1/P2: the food lands in the break | Swiggy Sixes (IPL 2025); Zomato's match-night push copy | S–M | 4 | Kitchen peak: slot caps. The World Cup kicked off at midnight to 1 am in Iraq, so kitchens need late hours. Never joke about losses. The panel decides whether a goal treat feels too close to chance |
| E11 | «عشاك يوصل وياك» · Dinner arrives with you | The cross-service Thursday ritual: dinner timed to the الرجعة arrival, plus a tuktuk waiting at the garage. | P1: a moment only a super-app with intercity seats can make | Novel | M | 5 | Timing: the kitchen fires when the car passes a checkpoint |

### F. Platform surfaces

| # | Idea | What | Why it delights | Benchmark | Eff | Imp | Risk |
|---|---|---|---|---|---|---|---|
| F1 | Lock-screen live | An Android ongoing notification (on all versions) for the food ETA, the ride and the الرجعة boarding pass; Android 16 Live Updates (a progress chip) later. On iOS, a Live Activity (extends audit d-8 and maps c8). | P3: watch without opening the app | Uber and Uber Eats Live Activities; Google's Android 16 Live Updates demo with Uber Eats | M–L | 5 | iOS needs `expo-widgets` (SDK 56+); Android 16 promotion needs a small custom module |
| F2 | Widgets | «الرجعة الجاية» (next cars and seats from my garage), «المعتاد» (one-tap reorder), «طلبي» (active order). | P1: the town on your home screen | Uber's iOS ride widget (2024) | M–L | 4 | Android: `react-native-android-widget` up to 0.17.2 fits SDK 52. iOS: `expo-widgets` on SDK 56+ |
| F3 | App shortcuts | Long-press the icon: اطلب المعتاد / تكتك للبيت / مقعد لبغداد / وين طلبي؟ | P1: two taps to the usual | iOS and Android quick actions | S | 3 | Low: `expo-quick-actions` 3.x works on SDK 52 |
| F4 | Moment kit: motion, haptics, sound | 6–8 vector animations (first order, arrival, safe arrival, Eidiya envelope, stamp card complete, gift sent), with static fallbacks on low-end phones. One haptic vocabulary (add = selection, confirm = impact, money in = success; Android system constants, never a buzzy `vibrate`). The 4-tone kit. All of it respects reduce-motion and the switches. | P4: premium peaks, a consistent physical feel | Duolingo's Rive characters (+1.7% D7 from milestone animations); Airbnb 2025 tactile icons; Apple and Android haptics guidelines | M | 4 | Lottie 7.1 now (bundled with SDK 52); Rive needs SDK 53+ |
| F5 | «درايفر لايت» · Lite mode | Turns on automatically for slow phones or networks: the static kitchen-to-door strip (audit d-3), no autoplay, compressed images, SMS status. | P3: delight for the cheapest phone too | Uber Lite (under 5 MB; not offered in Iraq); Android Go guidance | M | 4 | Two code paths: keep the lite one thin |
| F6 | «يشتغل حتى بلا نت» · Works through cuts | Orders are kept server-side, with SMS and WhatsApp status twins. The exam-morning shutdown (06:00–07:30) is handled by ordering the night before. | P3: reliability *is* delight in Iraq | Careem's phone bookings in Iraq; OBR's 6188 short code (both teardown) | M | 4 | SMS cost: capped |

### G. AI and voice

| # | Idea | What | Why it delights | Benchmark | Eff | Imp | Risk |
|---|---|---|---|---|---|---|---|
| G1 | «شنو آكل اليوم؟» · Food concierge, inside search | Not a chatbot tab. An empty search shows «شنو آكل اليوم؟» with chips (كم نفر؟ ميزانية؟ شي خفيف؟) and gives 3 suggestions from open kitchens, each with its full total. Retrieval only, nothing invented. | P1: decision help where people already look | DoorDash "Ask DoorDash" in the search bar (2026); Swiggy found little demand for food chatbots | M | 4 | Hallucination: structured retrieval only, and a confirm step |
| G2 | «اطلب بصوتك» · Voice-note ordering | Hold to talk in Iraqi dialect, like a WhatsApp voice note; it becomes a cart to confirm. The same pipeline can serve WhatsApp voice notes to the ops number, for people without the app. Also powers errands (spec §7). | P1: how Iraqis already order from shops on WhatsApp | Swiggy with Sarvam (2026: voice ordering in 11 languages, including by phone call); Meituan Xiaomei | M–L | 4 | Dialect accuracy (no public Iraqi benchmark): test ~100 local voice notes on Google `chirp_3` ar-IQ and Azure ar-IQ first; always confirm |
| G3 | «المعتاد» · Usuals | Learns household patterns (Friday breakfast, Thursday dinner) and offers them at the right time, with the reason («لأنك طلبته 3 جمعات»). The user can make it recurring. It never auto-orders. | P1: recognition, and time saved | Uber Eats "Order again"†; Toters favourites and one-tap reorder (teardown); maps p4 (parked) | S–M | 5 | Feels creepy unless it says why: always explain |
| G4 | «حاسبة العزيمة» · Quantity helper and big occasions | «لـ 12 نفر: 3 كيلو كباب، 6 تمن، 2 زلاطة», from restaurant portion data and editable. For weddings, feasts and فاتحة: scheduled delivery, a deposit **[Ali]**, and a quiet design for mourning. | P2: the host looks generous and doesn't overspend | Catering flows (ezCater)† | S–M | 4 | Portion data quality; deposit rules |

### H. Sharing

| # | Idea | What | Why it delights | Benchmark | Eff | Imp | Risk |
|---|---|---|---|---|---|---|---|
| H1 | «شارك صحنك» · Story card | After delivery, a story-ready card: dish photo or art, restaurant, «العزيزية», a small Driver mark. Sized for Instagram, Snapchat and WhatsApp status. No price or address. | P1/P2: the boys' night looks good, and the restaurant gets seen | Spotify Wrapped cards (≈500M shares in 2025); Strava share images | M | 4 | Instagram Stories needs a Facebook App ID; WhatsApp Status goes via the share sheet; render with Skia (view-shot has a blank-capture issue on SDK 52) |
| H2 | «جاي للعزيزية» · Shareable pass | A beautiful boarding-pass card with a live link for the family (extends share-trip). | P1: mum sees it in the family group | Airline passes in Apple and Google Wallet† | S | 4 | First name only |
| H3 | «قصة المطعم» · Kitchen stories | Short owner and kitchen videos (the grill, the tannour) on the restaurant page, which the restaurant can repost on TikTok. | P1: you know who cooks your food | Baemin's "food as pop culture" | M | 3 | Content operations |

---

## 4. Top 10, ranked by impact ÷ effort

Ranked by how many weekly useful opens and how much love each bet should buy per week of work. All of
them build on code that exists today: `homeContext()` (home's single contextual card), `ReorderCard`
and `orders/reorder.ts`, the participants and household models, `share/[token]`, the Promotion
object, `EtaService`, and scheduled orders. **Sequencing caveat:** bet 7 is ranked 7th but has the
hardest deadline (Ramadan ≈ 8 Feb 2027). Start its quiet-mode half this month.

### 1. «العزيزية اليوم» + «قدر اليوم» (E1 + E2) · Imp 5 · Eff S–M
The daily reason to open the app without spending anything.
- **Merchant:** a weekly pot template (السبت باميا، الأحد فاصوليا…), set once. Each morning one tap
  confirms it («اليوم نفس الجدول؟» with the check icon) and writes a `dailyPot` read model.
- **Customer home:** when nothing is active, `homeContext()` gains a time-aware `today` card with 3
  rows: today's pots (2 kitchens), "open now: 6 kitchens", and the next car from *your* garage (only
  if you've used الرجعة).
- **Follow a dish:** «خبرني يوم الباچة» sends one push at 10:30, on that dish's day only, at most one
  a day.
- **Measure:** card taps that become orders before 13:00. **Guardrail:** follow opt-outs.

### 2. «المعتاد» + «غدا الجمعة» (G3 + E8) · Imp 5 · Eff S–M
Recognition and time saved, the strongest repeat lever (audit C-15).
- **Server:** the same cart (same kitchen, at least 70% of the same items) ordered twice or more in
  the same weekday and time band within 6 weeks becomes a `usual`, with a reason string («لأنك طلبته
  3 جمعات»).
- **Home:** the usual replaces the generic reorder card when its time band is near, with
  «اطلب هسة» and «خلّيه كل جمعة 8:30 ص».
- **Recurring orders:** re-quoted and confirmed the night before with one tap
  («باچر 8:30 ص فطوركم، نأكده؟»). Never placed silently. Skip or stop any time.
- The Thursday 20:00 card shows only when a Friday usual exists. Quick action F3 «اطلب المعتاد»
  ships with it (`expo-quick-actions` works on SDK 52).

### 3. «أهلي يتابعون» + «وصل بالسلامة» (D9 + B2) · Imp 5 · Eff S–M
Safety that feels like care, for women, students and their mothers.
- **Family circle:** up to 3 people from the household or by phone number. At the first الرجعة
  booking, «تريد أهلك يتابعون السفرة؟» offers chips. On boarding, those people get the existing
  `share/[token]` link (first name, car, plate, live car); non-users get it by WhatsApp template.
- **On arrival** (`departure.arrived` plus the rider's fix at the destination garage): a calm
  full-screen «الحمد لله على السلامة», a ping to the circle («{name} وصل كراج النهضة بالسلامة
  7:42 م»), and «تكتك للبيت؟».
- **Control:** a persistent «يتابعك: أمي، أختي» strip with pause. The rider controls it; guardians
  of minors always see.

### 4. «عزيمة» + «هدية لصديقك» (D1 + D7) · Imp 5 · Eff M
Generosity as the growth engine.
- Checkout gets «لمنو الطلب؟ → لبيت ثاني», built on the participants model (`{name}: طلبك مع
  {orderer}` copy exists).
- **Recipient:** a WhatsApp heads-up («{sender} عازمك على غدا من {kitchen}. يوصل 1:30 م»), with a
  link to change the time or decline (a decline refunds the sender).
- **Payment** is wallet-only, which also gives people a warm reason for their first top-up. The
  sender sees only «وصل» plus an optional thank-you voice note.
- **Referral as a gift:** after a 5-star rating or a safe arrival, «عزّم صديقك على أول 3
  توصيلات» goes out as a WhatsApp message in the sender's name. Points follow the existing rule
  (2,000 each side after the friend's 2nd order).

### 5. «عشاك يوصل وياك» (E11) · Imp 5 · Eff M
The moment only Driver can make, because nobody else owns both the seat and the kitchen.
- On a booked seat *to* Aziziyah, the rider or a watching family member sees «عشا للبيت وقت
  وصولك؟».
- That creates a scheduled order whose fire time is the car's live ETA (from `EtaService`) minus
  prep minus delivery. It's recomputed on each fix, and the kitchen gets the ticket only once the car
  passes a midway geofence. Cancellation is free until then.
- An optional tuktuk is pre-matched at T−10 to wait at the garage.
- **Measure:** cross-service households, and the share of الرجعة riders who also order food.

### 6. «كارت الختم» (C1) · Imp 5 · Eff M · [Ali]
Loyalty that's certain, merchant-funded and local.
- A new Promotion effect, `stamp_card`: every Nth qualifying item or order free, funded by the
  merchant, with a budget cap. Approved in Console like deals; parity rules apply.
- Shown on the restaurant page and in the cart as «باقي ختمين والجاية علينا». A 12-stamp card
  starts with 2 stamps (endowed progress). It lasts while you order within 12 months.
- Redemption is a named receipt line: «ختم مطعم خالد · على حساب المطعم».
- Never pushed. The completion moment uses the moment kit (F4).

### 7. The season engine: Ramadan 2027, mourning quiet mode, «وزّع» (E3 + E6 + D10) · Imp 5 · Eff M
One config system instead of yearly hacks. **Start now: the next mourning day is ~13 Nov 2026.**
- **`Season` objects in Console:** start and end in Asia/Baghdad, set by the local panel.
  - Switches: celebrations, the delivered burst, sounds, promotional pushes, theme accent.
  - A home card.
  - Delivery slots.
- **Quiet mode first (S):** gate the shipped delivered burst and tones behind
  `season.celebrations`.
- **Ramadan:**
  - An iftar slot keyed to the timetable the person follows. Picked once, with neutral labels,
    because Sunni and Shia maghrib and start days differ.
  - Slot caps per kitchen; suhoor hours.
  - A 20–30 minute courier iftar break with honest copy.
  - «فطور صائم» via verified local charities.
- **«وزّع»:** a multi-door order (one payment, N drop-offs, a photo per door) serves Eid al-Adha
  thirds, نذر pots and results-day sweets.

### 8. «أسطتي» favourite drivers (D6) · Imp 5 · Eff M
Trust is personal in a small town.
- A heart on the driver card after a ride or seat; a list in profile; shared across the household
  (grandparents and daughters ride with known drivers).
- **Dispatch:** for *scheduled* rides and الرجعة bookings only, the offer goes to favourites first
  for a short window before the normal wave. The driver is told when someone favourites them (the
  Lyft pattern).
- Pair it with «ما أريده مرة ثانية» (block). On-demand dispatch stays unchanged at launch.

### 9. Lock screen and home screen (F3 → F1 → F2) · Imp 5 · Eff M–L
Make the app present without being opened.
- **Now, on SDK 52:**
  - Quick actions (F3).
  - An Android ongoing notification for active food, ride and boarding-pass states, with plain
    progress text. This works on every Android, and about 86% of Iraqi phones are Android.
  - The Android widgets «الرجعة الجاية» and «المعتاد» via `react-native-android-widget` ≤0.17.2.
- **After the SDK upgrade (56+; `expo-av` → `expo-audio`):**
  - iOS Live Activity and widgets via `expo-widgets`.
  - Android 16 Live Updates through a small custom module.
- **Server:** APNs `liveactivity` topic, FCM data messages.

### 10. «ستيكرات درايفر» + «أول مرة» (A2 + B1, on F4) · Imp 4 · Eff S–M
The brand's warmth, carried by people into their family groups.
- **Stickers:** commission 12–16 from an Iraqi illustrator (the tuktuk character, a courier with an
  insulated bag, the garage board, «على حسابي», «صحة وعافية», «جاي بالطريق», «وصلت بالسلامة»).
  Offer "add to WhatsApp" from inside the app; reuse them as chat quick replies.
- **Firsts:** first order, first tuktuk, first seat, first gift.
  - Four Lottie moments (Lottie 7.1 ships with SDK 52; Rive after the upgrade).
  - Shown once per lifetime, flagged server-side per person.
  - Silent on mourning days.

**Next after these:** B4 year story (December 2027, once there's a year of data), C3 savings
guarantee (when the subscription ships), G1 and G2 inside search (run a ~100-voice-note dialect test
first), H1 story card, E10 half-time slot, C6 rescued meals, A3 دارمي contest.

---

## 5. What NOT to do (anti-ideas)

| Don't | Why not | Do instead |
|---|---|---|
| **Spin-the-wheel, scratch cards, mystery boxes, "up to 100% cashback", random reward drops, daily "treasure boxes"** | Chance-based reward is maysir (religiously prohibited gambling) for most of our users, and a variable-ratio schedule is the most compulsive reinforcement there is. Even famous programmes cross this line: the Starbucks Summer Game rules describe an "Instant Win Game" and a "Sweepstakes", and Meituan's meal-time boxes give coupons at random. | Fixed, visible rewards: stamp cards, points in دينار, milestone perks (P5). |
| **Random-split money gifts** (WeChat "lucky money" mechanics) | Research on WeChat red packets finds their pull is the *lottery*: grabbing first, being "luckiest". That is gambling dressed as a gift. | «العيدية» with fixed amounts per person, chosen by the giver. |
| **Daily streaks that die, guilt pushes, a crying mascot** («راح تخسر سلسلتك!») | Shame-based retention breeds anxiety and resentment, and it is documented even at Duolingo. Food every day is also not a healthy goal. | Weekly rhythm, rest weeks, nothing earned is ever lost (C4). The mascot never nags. |
| **Fake urgency or scarcity** ("3 people are looking", countdown deals that reset, "only 2 left" that isn't true) | Our brand is honesty («تأخرنا وهذا غلطنا»). One fake timer spends years of trust. | Only real counts (seats left on a real departure, a real stamp count). Deals end on a stated date. |
| **Marketing push without opt-in; more than ~2 promotional pushes a week** | Baly's reviews complain about ad-spam with no toggle. A field experiment on a retail app found more non-personalised pushes meant more uninstalls and fewer opens. An opt-out is usually permanent. | Transactional by default; promotional opt-in by topic («قدر اليوم»، «عروض مطعمي»); quiet hours 23:00–07:00; no promos at iftar time or during Friday prayer. |
| **Leaderboards of spending or ordering** («أكثر زبون بالعزيزية») | Small town: it exposes who orders what, shames those who can't, and rewards overconsumption. | Private milestones only. Restaurant "regulars" status is shown only to the customer, and to the restaurant only if the customer agrees. |
| **Social feeds of what neighbours order** («جارك طلب…»), "trending on your street" | Privacy in a small town; women's safety; spec D7 (k-anonymity). | Town-level only («الأكثر طلباً بالعزيزية اليوم»), with a minimum of 20 orders before anything is shown. |
| **Celebration in Muharram/Ashura; "Happy Hijri New Year"** | 1 Muharram opens the mourning season for most of Wasit. A festive theme reads as mockery. | An automatic quiet mode, plus service features (نذر logistics). A local review panel signs off every seasonal change. |
| **Arbaeen "offers" and branded pilgrim marketing** | It commercialises a pilgrimage. The local norm is service: shrines run free ice factories and restaurants fund نذر meals, and no Iraqi app campaign was found. Marketing would stand out for the wrong reason. | Service only: zero-commission water and ice to مواكب [Ali], extra seats at cost, no logo on the help. |
| **Sectarian or political signals** (one sect's occasions celebrated, others ignored; political figures) | It splits customers and drivers, and is a safety risk. | National and pan-Islamic moments get warmth. Occasions specific to one community get modest, opt-in acknowledgement reviewed by the local panel. |
| **Edgy-humour pushes copied from Zomato or Swiggy** | Indian internet humour doesn't translate. Double meanings in Iraqi dialect can offend families. Zepto's insensitive push and Zomato's controversies (below) show how fast a cheeky voice goes wrong. | Warm, gentle, place-based wit, reviewed by an Iraqi copywriter and the local panel. |
| **Photos of women in ads; gendered targeting; courier "attractiveness" ratings** | Modesty norms and safety. | Illustration and food photography. Ratings about service only, with chips. |
| **Speed promises that push couriers** ("10 minutes or free", a timer on the customer's screen) | India's labour minister stepped in, and Swiggy and Blinkit dropped 10-minute promises (Jan 2026): "a timer runs on the customer's screen, the pressure is real". The ARIJ investigation documents injured Iraqi riders. | An honest ETA plus the existing delay credit, paid by the platform, never from the courier. |
| **Tip guilt** (a tip screen before delivery; pre-selected tips; "the courier is waiting for your tip") | Tipping pressure is a dark pattern, and couriers asking for tips is a Talabatey complaint. | An optional tip *after* a 5-star rating, nothing pre-selected, "100% to the courier" stated (audit C-12). |
| **Points that expire unless you order in a row; complicated tiers** | Toters' top loyalty complaint. | Points that last while you're active [Ali]; two tiers with service perks. |
| **Hard-to-cancel subscription, auto-enrolment, a trial that bills silently** | Plain decency, and the "click to cancel" principle regulators keep pushing for. Trapped subscribers become loud detractors in a small town. | 2-tap cancel, a reminder 3 days before renewal, a savings meter, the savings guarantee [Ali]. |
| **Pop-up promo walls when the app opens** | They block the job the person came to do. | One contextual card under the services (the existing home context system). |
| **AI that invents menus, prices or "chef recommendations"; celebrity voice clones** | It breaks price honesty and is legally risky. | Retrieval-only AI over live menus and prices; it always shows the total and asks for confirmation. |
| **Gamified eating stats** ("you ate 40 shawarmas!") | Fun once, but it glorifies overeating and can embarrass people on a shared card. | Stats about discovery, family and travel: restaurants tried, kilometres home, meals sent to others. |
| **Prediction games with prizes on football** | Prize plus uncertain outcome is betting in all but name. | Half-time delivery slots and watch-party group orders, with no stakes. |
| **Bets and wagers of any kind** (streak wagers, "double or nothing" points) | Duolingo's Streak Wager lifted 7-day retention 14%, and it is still a bet. | Fixed milestone bonuses. |
| **"Loser pays" mechanics in the app** (a محيبس round where the app charges the losing team) | It turns a social forfeit into a wager we process. | Sell the زلابية and بقلاوة trays as a Ramadan-night bundle. Who pays stays between friends. |
| **Virtual farms, "steal water from friends", invite-to-unlock tasks** | Meituan's orchard (copied from Pinduoduo) was built for login frequency and pushes people to spam friends. | Gift-framed referral, offered once after a peak moment. |
| **Roast-style recaps by default; a paywalled recap** | Zomato's LookBack "roasts" users. Strava put Year in Sport behind its subscription in 2025 and drew backlash. Wrapped 2024 was criticised for being wrong. | Kind by default, free, accurate, opt-in. |
| **Visible classes of couriers or customers** (uniform colours by diet or sect, "VIP" badges on the doorstep) | Zomato's "Pure Veg Fleet" green uniforms were pulled within a day over fears of caste harassment. | One courier look; perks invisible to everyone else. |
| **Personified product pushes and innuendo** | Zepto's "I miss you" push in the voice of an emergency contraceptive caused backlash and an apology. A cheeky voice also makes fakes believable (the fake Zomato "₹370 biryani" push, 2026). | Plain, warm pushes, plus a public archive of the real ones (A5). |
| **Assuming one Ramadan or Eid start, or one iftar time** | Iraq's Sunni and Shia authorities often start a day apart (2024: 11 vs 12 March), and maghrib timetables differ. | The person picks the timetable they follow. Copy says «عيدكم مبارك» without asserting the day. |
| **Food-heavy pushes during fasting hours** | They tempt and annoy people who are fasting. | Pre-orders for iftar and suhoor, promoted after iftar or in-app only. |
| **Jokes about Iraq's football losses** | National pride (World Cup 2026: three losses). | Celebrate showing up; serve the watch party. |

---

## 6. Sources

Every link below was opened by me or a research sub-agent unless marked *(snippet)*: seen in search
results but not opened. Some are marked *(unverified)*: a weak or secondary source. Grouped by the
benchmark names used in §3.

**Repo (read, not changed):** `docs/research/2026-10-02-competitor-teardown.md`,
`docs/research/ui-ux-audit/customer.md`, `docs/specs/2026-10-03-customer-app.md`,
`docs/specs/2026-10-02-voice-and-microcopy.md`, `docs/specs/2026-10-02-money-and-ops.md`,
`docs/specs/2026-10-02-domain-and-events.md`, `docs/specs/2026-10-03-edge-case-decisions.md`,
`docs/specs/2026-10-05-maps-world-class.md`, `docs/superpowers/plans/2026-10-05-tracking-moments.md`,
`apps/customer/src/features/home/context.ts`, `apps/customer/app.json`, `docs/deploy/mobile.md`.

### Delivery and mobility apps
- **Zomato:**
  - Food Rescue: https://inc42.com/buzz/zomato-food-rescue-zomato-users-can-buy-cancelled-orders-at-discounted-rates/ ; https://www.zomato.com/blog/food-rescue/ *(snippet)*
  - Legends shutdown: https://www.businesstoday.in/tech-today/news/story/zomato-shuts-down-inter-city-delivery-service-legends-over-lack-of-product-market-fit-says-ceo-deepinder-goyal-442670-2024-08-22 *(snippet)*
  - Push copy: https://www.junoschool.org/article/zomato-push-notification-strategy/ *(unverified)*
  - Year trends: https://www.grapevine.in/post/biryani-takes-the-crown-zomatos-2024-food-trends-398287fa-6702-4d1c-a0b0-9de5e8f71ac7 *(snippet)*
  - LookBack roast: https://www.afaqs.com/marketing/zomatos-new-year-wrapped-roasts-consumers-for-their-past-purchases-8588461 *(snippet)*
  - Pure Veg Fleet: https://theprint.in/india/zomato-rolls-back-green-uniform-for-its-pure-veg-fleet-after-customers-call-it-casteist/2007980/ *(snippet)*
  - Fake push: https://www.businesstoday.in/latest/trends/story/dinner-not-consent-zomato-clarifies-on-rs370-biryani-notification-controversy-536229-2026-06-11 *(snippet)*
- **Swiggy:**
  - Sixes: https://www.plotline.so/inspiration/swiggy-unlocks-match-day-excitement-through-offers-for-every-six-hit-during-ipl
  - Bolt: https://www.swiggy.com/corporate/press-release/swiggy-expands-its-10-minutes-delivery-offering-bolt-to-400-cities/
  - Copy: https://www.afaqs.com/news/profile/meet-shikha-gupta-the-creative-mind-behind-swiggys-funky-puns-emailers-social-content
  - Sarvam voice ordering: https://www.cxodigitalpulse.com/swiggy-partners-sarvam-to-launch-multilingual-voice-ordering-for-food-and-quick-commerce/
  - LLM lessons: https://www.zenml.io/llmops-database/building-a-comprehensive-llm-platform-for-food-delivery-services
  - 10-minute rollback: https://gulfnews.com/world/asia/india/swiggy-blinkit-drop-10-minute-delivery-after-indian-govt-flags-rider-safety-1.500406940
- **Zepto i-Pill push:** https://www.deccanherald.com/amp/story/business%2Fcompanies%2Fmiss-you-says-i-pill-zepto-faces-backlash-over-insensitive-notification-issues-apology-3232640 *(snippet)*
- **Baemin:**
  - Typeface prize: https://vietcetera.com/en/dancing-typeface-wins-top-international-prize-for-baemin-food-delivery-app
  - Overview: https://en.wikipedia.org/wiki/Baedal_Minjok
  - Hanna font: https://fontsinuse.com/typefaces/219562/bm-hanna *(snippet)*
  - Food-poem contest: http://www.readersnews.com/news/articleView.html?idxno=92938
  - Fan club: https://www.asiae.co.kr/article/2022032210005015254 *(snippet)*
  - Café campaign: https://www.koreaherald.com/article/10721156
  - Meal Mate: https://en.sedaily.com/news/2026/07/07/baemin-seoul-city-launch-meal-mate-campaign-to-ease
  - Design system: https://oh-my-design.kr/design-systems/baemin *(snippet)*
- **Wolt:**
  - Support: https://careers.wolt.com/en/teams/support
  - Split payments: https://press.wolt.com/en-WW/267274-no-more-one-person-picking-up-the-bill-wolt-launches-split-payments-for-ordering-together-globally/
  - Wolt+: https://explore.wolt.com/wolt-plus *(snippet)*
- **Meituan:**
  - Orchard: https://finance.sina.cn/stock/relnews/us/2019-05-11/detail-ihvhiqax8057611.d.html
  - Xiaomei agent: https://www.thestar.com.my/tech/tech-news/2025/09/12/meituan-launches-ai-agent-to-boost-food-delivery-business
- **talabat:**
  - Share an Iftar: https://www.qatar-tribune.com/article/220403/nation/talabat-enables-customers-to-share-an-iftar-through-in-app-giving-option
  - AI assistant: https://www.deliveryhero.com/newsroom/delivery-hero-talabat-first-ai-shopping-assistant-mena/
  - Ramadan scheduling: https://thepeninsulaqatar.com/article/14/05/2020/ *(snippet)*
- **Toters:**
  - Cash: https://www.totersapp.com/toters-cash-iraq-draft
  - Reviews: https://apps.apple.com/us/app/toters-%D8%AA%D9%88%D8%AA%D8%B1%D8%B2/id1015006220
- **Careem:**
  - Right Click: https://blog.careem.com/posts/giving-back-in-ramadan-with-careem
  - Iftar pause: https://www.imagesretailme.com/no-delivery-for-30-minutes-during-iftar-says-careem/ ; https://www.khaleejtimes.com/ramadan/flexible-work-hours- *(snippet)*
  - Careem Plus: https://www.thenationalnews.com/lifestyle/2026/06/05/careem-plus-price-to-rise-more-than-50-from-july-jumping-from-dh19-to-dh29-per-month/
- **Uber:**
  - Uber One: https://www.pymnts.com/earnings/2025/uber-one-hits-30-million-subscribers-drives-delivery-revenues-22percent-higher/
  - YOUBER: https://www.uber.com/us/en/newsroom/introducing-youber-2025/
  - Live Activities: https://www.macrumors.com/2023/05/02/uber-eats-live-activities/ ; https://9to5mac.com/2022/12/09/uber-and-uber-eats-live-activities/
  - Widget: https://9to5mac.com/2024/11/20/uber-ios-widget/
  - Cart Assistant: https://www.grocerydive.com/news/uber-ai-cart-assistant-personal-shopper-technology-grocery/811910/
  - Uber Lite: https://www.uber.com/en-AE/newsroom/uber-lite-uae/ ; https://www.uber.com/en-CA/u/uber-lite-app
- **DoorDash:**
  - DashPass Q2 2025: https://www.sec.gov/Archives/edgar/data/1792789/000179278925000011/q22025dashex991-pressrelea.htm
  - Summer of DashPass: https://about.doordash.com/en-us/news/summer-of-dashpass-2025 *(snippet)*
  - Ask DoorDash: https://techcrunch.com/2026/06/11/doordashs-new-ai-chatbot-lets-you-order-with-prompts-and-photos/
  - Text agent: https://techcrunch.com/2026/09/30/doordash-launches-an-ai-agent-you-can-text-to-order-food/
- **Grab Challenges:** https://www.grab.com/sg/rewards/challenges/
- **Gojek:**
  - Lottie case study: https://lottiefiles.com/case-studies/gojek
  - Driver gamification critique: https://restofworld.org/2021/only-gojek-knows-this-mystery/
- **Glovo Prime:** https://glovoapp.com/en/it/glovo-prime
- **Rappi:** https://marketing4ecommerce.net/en/what-is-rappi-evolution-of-a-successful-delivery-app-in-latin-america/
- **Zomato AI (2023):** https://www.business-standard.com/companies/news/zomato-launches-ai-chatbot-for-seamless-food-ordering-for-gold-customers-123090200047_1.html
- **Lyft Favorite Drivers:** https://www.cbsnews.com/news/lyft-favorite-driver/ ; https://therideshareguy.com/lyft-introduces-favorite-driver/
- **Push frequency and uninstalls (Wohllebe 2021):** https://www.researchgate.net/publication/351932011 *(snippet)*

### Delight products and behavioural science
- **Duolingo:**
  - Streak: https://blog.duolingo.com/improving-the-streak ; https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals ; https://blog.duolingo.com/how-duolingo-streak-builds-habit
  - Friend Streak: https://blog.duolingo.com/product-lessons-friend-streak/
  - Streak Revival (Q2 2026 letter): https://www.sec.gov/Archives/edgar/data/1562088/000162828026053299/q2fy26duolingo6-30x26share.htm
  - Growth: https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth
  - Notification bandit (KDD'20): https://research.duolingo.com/papers/yancey.kdd20.pdf
  - Rive visemes: https://blog.duolingo.com/world-character-visemes
  - Phoenix milestone: https://blog.duolingo.com/streak-milestone-design-animation
  - TikTok: https://www.thedrum.com/news/duolingo-s-tiktok-mastermind-its-unhinged-social-strategy-and-killing-its-mascot
  - Critiques: https://debugger.medium.com/duolingo-needs-to-chill-8f1832745ca0 *(snippet)* ; https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification ; https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame *(snippet)*
- **Streak-break research (Silverman & Barasch):** https://www.udel.edu/udaily/2024/march/power-of-streaks-motivation-jackie-silverman/
- **Spotify Wrapped 2025:** https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase/
  - Wrapped 2024 criticism: https://techcrunch.com/2024/12/04/spotify-users-are-disappointed-by-an-underwhelming-wrapped-this-year *(snippet)*
- **Recaps elsewhere:**
  - Strava paywall: https://road.cc/content/news/strava-year-sport-now-only-subscribers-317425 *(snippet)*
  - YOUBER: https://www.primetimer.com/news/what-is-youber-all-you-need-to-know-about-ubers-new-year-in-review-recap-feature *(snippet)*
  - Monzo nice/savage: https://www.scotsman.com/business/consumer/monzo-wrapped-how-to-find-2024-year-in-review-4911556 *(snippet)*
  - Apple Music Replay: https://www.techradar.com/audio/audio-streaming/apple-music-replay-2024-is-here-and-its-better-than-spotify-wrapped-in-one-key-way *(snippet)*
- **Apple Fitness:**
  - Pause rings: https://www.apple.com/newsroom/2024/09/watchos-11-is-available-today/
  - Study: https://www.apple.com/newsroom/2025/04/get-active-with-apple-watch/
  - Critique: https://fortune.com/well/2025/01/24/apple-watch-bullied-burn-calories-close-rings-obsession-fitness-trackers-notifications
- **Nike Run Club:** https://www.nike.com/nrc-app
- **Strava:**
  - Local Legends: https://support.strava.com/hc/en-us/articles/360043099552-Local-Legends
  - Kudos study: https://www.sciencedirect.com/science/article/pii/S0378873322000909 *(snippet)*
- **Starbucks:**
  - Rewards: https://www.restaurantdive.com/news/starbucks-rewards-loyalty-q3-personalization/706357/
  - Summer Game rules (chance-based): https://starbucks.promo.eprize.com/summer2023/public/fulfillment/rules.pdf
  - 2026 changes: https://thepointsparty.com/articles/starbucks-rewards-changes-2026-elite-tiers-devaluation *(snippet)*
- **Headspace motion:** https://www.itsnicethat.com/features/headspace-guide-to-meditation-netflix-animation-150221
- **Monzo:**
  - Tone of voice: https://monzo.com/tone-of-voice
  - Hot coral: https://www.phable.io/phable-labs/monzo-brand-origin-inspired-by-nike *(unverified)*
- **Airbnb 2025 Summer Release:** https://news.airbnb.com/airbnb-2025-summer-release/
  - Lava format: https://medium.com/@waldobear002/airbnbs-new-lava-icon-format-a-technical-deep-dive-b2604626c7e0 *(unverified)*
- **Peak-end rule:** https://thedecisionlab.com/biases/peak-end-rule *(snippet)*
- **Goal gradient (Kivetz, Urminsky & Zheng):** https://home.uchicago.edu/ourminsky/Goal-Gradient_Illusionary_Goal_Progress.pdf
- **Endowed progress (Nunes & Drèze):** https://www.researchgate.net/publication/23547282 *(snippet)*
- **IKEA effect:** https://myscp.onlinelibrary.wiley.com/doi/abs/10.1016/j.jcps.2011.08.002 *(snippet)*
- **Emergency reserves (Sharif & Shu):** https://anderson-review.ucla.edu/emergency-reserves
- **Flexible incentives (Beshears et al.):** https://pubsonline.informs.org/doi/10.1287/mnsc.2020.3706 *(snippet)*
- **Exercise megastudy (Milkman et al.):** https://www.cmu.edu/dietrich/news/news-stories/2021/megastudy-exercise.html
- **Fogg Behavior Model:** https://behaviormodel.org/
- **Hooked critique:** https://www.thebehavioralscientist.com/articles/an-incomplete-loop-a-review-of-nir-eyals-hooked
- **Center for Humane Technology:** https://www.humanetech.com/course
- **FTC dark patterns:** https://www.ftc.gov/reports/bringing-dark-patterns-light
- **Maister, The Psychology of Waiting Lines:** https://davidmaister.com/articles/the-psychology-of-waiting-lines/
- **WeChat red packets (the lottery is the draw):** https://arxiv.org/pdf/1712.02926 ; https://journals.sagepub.com/doi/full/10.1177/20563051211041643 ; https://www.technologyreview.com/2019/07/10/134255/wechat-is-running-a-natural-experiment-in-human-generosity/
- **الخبز المعلّق:** https://arabic.cnn.com/travel/article/2020/01/22/hanging-bread-origins ; https://www.aljazeera.net/lifestyle/2020/5/17/%D8%A7%D9%84%D8%AE%D8%A8%D8%B2-%D8%A7%D9%84%D9%85%D8%B9%D9%84%D9%82-%D8%B9%D8%A7%D8%AF%D8%A9-%D8%A7%D9%84%D8%AA%D9%83%D8%A7%D9%81%D9%84-%D8%A7%D9%84%D8%B9%D8%AB%D9%85%D8%A7%D9%86%D9%8A%D8%A9

### Iraq: calendar, culture, context
- **Hijri dates 2027:** https://islamicinfocenter.com/islamic-events-2027/
  - Arbaeen: https://www.prokerala.com/when-is/arbaeen.html
  - Split start days: https://www.newarab.com/news/shaped-politics-iraq-marks-ramadan-two-different-days
  - Ghadir: https://alejazat.com/iraq/2026/iraq-ghadir/ ; https://asharq.com/politics/89091/
- **Arbaeen:**
  - 2026 count: https://en.shafaqna.com/468777/
  - 2026 holiday: http://www.non14.net/190293
  - 2025 count: https://en.964media.com/39246/
  - Routes: https://imamhussain.org/arabic/16244 ; https://ar.wikishia.net/view/مسيرة_الأربعين
  - Kut–Numaniyah route: https://www.dorar-aliraq.net/threads/1070- *(snippet)* ; https://alkafeel.net/fourty/index.php?mview=34
  - Wasit plan for Iranian pilgrims: https://shiawaves.com/arabic/الأربعين-الحسيني/196324- *(snippet)*
  - Iranian pilgrims 2026: https://www.france24.com/en/live-news/20260801-iranian-pilgrims-flood-iraq-for-first-arbaeen-since-war
  - Aziziyah مواكب channel: https://www.youtube.com/channel/UCnwAaAYUSO98A3OOj1NrkJA
  - نذر funds and mawakib: https://iraq.shafaqna.com/AR/370899/
  - Shrine ice factories: https://imamhussain.org/arabic/39023
  - Route Wi-Fi: https://shiawaves.com/english/news/islam/iraq/131134- *(snippet)*
- **Muharram norms:** https://shafaq.com/en/Report/Muharram-in-Iraq-New-year-becomes-a-season-of-mourning
  - Ashura 2026 date: https://islamicrelief.org.au/when-is-ashura-2026/
- **Ramadan:**
  - Iftar and suhoor: https://annabaa.org/arabic/views/41862
  - ماجينة: https://ar.wikishia.net/view/ماجينا ; https://www.albayan.ae/ramadan/ritual/34486
  - محيبس: https://karbala.gov.iq/news/6907 ; https://aawsat.com/home/article/403536/
  - Zakat al-fitr 1447: https://ina.iq/ar/local/257365-2000.html
  - Talabat Mart Ramadan 2026: https://horecamea.com/2026/02/26/ *(snippet)*
- **Eid:**
  - Eid al-Fitr: https://www.qna.org.qa/ar-QA/News-Area/News/2024-04/10/0032- *(snippet)* ; https://aawsat.com/home/article/461541/
  - Eid al-Adha: https://rahhal.wego.com/blog/ *(snippet)*
  - Eid change: https://asharq.com/variety/138332/
- **Friday and breakfast:**
  - Friday gathering: https://newsabah.com/newspaper/298328
  - Breakfast dishes: https://www.measuringcupsoptional.com/iraqi-breakfast-bagila-bil-dihin-fried-eggs-broad-beans/ ; https://www.tasteatlas.com/kahi-and-geymar
  - فاتحة: https://iraq.shafaqna.com/AR/393351/
- **Heat and power:**
  - Kut climate: https://en.wikipedia.org/wiki/Kut
  - Wasit 49°C: https://thenewregion.com/posts/2778/ *(snippet)*
  - 2026 power crisis: https://www.mees.com/2026/5/15/power-water/iraqs-electricity-sector-in-summer-crisis-mode/ *(snippet)* ; https://www.kurdistan24.net/en/story/911768/
  - Kut generators: https://964media.com/360978/
- **Football:**
  - Iraq qualifies: https://aljazeera.com/sports/2026/4/1/iraq-defeat-bolivia-2-1-to-qualify-for-fifa-world-cup-2026
  - Group I: https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_Group_I
  - Gulf Cup: https://en.wikipedia.org/wiki/27th_Arabian_Gulf_Cup
  - League: https://en.wikipedia.org/wiki/Iraq_Stars_League
  - Al-Kut SC: https://ar.wikipedia.org/wiki/نادي_الكوت
- **School and university:**
  - 2026 start: https://en.964media.com/53108/
  - Wasit University: https://ar.wikipedia.org/wiki/جامعة_واسط
  - Aziziyah: https://ar.wikipedia.org/wiki/العزيزية_(العراق) ; https://en.wikipedia.org/wiki/Al-Aziziyah_(Iraq)
  - Results day: https://zahraa.mr/6078451/ *(snippet)*
- **Exam internet shutdowns:**
  - 2026: https://pulse.internetsociety.org/en/shutdowns/exams-shutdown-iraq-11-june-2026/
  - 2025: https://pulse.internetsociety.org/en/blog/2025/05/iraq-to-shutdown-internet-during-2025-exam-period/
  - Cost: https://insm-iq.org/en/?p=1656 *(snippet)*
- **Audiences and devices:**
  - DataReportal 2026: https://datareportal.com/reports/digital-2026-iraq
  - NapoleonCat: https://napoleoncat.com/stats/social-media-users-in-iraq/
  - StatCounter OS: https://gs.statcounter.com/os-market-share/mobile/iraq
  - StatCounter social: https://gs.statcounter.com/social-media-stats/all/iraq
  - Women in Iraq: https://en.wikipedia.org/wiki/Women_in_Iraq

### Platform surfaces and AI
- **Live Activities and widgets in Expo:**
  - https://expo.dev/blog/ios-widgets-and-live-activities-in-expo
  - https://docs.expo.dev/versions/v55.0.0/sdk/widgets/
  - https://github.com/expo/expo/blob/sdk-57/packages/expo-widgets/CHANGELOG.md
  - https://github.com/software-mansion-labs/expo-live-activity
  - https://www.braze.com/docs/developer_guide/live_notifications/live_activities
  - https://www.freecodecamp.org/news/react-native-live-activities-handbook/
  - https://expo.dev/changelog/sdk-58-beta
  - https://github.com/EvanBacon/expo-apple-targets
- **Android 16 Live Updates:**
  - https://developer.android.com/about/versions/16/features/progress-centric-notifications
  - https://www.androidauthority.com/android-16-qpr1-live-updates-3573399/
  - https://9to5google.com/2025/05/20/android-16-live-updates-demo-maps-uber/
  - https://github.com/software-mansion-labs/expo-live-updates
  - https://github.com/New-Elysium/notifee
- **Android widgets:** https://saleksovski.github.io/react-native-android-widget/docs/tutorial/register-widget-expo
- **Quick actions and intents:**
  - https://raw.githubusercontent.com/EvanBacon/expo-quick-actions/main/README.md
  - https://docs.expo.dev/versions/v58.0.0/sdk/app-intents/
  - https://www.macstories.net/stories/ios-and-ipados-18-the-macstories-review/4/
- **Speech and voice:**
  - Google STT languages: https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages
  - Azure speech languages: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support
  - ElevenLabs Arabic: https://elevenlabs.io/speech-to-text/arabic
  - Arabic ASR leaderboard: https://arxiv.org/pdf/2412.13788
  - NADI 2025: https://aclanthology.org/2025.arabicnlp-sharedtasks.102.pdf
  - Cohere Transcribe Arabic: https://huggingface.co/CohereLabs/cohere-transcribe-arabic-07-2026
  - Omnilingual ASR: https://arxiv.org/abs/2511.09690
  - https://arxiv.org/abs/2601.13802
  - expo-speech-recognition: https://github.com/jamsch/expo-speech-recognition
- **Sharing:**
  - Instagram Stories: https://developers.facebook.com/docs/instagram-platform/sharing-to-stories/
  - react-native-share: https://react-native-share.github.io/react-native-share/docs/share-single
  - Snap Creative Kit: https://developers.snap.com/snap-kit/creative-kit/overview
  - Spotify to WhatsApp Status: https://www.androidcentral.com/apps-software/spotify/android-users-can-now-share-their-favorite-spotify-songs-through-whatsapp-status
  - view-shot blank-capture issue: https://github.com/gre/react-native-view-shot/issues/553
  - Skia snapshots: https://shopify.github.io/react-native-skia/docs/snapshotviews/
- **Haptics and motion:**
  - https://developer.android.com/develop/ui/views/haptics/haptics-principles
  - https://developer.apple.com/design/human-interface-guidelines/playing-haptics
  - https://docs.expo.dev/versions/latest/sdk/haptics/
  - Lottie vs Rive: https://www.callstack.com/blog/lottie-vs-rive-optimizing-mobile-app-animation
  - https://github.com/rive-app/rive-nitro-react-native
  - https://margelo.com/blog/rewriting-rive-react-native-with-nitro-modules
  - expo-av deprecation: https://docs.expo.dev/versions/latest/sdk/av/
- **Low-end Android:** https://developer.android.com/guide/topics/androidgo/best-practices

**Gaps:**
- The session's shared web-search budget ran out near the end. The thinnest areas are: Islamic
  rulings on chance prizes (stated here as cultural knowledge, not cited), Cash App and Revolut copy,
  WhatsApp and Telegram usage figures for Iraq, women's driver preferences, and Iraqi customs around
  new banknotes for Eidiya.
- No public speech-accuracy benchmark exists for Iraqi Arabic. Test before choosing a vendor.

---

## Appendix A. Decisions for Ali and things to check locally

**Money and points decisions [Ali]** (none should be built before he says yes; all are server-side):
1. C1: a `stamp_card` promotion type (merchant-funded).
2. C2: rolling 12-month points expiry from the *last* order.
3. C3: the subscription savings guarantee.
4. C4: a weekly-rhythm bonus instead of the spec's "weekly streaks".
5. C6: rescued-meal money flows.
6. D2: wallet-to-wallet Eidiya.
7. D3 and E4: a commission waiver on charity orders, and "change to charity".
8. D10: per-drop pricing for multi-door orders.
9. E7: zero commission on موكب orders.
10. E9: a courier heat allowance line.
11. E10: an event-triggered "goal treat".
12. G4: deposits for big occasions.

**A local taste panel («مجلس الذوق»).** 5–7 Aziziyah people: two mothers, an elder, a student, a
young man who lives on Snapchat, a restaurant owner, and a religious-calendar adviser trusted across
communities. They:
- set the mourning and celebration days each year;
- review seasonal copy and art;
- veto anything that feels like marketing on a sacred day.

A WhatsApp group and one paid hour a month is enough.

**Check locally before building:**
1. Do Aziziyah's Arbaeen walkers and the 25 Rajab walk to Kadhimiya use the Baghdad road? The
   evidence says Kut's walkers go via Numaniyah. Aziziyah has its own مواكب channel.
2. Which restaurants actually rotate a daily pot?
3. How ماجينة and محيبس are practised in Aziziyah today.
4. Whether women passengers and their families want favourite or known drivers (D6) and family
   watchers (D9) by default. The design is judgement, not sourced.
5. "على حسابي" norms for D1 gifts.
6. Exam dates (June–July) and the shutdown schedule each year.

**Side finding: the customer app ID.** `CLAUDE.md` says the customer app ID is `iq.driver.app`
("confirmed, never change"). `apps/customer/app.json` and `docs/deploy/mobile.md` both use
`iq.driver.customer`. The Play package can never change after the first upload, and the iOS Live
Activity push topic is built from it. Ask Ali which is right before the first store build. Nothing
was changed.
