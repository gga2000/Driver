# Driver customer app, slice 1: First impression + discovery (2026-10-05)

Scope: welcome → phone → OTP → setup (name, first place) → home (header, deliver-to, search bar,
service grid, "قريباً" strip, contextual cards, cuisine chips, restaurant rows, deals rail) → search →
all-restaurants list → coming-soon sheet → bell → tab bar. Guest vs new vs returning user, lunch vs
night. Audit only; nothing in the repo was changed.

**Evidence.** `shots/…` = the shared capture run (390×844 @2x). `extra/…` =
`scratchpad/audit/shots-extra/discovery/`, captured for this slice against the private copy
(:8190 → API :3210): guest welcome/home/full/offline, bell tap, coming-soon sheets, search (empty,
«كباب», «تكه», «باجة», «بيتزا», «بغداد», «تكسي», «فطور»), cuisine chip, all restaurants, guest tabs,
a brand-new signed-in user (0770 401 0001 «أم علي»: phone, setup name, setup place, home), the same
user after `POST /demo/history` (returning, reorder card), the deliver-to picker, and 360×740.

**Methods applied** (skills loaded): onboarding-cro (time-to-value, first 30 seconds, empty
states), signup-flow-cro (field cost, value before commitment, trust microcopy), design-taste
(AI-slop / template test, semantic colour, shape and motion discipline), marketing-psychology
(peak-end, goal-gradient, Fogg B=MAP, social proof only when real, liking/unity, ethical nudges),
design-critique (first impression → usability → hierarchy → consistency → accessibility), Nielsen
0–4, cognitive-load count per decision point, four persona walk-throughs.

**Status of the 2026-10-04 audit items in this slice.** Built and verified live: C-01 search,
C-02 all-restaurants list, C-03 "قريباً" + "خبرني", C-09 one service grid / one contextual card
(food now enters the first fold), C-14 ص/م on الرجعة, C-15 reorder card, C-16 fake favourites gone,
C-17 offline strip + stale note, C-18 guest browse + WhatsApp OTP. **Still open here: C-10**
(monogram letters, one illustration repeated on every dish row), **C-24** (12/13/14/15 px type
scale, `tokens.ts:319-323`), **C-26** (three back styles: circled chevron on phone/OTP, bare arrow on
search/list, native header arrow on the places picker), **C-27** («طعام», `ar-IQ.json:2587`),
**C-43** (generic welcome card). They are referenced below, not re-argued.

---

## 1. Joy score and heuristics

**Joy score for this slice: 5 / 10 now → 8.5 / 10 target.**
It is correct, calm, honest and quick (2 taps from install to a menu as a guest). It is not yet
*loved*: no appetite (zero food imagery anywhere in discovery), no sense of time (the same home at
6 am, 1 pm and 3 am), no surprise, no ending to the sign-up story, and a personality that lives only
in the copy. Nothing on these screens would make a 19-year-old screenshot it.

| # | Heuristic | 0–4 | Evidence in this slice |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Offline strip + "معروض من آخر مرة" (`extra/g-home-offline.png`), skeletons, live proof count on welcome. The active-order pill says only "عندك طلب شغّال · دا يتحضّر": no restaurant, no ETA, no progress. |
| 2 | Match with the real world | 2 | Iraqi copy is excellent, but the app ignores Aziziyah's clock (باچة at dawn, تمن ومرق at noon, late kebab), the الرجعة card always shows بغداد ← العزيزية even to someone sitting at home in Aziziyah, kitchens are letters, «طعام» is MSA. |
| 3 | User control and freedom | 3 | Guest browse, "بعدين" on every setup step, close on sheets. Back styles still differ (C-26). |
| 4 | Consistency and standards | 2 | Filled orange food tile reads as a *selected* toggle, and tapping it scrolls instead of opening; semantic green/blue used as decoration on monograms; «دور» (placeholder) vs «دوّر» (title); placeholder promises «محل» but there are no shops; three back styles; double tick on the places picker. |
| 5 | Error prevention | 3 | Setup "احفظ" is disabled with no reason while the easy path (zone chips) sits below the fold. |
| 6 | Recognition over recall | 3 | Recents, popular chips from the real catalog, reorder card. |
| 7 | Flexibility and efficiency | 2 | The one search box only knows food: «بغداد» and «تكسي» return "ما لگينا" (spec §1 says one bar over everything). Intent words («فطور») return nothing although a breakfast kitchen exists. |
| 8 | Aesthetic and minimalist | 3 | Calm and uncluttered; but imageless, flat type scale (C-24), "قريباً" strip spends first-fold space on things you cannot use. |
| 9 | Error recovery | 3 | Zero results → "شوف كل المطاعم" + chips (good). Night: "ماكو مطاعم هنا هسة" is false (they exist, they are closed) and a dead end. |
| 10 | Help and documentation | 3 | Search hint "نلگيها حتى لو كتبتها «تكه» أو «التكة»" is lovely teaching-in-context. |
| | **Total** | **27 / 40** | Target 34 / 40 |

**Cognitive load per decision point** (tappables visible at once, 390×844, signed in, active order):

| Decision point | Choices | Verdict |
|---|---|---|
| Welcome | 2 (يلا نبدي, عندك حساب) | Ideal |
| Phone / OTP | 1 + back | Ideal |
| Setup place (`shots/app-setup.png`, `extra/s-setup-place-full.png`) | ≈ 22 (4 labels, name field, map, موقعي الحالي, 10 zone chips, كل المناطق, note, photo, احفظ, بعدين) | **Overloaded**; the simplest path is the last one you see |
| Home first fold (`shots/app-home.png`) | ≈ 23 (place, bell, search, 4 services, 3 soon pills, active pill, شوف الكل, 5 chips, 1–2 restaurants, 4 tabs) | Too many *equal-weight* doors; nothing says "start here" |
| Search start (`extra/g-search-empty.png`) | 8 chips + field | Good, but 60 % of the screen is empty |
| All restaurants (`extra/g-restaurants-full.png`) | 3 sorts + 6 filters + 4 rows | Fine; but with 4 kitchens it duplicates home |

**Peak-end.** Sign-up has no peak and a flat end: OTP auto-verifies ("دنتأكد من الرمز…"), two forms,
then the same home a guest sees. Discovery has no peak at all: every screen is a white card on
cream.

**AI-slop / template test.** "If someone said a generator made this, would you believe it?" Home,
search results and the restaurant list: **yes**. Uniform white rounded cards, a single-letter
monogram in a pastel square, a line icon in a white box, a dot-separated meta line, an orange pill
CTA. Welcome: **yes** (six tilted line icons on a tint is a stock onboarding pattern). Not on: the
copy ("شتشتهي اليوم؟", "تمن ومرق", "مقاعد لبغداد والكوت من كراجات العزيزية"), the الرجعة card with a
real count and time. The words are from Aziziyah; the pixels are from anywhere.

### Persona walk-throughs

- **First-timer in Aziziyah** (new to the app): "يلا نبدي" → home in 2 taps (great). Sees four
  letters (ش، خ، ك، م) and has to read every line to learn what they cook. Searches «بيتزا» → zero,
  «بغداد» (wants a seat home) → "ما لگينا «بغداد»" although the الرجعة card is on the home screen
  behind them (`extra/g-search-baghdad.png`). Taps the bell → black toast "ماكو إشعارات".
- **Umm Ali, 1 pm, lunch for six**: taps «تمن ومرق» → 2 restaurants + 4 identical rice-bowl
  drawings (`extra/g-cuisine-chip.png`); nothing says portion size or "يكفي 4". At checkout she signs
  in; on the place step the map fills the screen and the zone chips she could actually use are below
  the fold while "احفظ" stays disabled with no reason (`extra/s-setup-place-top.png`). The phone
  screen never tells her the courier won't see her number, although the app masks it.
- **19-year-old student (Talabat + Instagram daily)**: finds nothing to look at. No photos, no
  "trending in Aziziyah", no late-night mood, no visible points or progress (points exist but live in
  the wallet tab). Opens it at 1 am: two kitchens, same layout as noon. Nothing to share.
- **Older man, large text, cheap Android in sun**: the warmest line ("هلا علي · التوصيل لـ") is 12 px
  muted; "قريباً" pills and restaurant meta are 12 px (C-24). The reorder button is a bare circular
  "refresh" arrow (reads as "reload"). Strong points: big service tiles, 44 px targets, high-contrast
  monograms.

### First 30 seconds: three moments

| Moment | What happens today | What it should feel like |
|---|---|---|
| Brand-new user, 7 pm | Welcome (generic icons, promises خطوط/طرود that aren't live) → guest home with "اختار وين نوصلك", no fees, letters. | "This is *my town's* app": tonight's kitchens, kebab smoke, a seat to Baghdad, my zone asked once with one tap. |
| Returning user at lunch (Umm Ali) | Reorder card for yesterday's تمن وباميا (good), then the same chips and letters as at any hour. | "وقت الغدا، أم علي": her usual one tap away, today's تمن ومرق dishes as pictures, ETA to *her* door in the header. |
| Night, 2:30 am (all four kitchens closed per seed hours: 11:00–00:30, 12:00–00:00, 10:00–02:00, 05:00–15:00) | Header "مفتوح هسة", no chips (they come from open kitchens only, `index.tsx:64`), a sunken card "ماكو مطاعم هنا هسة" + "شوف الكل". | "المطاعم نايمة هسة. أول واحد يفتح: مطعم المسافر الساعة 5 الصبح (باچة)" + "خبرني لمن يفتح". Honest, useful, a reason to come back at dawn. |

---

## 2. The roast

1. The home screen of a *food* app contains zero food. Four Arabic letters in pastel squares are
   doing the job of kebab smoke, and the cuisine row is eight words in grey pills.
2. The app has no clock. Aziziyah eats باچة at dawn, تمن ومرق at noon and kebab at midnight; Driver
   shows the same screen at all three and, at 3 am, tells you "ماكو مطاعم هنا هسة", which is not
   even true.
3. The single search box of a super-app doesn't know the super-app: type «بغداد» and it says it
   found nothing, while the الرجعة card to Baghdad sits one screen behind it.
4. The orange food tile looks *selected*, not *featured*, and tapping it just scrolls the page. The
   grid's lead door is a scroll button in disguise.
5. The bell is decoration. Every tap answers "ماكو إشعارات". A permanently empty inbox teaches
   people to ignore the corner of the screen you'll later need them to read.
6. Welcome sells "خطوط، وطرود" (not live) and never mentions الرجعة, the one product nobody else in
   Iraq has. The first promise the app makes is one it can't keep yet.
7. Sign-up ends on a form and a disabled "احفظ" under a full-screen map; the reward for giving your
   number is the same home a stranger sees. No arrival, no "هلا بيك", no peak.
8. "عندك طلب شغّال · دا يتحضّر" is the most exciting fact in the customer's life right now, and it's
   rendered as a beige banner with no restaurant name, no time and no progress.
9. Colour is used as wallpaper: success-green and info-blue monograms next to a green "عرض" pill and
   an orange star. When everything is tinted, nothing is signalled.
10. A meta line that ends in a floating dot ("4.7 • 30–40 دقيقة •") on the very first restaurant
    card is the kind of detail that tells a designer nobody looked.

---

## 3. Findings

Severity: **P1** hurts conversion, trust or joy · **P2** below best-in-class · **P3** polish.
Effort: **S** < 1 day · **M** 1–3 days · **L** > 3 days. Totals: **27 findings: P1 6 · P2 15 · P3 6.**

| ID | Sev | Screen | Screenshot | Evidence | Why (principle + benchmark) | Recommendation (build-ready) | Effort |
|---|---|---|---|---|---|---|---|
| D-01 | **P1** | Home, search, list | `shots/app-home.png`, `extra/g-search-kebab-full.png`, `extra/g-cuisine-chip.png` | **C-10 still open.** Restaurant rows/cards render `monogram(r.name)` (`RestaurantRow.tsx:44-46`, `RestaurantRail.tsx:60-62`); cuisine chips are text-only (`index.tsx:112-114`); dish results repeat one motif 4× (all kebabs = skewers, all rice = the same bowl). `motifForKitchen()` already exists in `FoodArt.tsx:29` and is unused by the rows. | Food is chosen with the eyes. Swiggy's "What's on your mind?" and Wolt's illustrated categories put dishes, not words, in the first fold; Uber Eats requires hero images. Letters carry zero appetite and read as template (AI-slop test fails). | (1) **Today (S):** swap the monogram for `<FoodArt motif={motifForKitchen(r.tags)} variant="thumb"/>` in `RestaurantRow` and `RestaurantCard`. (2) **Cuisine row → illustrated circles (M):** 64 px round `FoodArt` tiles with the label under (13/600), one motif per tag, `motifForDish` extended with `باچة/پاچة → pacha`, `تمن/مرق/باميا/فاصوليا → rice-and-stew`, `دجاج → chicken`, `ريوگ/كاهي/قيمر → breakfast`. (3) **Dish rows:** vary motif colour per dish (sauce colour from name: باميا green, فاصوليا white, قيمة orange) so 4 bowls never look identical. (4) **Ops (L):** photo day per merchant (already in C-10). | S / M / L |
| D-02 | **P1** | Home (all hours) | `shots/app-home.png` vs code | No time logic anywhere in the app (`grep getHours` finds only FoodArt comments). Home order, chips and copy are identical at 6 am, 1 pm, 1 am. Seed hours make dawn = only المسافر (باچة) open, 1 am = only الشام. | Swiggy/Zomato and Deliveroo reshape the home by daypart (Breakfast, Lunch, Late night). Time-relevance is the cheapest "it knows me" moment (Fogg: the prompt arrives when motivation peaks). | Add `daypart(now)` pure fn (`features/home/daypart.ts`, tested): `dawn 4–11 · lunch 11–16 · asr 16–19 · dinner 19–23 · late 23–4`. It drives (a) the greeting line (§4 idea 1), (b) chip order (kitchen tags: breakfast/pacha first at dawn; rice first at lunch; grill/kebab/shawarma at dinner and late), (c) which kitchens sort first. Copy keys: `home.daypart_dawn` "صباح الخير {name}، فطور؟", `_lunch` "وقت الغدا", `_asr` "شي خفيف للعصر؟", `_dinner` "شنو عشانا اليوم؟", `_late` "سهرانين؟ هذني فاتحين لهسة". Only real kitchens/tags, never invented dishes. | M |
| D-03 | **P1** | Home at night | code `index.tsx:63-64, 132-139`; `ar-IQ.json:2597` | When no kitchen is open: chips disappear (built from open kitchens only), "شوف الكل" leaves the header, and a sunken card says "ماكو مطاعم هنا هسة" (false: they exist) + a secondary button. | Dead end at the exact hour people are bored and hungry. Error recovery + honesty. Talabat shows "Opens at 10:00 · Schedule". | Replace with a "نايمين هسة" card: first kitchen to open + its signature dish art + time, and a real action. Copy: title "المطاعم مسدودة هسة", body "أول واحد يفتح: {name} الساعة {time} ({dish})", buttons "خبرني لمن يفتح" (stores interest via `notify.launchInterest`-style endpoint per merchant; push at open) and "شوف المنيو هسة". Keep cuisine chips (from *all* kitchens, muted). Keep the section title "مفتوح هسة" only when ≥ 1 open; otherwise "يفتحون الصبح". | M |
| D-04 | **P1** | Search (super-app) | `extra/g-search-baghdad.png`, `extra/g-search-taxi.png` | `search.tsx:42` calls only `useCatalogSearch`; «بغداد» → "ما لگينا «بغداد»"; «تكسي» → nothing. Spec §1: "One search bar over everything (dishes, restaurants, «تكسي للكوت», «بغداد», a person's name)". | A super-app's search is its command line (Careem, Grab, Google Maps). Recognition beats navigation; a zero result for the product sitting on the home screen breaks trust in search for good. | Add a client-side "services" result group above restaurants, matched on folded text: `{بغداد، الكوت، كراج، رجعة، سفر}` → الرجعة card (live: "الرجعة لبغداد: 4 سيارات هسة، أقربها 6:38 م" + "شوف السيارات"); `{تكسي، تاكسي، سيارة}` / `{تكتك، توكتوك}` → ride row "تكسي من {place}" → `startRide()`; zone and landmark names (`aziziyah-zones.ts`, `aziziyah-landmarks.ts`) → "تكسي لـ {zone}" with destination prefilled; `{سوق، خضرة، طرد، خط، مدرسة}` → the coming-soon sheet. Placeholder becomes "دوّر على أكلة، مطعم، أو وين رايح". | M |
| D-05 | **P1** | Setup step 2 (first place) | `extra/s-setup-place-top.png`, `shots/app-setup.png`, `extra/s-setup-place-full.png` | `PlaceEditor.tsx:123` draws the map first; the zone chips (`:137-145`, the "صعبة الخريطة؟" fallback) and "موقعي الحالي" sit below a full-height map with a hexagon overlay. "احفظ" is disabled with no explanation. | Activation: the place is required to order, and maps are the hardest UI for low-literacy or older users. Progressive disclosure: easiest input first (Talabat asks area first, then pin). Disabled CTAs without reasons cause abandonment (signup CRO). | Reorder to: (1) "موقعي الحالي" as a full-width secondary button; (2) "بأي منطقة بيتك؟" 8 zone chips + "كل المناطق"; (3) map auto-zooms to the chosen zone with the pin pre-dropped: "دوس على بيتك بالضبط حتى الدليفري يلگاه أسرع (اختياري)"; (4) note + gate photo collapsed under "علامة للدليفري". Enable "احفظ" once a zone is chosen; when disabled show a hint "اختار منطقتك أول". Hide zone hexes on this map (keep the outline of the chosen zone only). | M |
| D-06 | **P1** | Welcome | `shots/app-welcome.png`, `extra/s360-g-welcome.png` | **C-43 still open** (six tilted line icons on a tint). Body copy (`ar-IQ.json:68`) "أكل، تكسي، خطوط، وطرود… كلها بتطبيق واحد بالعزيزية." promises two services that are "قريباً" and omits الرجعة; icons include cart and parcel (not live). | First promise = first trust test. Lead with what's live and unique (الرجعة has no Iraqi equivalent). Careem shows only services live in your city. | Copy: "أكل من مطاعم العزيزية، تكسي وتكتك، ومقعد لبغداد والكوت. كلها بتطبيق واحد." Proof line adds real الرجعة data: "هسة: 4 مطاعم مفتوحة · 3 سيارات طالعة لبغداد" (only when count > 0; from `routes.board`, public). Replace the icon card with idea §4-5 (living map of Aziziyah) or at minimum 4 live-service illustrations, no cart/parcel. Add a quiet "English" link (C-43). | S (copy) / M (art) |
| D-07 | P2 | Home bell | `extra/g-bell-toast.png` | `HomeHeader.tsx:43` the bell only fires `toast.show('ماكو إشعارات')`, for guests too. | A permanently empty affordance trains people to ignore it (learned irrelevance). Talabat/Uber put an inbox there or nothing. | Either (a) **remove** the bell and put a **points chip** in that slot ("1,250 نقطة" → wallet; hidden at 0), or (b) build a real inbox from events already pushed (order states, الرجعة boarding at T−30, "خبرني" launches, points earned, honest-delay credits) with an unread dot. Recommend (a) now, (b) when ≥ 3 event types are stored. Guests: no bell. | S / M |
| D-08 | P2 | Home active-order pill | `shots/app-home.png`, `shots/rajaa-home.png` | `ActiveOrderPill.tsx:28-29`: title "عندك طلب شغّال" + status pill only. No restaurant, no ETA, no stage progress; occupies a full-width tinted card. | The order in flight is the most emotionally loaded object on the screen (anticipation). Uber Eats and Talabat show restaurant + ETA + a segmented progress bar on home. | Title: "{restaurant} · يوصلك تقريباً {clock}" (from `orders.track` ETA; fall back to status). Under it a 4-segment bar (قبل · يتحضّر · بالطريق · وصل) with the live segment shimmering (1.6 s loop, off under reduce motion). Rides: "{driver} بالطريق إلك · {n} دقايق". Tap target unchanged. | S |
| D-09 | P2 | Home الرجعة card | `extra/s-home-newuser.png`, `extra/g-home-full.png` | `RajaaCard.tsx:20` defaults to `routeLabel(t,'baghdad','to_aziziyah')` for everyone; a person whose saved place is in Aziziyah sees "بغداد ← العزيزية · كراج النهضة". | Match the real world: someone at home in Aziziyah wants *to go*; someone in Baghdad wants *to come back*. Context-aware cards are Careem's core super-app pattern. | Direction from context: deliver-to place in Aziziyah (or device geofence) → "العزيزية ← بغداد" from the nearest Aziziyah garage; device in Baghdad → the return. Morning (before 12) bias to outbound. Show the next departure as a big time: "أقربها 7:15 الصبح من البوابة ١". | S |
| D-10 | P2 | Home service grid | `shots/app-home.png` | `ServicesRow.tsx:56-68`: first tile filled accent, others outline, so the grid reads as a segmented control with food *selected*; `index.tsx:69` food tap only `scrollTo` the list. | Consistency: filled = selected everywhere else in the app (chips, segments). A door that scrolls is a surprise (Careem/Grab tiles always open a vertical). | Give all four tiles the same treatment (tinted backgrounds per service, illustrated icon, §4-5), mark food as lead with size or position only. Food tap opens `/restaurants` (or a food landing with the daypart rail); keep the inline list on home. | S / M |
| D-11 | P2 | Rows and cards | `shots/app-home.png`, `extra/g-restaurants-full.png` | `RestaurantRail.tsx:27-32` maps decorative tiles to `successTint/infoTint/warningTint`; a green "عرض" pill sits next to a green خ; orange stars + orange monogram. | Semantic colour is a signal budget (design-taste colour lock). Green should mean "good/done", not "this restaurant's name starts with خ". | Decorative art uses one warm family (`accentTint`, `surfaceSunken`) or food art (D-01). Reserve success/info/warning for state. | S |
| D-12 | P2 | Restaurant meta line | `shots/app-home.png`, `extra/s-home-returning-full.png` | `RestaurantRow.tsx:59-77`: rating · time · fee in one `flexWrap` row; at 390 px the fee wraps and leaves an orphan dot: "4.7 • 30–40 دقيقة •" then "توصيل 500 دينار" alone. | Visual polish signals care; broken separators read as a bug in the first card a user sees. | Two fixed lines, no wrap: line 1 "★ 4.7 · 30–40 دقيقة", line 2 fee ("توصيل 500 دينار" / "توصيل مجاني" in success). Never render a dot at a line end. | S |
| D-13 | P2 | Search: intent words and zero results | `extra/g-search-breakfast.png`, `extra/g-search-none.png` | «فطور» → zero although مطعم المسافر is tagged `breakfast`/`pacha` (`food/list.ts:20`). Zero results offer only "شوف كل المطاعم" + chips; nothing is learned from the miss. | Flexibility (heuristic 7). Unmet searches are the best free demand data a 4-restaurant town has (what to recruit next). Ethical: ask, don't fake. | (1) Map intent words to tags before the API call: «فطور، ريوگ» → breakfast/pacha, «غدا» → rice, «عشا» → grill/shawarma, «مشروب، عصير» → drink dishes, «حلو، حلويات» → dessert tag (when one exists). (2) Zero-result card adds: "ما عدنا «{q}» بعد. نگول للمطاعم إن أكو ناس تريدها؟" button "إي گولولهم" → logs `search.unmet` (term, zone) for the Console; confirmation "وصلت. إذا مطعم ضافها نخبرك" (only if the notify hook is built; otherwise "شكراً، سجّلناها"). | S / M |
| D-14 | P2 | Phone entry | `shots/app-phone.png`, `extra/s-phone.png` | Hint is "نرسلك رمز تأكيد برسالة" (`ar-IQ.json:71`); 80 % of the screen is empty; no word about privacy although numbers are masked in chat and calls. | Signup CRO: remove uncertainty at the moment of commitment. For Iraqi women ordering, "who sees my number" is the #1 hesitation. | Hint: "نرسلك رمز برسالة. رقمك يبقى مخفي عن الدليفري والسايق، المكالمات تمر من خلالنا." Add a small trust row under the field (shield icon, footnote). Keep the contextual hints for order/book (good). | S |
| D-15 | P2 | End of sign-up | `shots/app-otp.png` → `extra/s-home-newuser.png` | After OTP → name → place, the guard drops the user on the standard home; no confirmation, no success haptic, no personal touch (`setup.tsx:64`). | Peak-end rule: the end of onboarding is remembered. Duolingo, Airbnb and Careem all mark "you're in". | One 1.4 s "arrival" moment on first home render after setup (see §4-5): success haptic, the greeting animates in, a one-time card "هلا بيك {name}. هذا حيّك: {zone}. أقرب مطعم يوصلك بـ {eta} دقيقة." dismiss "يلا". Shown once (`profile.welcomedHome`). | S |
| D-16 | P2 | Guest home deliver-to | `extra/g-home-full.png` | Guest sees "اختار وين نوصلك" and rows with prep time but no delivery fee; tapping opens the full places page. | Value before commitment is done (C-18); the next step is *specific* value: real fee and time to *my* street without an account. | Under the search bar, guests get a one-line inline picker: "انت بأي منطقة؟" + 4 top zone chips + "غيرها". Choosing one stores a device-only zone, shows real fees/ETAs, and pre-fills the setup zone later (IKEA/commitment effect). | M |
| D-17 | P2 | Deliver-to picker | `extra/s-places-from-home.png` | Full-page stack with a native header (**C-26 still open**) and a **double tick** on the selected place: `places/index.tsx:26-27` passes `trailing={<Icon check/>}` while `ListRow.tsx:80` already draws a check when `selected`. | Address switching is a quick, reversible choice; Talabat/Uber Eats use a bottom sheet. The double tick is a visible bug. | Drop the `trailing` icon (S). Move the picker into a `ModalSheet` from the header with saved places + "موقعي الحالي" + "ضيف مكان" (M). | S / M |
| D-18 | P2 | Type hierarchy | `shots/app-home.png` | **C-24 still open**: greeting/caption 12, footnote 13, label 14, body 15 (`tokens.ts:319-323`). The warmest line, "هلا علي", is the smallest text on screen (`HomeHeader.tsx:32-34`). | Arabic needs +1–2 px over Latin; a flat scale makes every line equal and the screen feel administrative. | Apply C-24's 13/16/18/22/30 scale. Header: greeting at title 18/700 ("هلا علي" or the daypart line), deliver-to at 15/600 with the pin; drop the dangling "· التوصيل لـ". | M |
| D-19 | P2 | Home template feel | `shots/app-home.png`, `extra/g-home-full.png` | Service icons are 1.8 px line glyphs in white boxes (`ServicesRow.tsx:68`); every section is the same white rounded card with the same shadow. | Distinctiveness. Airbnb's May 2025 redesign and Careem's tiles use dimensional, coloured service art; the app currently passes the AI-slop test as "generated". | Commission 4 live + 3 soon service illustrations (dimensional, warm palette, the Iraqi red tuktuk, the orange-and-white Baghdad taxi, a garage arch with a GMC/Starex) and give each tile a tinted ground. See §4-5 for motion. | M (art) |
| D-20 | P2 | Coming-soon strip placement | `shots/app-home.png` | `ServicesRow.tsx:77-104`: the "قريباً سوق · خطوط · طرود" row sits between the live services and the food, inside the first fold. | Hick: things you can't use compete with things you can. Demand capture still works lower down. | Move the strip below the restaurant list as a titled row "جاي بالطريق" with the same three pills, or fold it into a 5th "المزيد" tile that opens a sheet listing the three. Keep the "خبرني" sheet as is. | S |
| D-21 | P2 | Home habit loop | code `ar-IQ` `home.points_banner` unused | Points exist (wallet, earned per order), but nothing on home shows progress or a reason to return. | Goal-gradient and endowment: visible progress drives repeat. Talabat Pro, Careem Plus and Uber One all surface savings on home. Real numbers only. | Points chip in the header slot (D-07): "1,250 نقطة = 12,500 دينار" (existing key). After an order: a 1.2 s count-up on the chip (reuse `PointsEarned` coin). No streaks or timers that pressure (ethics). **Needs Ali** only if any new reward rule is added; displaying existing points does not change money rules. | S |
| D-22 | P3 | Reorder card | `extra/s-home-returning-full.png` | `ReorderCard.tsx:38` uses a `refresh` icon button with no label. | The circular arrow means "reload" on Android; the action is "order this again". Uber Eats/DoorDash label it. | Replace with a labelled tonal button "اطلبه" (bag icon) 44 px, keep the whole card tappable. When ≥ 2 eligible past orders, show a horizontal "اطلب نفس الطلب" shelf of up to 3 (Uber Eats "Order again"). | S |
| D-23 | P3 | Search field and copy | `shots/app-home.png`, `extra/g-search-empty.png` | Home field has a dark 1.5 px outline (reads focused) and placeholder "دور: مطعم، أكلة، محل…" (`ar-IQ.json:128`): «دور» without shadda vs title «دوّر», and «محل» although there are no shops yet. | Consistency and honest affordance. Wolt/Uber use a filled field without a border. | Filled `surfaceSunken`, no border, 48 px, border only on focus. Placeholder "دوّر على أكلة أو مطعم" (or D-04's version once universal). | S |
| D-24 | P3 | Search start | `extra/g-search-empty.png` | Below the 8 popular chips the screen is empty. | Empty states are onboarding real estate (onboarding-cro). | Add "فتحتها قبل" (last 3 restaurants viewed, local) and a daypart row "للغدا اليوم" with 4 dish thumbnails from open kitchens. | S |
| D-25 | P3 | All restaurants | `extra/g-restaurants-full.png` | Default sort "الأقرب" for a guest with no place; no distance shown anywhere; with 4 kitchens the list repeats home. | Sort labels should mean something; small catalogs need personality more than filters. | Default to "مفتوح هسة" first, then الأسرع when no place. Show "1.2 كم" under the time when a place exists. Add a one-line header for a small town: "4 مطاعم بالعزيزية، كلهم نعرفهم" linking to §4-3. | S |
| D-26 | P3 | Coming-soon sheet | `extra/g-soon-khat.png`, `extra/g-soon-grocery.png` | "نبلشها قريب" with no timeframe; no sense others want it too. | Social proof works when real; vagueness lowers belief. "ما نبعث شي ثاني" is great, keep. | Add a season when Ali commits one ("نبلشها هذا الشتا"), and a real count once ≥ 25: "سجّل {n} من أهل العزيزية". Never a fake or rounded-up number. | S |
| D-27 | P3 | Tab bar and naming | `shots/app-home.png` | Tabs "طلباتي · المحفظة · حسابي" mix possessive and non-possessive; service tile «طعام» (**C-27 still open**). Offline strip uses an em-dash "النت مقطوع — نحاول نرجع…" (`ar-IQ.json:1270`). | Voice consistency (voice spec). | "محفظتي" (key `nav.wallet` already exists); «أكل»; "النت مقطوع. نحاول نرجع…" and "ما نگدر نوصل لدرايفر. نحاول كل 5 ثواني". | S |

---

## 4. Signature upgrades

### 4-1. "وقت العزيزية": a home that knows what time it is in town
**What.** The top of home changes with the day: a daypart band under the search (title + a 3-tile
dish row) and the greeting line. Dawn: "صباح الخير أم علي · فطور؟" with باچة, كاهي وقيمر, چاي from
the kitchens actually open. Noon: "وقت الغدا" with تمن ومرق dishes. Evening: "شنو عشانا اليوم؟"
kebab/tikka/shawarma. Late: "سهرانين؟ هذني فاتحين لحد الساعة 2". All closed: D-03's "نايمين"
card with the first opener and "خبرني لمن يفتح". Friday noon: "غدا الجمعة للعائلة" with large
platters (from dish names with «وجبة/كيلو/عائلية»). Ramadan (when Ali enables it): an iftar
countdown to the Maghrib time and a suhoor band after 1 am.
**Why it delights.** Relevance feels like being known (Fogg: prompt at peak motivation); the town's
rhythm is mirrored back (unity/liking). It also turns night from a dead end into a reason to open
the app at dawn.
**Build.** `features/home/daypart.ts` (pure, injected clock, unit tests for each boundary and the
Friday/Ramadan flags) → `{ key, titleKey, tags[] }`. `DaypartBand` component: title (title 18/700),
3 `DishTile`s (FoodArt 96×96 or photo, name, price, kitchen) from `catalog.restaurants` filtered by
open + tags; tap opens the dish sheet on its restaurant. Band background is a soft token gradient
per daypart (dawn `accentTint→bg`, night `surfaceSunken→bg`), crossfade 400 ms on change;
static under reduce motion. No haptics. Data already exists: kitchen tags and hours.
**Benchmark.** Swiggy and Zomato daypart collections, Deliveroo "Breakfast", Talabat "Late night".
**Effort.** M. **Risk.** Wrong dish assumptions: only show dishes that match real tags/names; hide
the band when < 2 dishes qualify.

### 4-2. "شنو بخاطرك؟": an appetite layer made from what you already have
**What.** Replace the text cuisine chips with a horizontal row of round illustrated dishes (64 px
circles: skewers, rice-and-stew, shawarma spit, falafel, باچة pot, bread/كاهي, tea istikan,
chicken), and give every restaurant a cover: a 16:7 FoodArt composition of its top three dishes
(or photos when uploaded), the name below, rating and time on one line.
**Why it delights.** Pictures trigger appetite before reading (dual-coding); variety across the row
reads as abundance even with four kitchens. Kids and older users recognise a skewer faster than the
word «تكة».
**Build.** Extend `FoodArt` motifs (`pacha`, `stew`, `chicken`, `kahi`); `CuisineCircle` in
`@driver/ui` (64 px art, 13/600 label, 44 px min target, press-scale 0.96 + selection haptic, both
already in `motion.ts`). `RestaurantCover`: three motifs overlapped on the restaurant's tint,
deterministic by top-3 dish names (no randomness). On first mount the steam on hot motifs drifts
once (opacity 0→0.6→0, translateY −6, 1.2 s), never loops; off under reduce motion.
**Benchmark.** Swiggy "What's on your mind?", Wolt illustrated categories, Uber Eats category tiles.
**Effort.** M (illustration + components); photos L (ops). **Risk.** Illustration quality: one
illustrator, one style sheet, reviewed by Ali on the web studio at 360 px.

### 4-3. "مطاعمنا": meet the kitchens
**What.** Four restaurants is a weakness in a list and a strength in a story. Each kitchen gets a
face: the owner's photo and first name, a one-liner in his own words, and "معروف بـ" (the top dish
by real order count): "خالد · الكباب على الفحم من 2009 · معروف بـ: لفة تكة". On first launch (and
in the all-restaurants header), a swipeable four-card "تعرّف على مطاعم العزيزية".
**Why it delights.** Liking and unity: people order from Khalid, not from "مطعم خالد". Authority
from real popularity ("معروف بـ") is honest social proof. Local pride travels by word of mouth in a
small town.
**Build.** Merchant app field `story` (60 chars) + `ownerPhoto` (consent checkbox, Console
approval). API: `catalog.restaurants` adds `story`, `ownerFirstName`, `ownerPhotoUrl`,
`knownFor` (server-computed from 30-day order lines; hidden below 20 orders). `KitchenStoryCard`
(photo 56 px round, name, story 15/400, "معروف بـ" pill). Card swipe uses `ScrollView` paging with
snap; light haptic on snap.
**Benchmark.** Airbnb host profiles, Uber Eats "Local legends", Toters local favourites.
**Effort.** M. **Risk.** Merchant consent and content quality: ops writes the first versions with
each owner; never fabricate a story or a count.

### 4-4. One box for the whole town
**What.** The search bar becomes the app's command line: «بغداد» → a الرجعة card with the next car
and "احجز"; «تكسي للسوق» → the ride sheet with the destination filled; «شارع 30» → "تكسي لشارع 30"
and kitchens that deliver there fast; «فطور» → breakfast dishes; «بيتزا» → "ما عدنا بيتزا بعد"
with "نگول للمطاعم؟". Recents keep the type ("الرجعة لبغداد" with the garage icon).
**Why it delights.** Recognition over navigation; one gesture for everything feels like magic
(Careem's universal search, Google Maps). The unmet-demand log tells Ali which kitchen to recruit
next.
**Build.** `features/search/intents.ts` (pure, tested): folded-text matcher over service keywords,
zones, landmarks and intent words → typed results (`rajaa`, `ride`, `soon`, `tag`). Rendered as a
"خدمات" group above restaurants with a distinct row style (service tint + icon). `search.unmet`
mutation (term, zone, signed-in or not, no PII). Debounce unchanged (`SEARCH_DEBOUNCE_MS`).
**Benchmark.** Careem, Grab, Google Maps "search everything".
**Effort.** M. **Risk.** False positives (a dish called «بغدادي»): services group shows only on
whole-word matches and above food only when the term is a service word.

### 4-5. "هلا بيك بحيّك": a first run with a peak, and tiles that are alive
**What.** Two moments. (a) **Arrival**: after setup (and on a guest's first zone choice), a 1.4 s
scene: a small stylised Aziziyah map (Tigris curve, the three garages, the market), a pin drops on
the person's zone, the greeting writes itself "هلا بيك أم علي، هذا حيّك: شارع 30", then the card
settles into "أقرب مطعم يوصلك بـ 25 دقيقة" + "يلا". (b) **Living service tiles**: dimensional
illustrations with a one-shot animation on tap: the bag's steam puffs, the taxi's headlights blink,
the tuktuk bounces on its springs, the garage door rolls up; 500–600 ms, then navigation.
**Why it delights.** Peak-end: onboarding ends on a high, personal note. Micro-delight on the most
tapped controls rewards every visit (variable but never noisy). The map makes it unmistakably
Aziziyah.
**Build.** (a) `ArrivalScene`: react-native-svg map (single file, tokens only), Reanimated
`withSpring` pin drop (damping 14, ~450 ms), text reveal by opacity per word (60 ms stagger),
`Haptics.notificationAsync(Success)` when the pin lands; shown once (`profile.welcomedHome`);
static frame under reduce motion; skip on tap. (b) Tiles: Lottie (`lottie-react-native`, install via
`npx expo install`) or Reanimated SVG parts; play on `onPressIn`, navigate on `onPress`; respect
reduce motion and a lite mode on low-end devices (static PNG).
**Benchmark.** Airbnb May 2025 "Lava" dimensional animated icons; Duolingo's first-lesson
celebration; Careem's illustrated service tiles.
**Effort.** M (art + motion). **Risk.** Low-end Android jank: preload, cap at one animation at a
time, measure ≥ 50 fps on a Samsung A-series before shipping.

---

## 5. Keep list (do not lose these)

1. **Guest browse in 2 taps** ("يلا نبدي" → home) and contextual sign-in reasons
   ("بقت خطوة: رقمك حتى نكمّل طلبك ويتصل بيك الدليفري").
2. **The live proof line** on welcome ("هسة: 4 مطاعم مفتوحة"): real data, the right kind of social
   proof. Extend it, don't decorate it.
3. **Search that forgives**: Arabic folding plus the hint "نلگيها حتى لو كتبتها «تكه» أو «التكة»",
   popular terms from the real catalog, recents, honest zero results with a way out.
4. **"خبرني لمن تنفتح"** with "نبعثلك إشعار بنفس اليوم. ما نبعث شي ثاني.": respectful permission
   copy; turns dead tiles into demand data.
5. **One door per service and one contextual card** (`context.ts`): the right restraint; keep it as
   the daypart band arrives.
6. **The الرجعة card with a real count and ص/م time** ("4 سيارات هسة، أقربها الساعة 6:38 م").
7. **Offline honesty**: the red/green strip and "معروض من آخر مرة · قبل لحظات".
8. **Guest tab cards that sell, not block** ("باقي الكاش يصير رصيد، وكل طلب يجيبلك نقاط").
9. **Setup that never traps**: "بعدين" on both steps, "الاسم يشوفه الدليفري والسايق بس".
10. **WhatsApp OTP fallback** and the 30 s resend timer.
11. **Press-scale + selection haptics** on tiles, chips and cards; closed kitchens still browsable
    with "يفتح الساعة".

---

## 6. Ideal home, first fold (390×844, signed in, 1 pm, order in flight)

```
┌────────────────────────────────────────────┐  status bar 44
│ (1,250 نقطة)                 وقت الغدا، أم علي │  title 18/700 + points chip (replaces bell)
│                   ▾ البيت · شارع 30 · 25 دقيقة 📍 │  15/600, ETA to her door
│ ┌────────────────────────────────────────┐ │
│ │ 🔍  دوّر على أكلة، مطعم، أو وين رايح      │ │  48 px, filled, no border
│ └────────────────────────────────────────┘ │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │  dimensional tiles 76 px,
│ │ [bag]  │ │ [taxi] │ │[tuktuk]│ │[garage]│ │  tinted grounds, one-shot
│ │  أكل   │ │  تكسي  │ │  تكتك  │ │ الرجعة │ │  animation on tap
│ └────────┘ └────────┘ └────────┘ └────────┘ │
│ ╭────────────────────────────────────────╮ │  only while an order is live
│ │ مطعم خالد · يوصلك تقريباً 1:42 م      ›  │ │
│ │ ▰▰▰▱  دا يتحضّر                         │ │  4-segment live bar
│ ╰────────────────────────────────────────╯ │
│ وقت الغدا                                   │  daypart band (title 18/700)
│  (◯تمن ومرق) (◯كباب) (◯تكة) (◯شاورما) (◯…) →│  64 px illustrated circles
│ ┌────────────────────────────────────────┐ │
│ │ [cover: rice + stew + salad art, 16:7] │ │  first kitchen with a cover
│ │ مشويات الحاج كريم            ★ 4.8      │ │
│ │ معروف بـ: تمن وباميا · 25–35 دقيقة       │ │
├────────────────────────────────────────────┤
│  الرئيسية     طلباتي     محفظتي     حسابي    │  tab bar
└────────────────────────────────────────────┘
```

Below the fold, in order: the rest of "مفتوح هسة" (two-line meta, no orphan dots), "اطلب نفس
الطلب" shelf (when no order is live it moves above the daypart band), "مطاعمنا" story cards,
deals rail (only when real deals exist), then "جاي بالطريق: سوق · خطوط · طرود".
At 2:30 am the band reads "المطاعم مسدودة هسة · أول واحد يفتح: مطعم المسافر الساعة 5 الصبح (باچة)"
with "خبرني لمن يفتح".

---

### Notes for Ali (decisions, not code)

- Any first-order or night-time offer would be a money rule: **needs Ali**. Nothing above requires
  one; every idea uses real data that already exists.
- The owner stories (§4-3) need each merchant's consent and a photo session; ops can bundle it
  with the C-10 photo day.
- Daypart copy and a Ramadan mode should get a two-minute read from Ali for tone.

Sources consulted for benchmarks: [Wolt app redesign (press)](https://press.wolt.com/en-WW/259591-wolt-redesigns-app-to-power-local-commerce-growth/),
[Wolt icon system](https://careers.wolt.com/en/blog/tech/wolt-icon-system-redesign),
[Airbnb 2025 "Lava" animated icons](https://medium.com/@waldobear002/airbnbs-new-lava-icon-format-a-technical-deep-dive-b2604626c7e0),
[Careem super-app home by location](https://kr-asia.com/careem-launches-super-app-to-provide-all-of-its-services-in-one-place),
[Swiggy/Zomato time-aware personalisation](https://www.psychologs.com/how-swiggy-zomato-know-exactly-when-youre-hungry/),
[Uber Eats reorder](https://help.uber.com/en/ubereats/restaurants/article/how-can-i-reorder-food-that-ive-ordered-before?nodeId=012e1e38-acdf-4022-989c-4d3921999e21).
