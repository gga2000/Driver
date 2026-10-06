# UI/UX audit: Driver Merchant and Driver Console (2026-10-04)

Audit only: no product code was changed. Scope is `apps/merchant` (the restaurant tablet at 1280×800 with
the right rail, and the 390×844 phone) and `apps/console` (map, dispatch, orders, drivers, controls,
approvals, support, finance/nightly cash, wall, pricing, system) at 1440×900 and 1280×720, plus the wall
at 1920×1080.

Benchmarks: Uber Eats Orders tablet, DoorDash Merchant tablet, Deliverect, Toast/Square KDS, Talabat
partner portal for the Merchant app. Uber/Bolt ops tools, Onfleet, Bringg, Linear/Retool-grade internal
tools, Zendesk/Intercom for support and the Stripe dashboard for finance for the Console.

The users this was judged for: a busy Aziziyah kitchen (noise, greasy hands, a glance from 2 m away,
staff with mixed literacy, cash economy), and a small team of dispatchers on shift 10:00–24:00 in
launch week.

## Contents

1. How this was done
2. Summary
3. Scorecards (Merchant, Console, Nielsen heuristics, cognitive load)
4. Already world class: keep
5. Findings: Merchant (M-01 … M-27)
6. Findings: Console (K-01 … K-23)
7. Persona walk-throughs
8. Signature moments (build-ready)
9. Top 12 "do next" for each tool
10. Appendix: contrast, palette validation, screenshot index

---

## 1. How this was done

- **Skills applied:** `design:design-critique` (first impression, usability, hierarchy, consistency,
  accessibility), `anthropic-skills:critique` (Nielsen scoring 0–4, cognitive-load checklist, personas,
  P0–P3 severity), `frontend-design` (identity and "templated default" check), `dataviz` (form heuristic,
  colour roles and the palette validator `validate_palette.js`), `design:ux-copy` (CTAs, errors, empty
  states, Iraqi voice) and `design:design-handoff` (tokens, states, motion and accessibility for the
  signature moments).
- **Capture:** Merchant web export against its demo API on port 3503 (`scripts/web-shots.mjs`, every
  shot list, tablet and phone), plus an audit-only shot list for the states the repo lists do not
  cover: the push pre-prompt over a ringing board, the sound still locked, a rush of 8 new orders (real
  `orders.place` calls as customers), a long note, partial accept waiting, the alarm on another screen,
  the 90-second timeout, the store closed, offline, the API down, an empty second store and a first
  day with no data. Console: Next production build against its demo API on port 3504, every page at
  both laptop sizes, full-page twins, the override dialog, the kill-switch dialog, approvals detail,
  loading/error by intercepting tRPC, signed out, and the field-ops and support roles.
- **Code read** for sounds and alarms (`features/board/alarm.ts`, `lib/alert-sound.ts`,
  `features/runtime/MerchantRuntime.tsx`, console `dispatch-page.tsx useAlertSound`), keyboard handling
  (console: only Escape on drawers and the photo zoom), live updates (merchant SSE + 5 s board poll +
  30 s heartbeat; console 2–30 s polling), focus handling (console `:focus-visible` ring, drawers take
  focus), and copy in `apps/merchant/locales/ar.json` and `packages/i18n/src/locales/ar-IQ.json`.
- **Automated detector** (`npx impeccable --json` on both apps' sources): 0 findings. It targets web
  CSS and markup patterns; React Native inline styles and Tailwind class strings are mostly invisible
  to it, so treat this as no signal rather than a clean bill.
- **Caveats.** The sandbox has no map tiles, so the Console map shows zones and markers on a blank
  canvas; a store's empty weekly hours are a demo setting (open all day); the Khalid cash balance is
  negative because of the demo's money history. Where a finding could be demo data it says so, and the
  recommendation is about how the UI should present that state, which is real.

Screenshot paths in the tables are relative to the session scratchpad
`/tmp/claude-0/-home-claude-driver/9e36f95e-a04f-5dd2-b358-67d18250f0e3/scratchpad/audit/`:
`m/base/` = `merchant/base/`, `m/states/` = `merchant/states/`, `c/` = `console/`.

---

## 2. Summary

**Merchant: 6.4 / 10 now, target 9.** It already looks and reads like a kitchen tool: a huge ticket
number, a 90-second ring, notes in bold on a warm strip, items grouped by person, an accept sheet with
big prep-time tiles, reject reasons that nudge to a better move, a photo-to-menu import and a dispute
screen with the timeline and the default outcome. What stands between it and Uber Eats / DoorDash
tablet quality is the part a kitchen notices only when it fails: **the alarm.** A silenced order never
rings again and then disappears at 90 s without a trace; the push pre-prompt opens over a ringing
board; the browser can be silent (sound locked, tablet asleep) and the board only admits it once an
order is already ringing; offline takes up to 30 s to show and an API outage at shift start leaves the
logo on screen forever. In a rush the tablet shows one ticket per column, so 7 of 8 waiting orders are
below the fold with their timers running. Money is honest in the Money tab but scary and unexplained in
the header when the balance is negative.

**Console: 5.0 / 10 now, target 9.** The launch-week control room is strong: kill switches with a
required reason and a customer-message preview, zone caps, the approvals master/detail with quick
reject reasons, the "الدفتر متوازن" banner and the numbered 23:00 cash round, and a wall that reads
from across the room. The operational core is weak: **people, shops and orders are raw IDs**
(`p_103`, `org_7`, `ci_57`, `ord_969`), so a dispatcher cannot tell who حيدر is, and a support agent
cannot match the "#1284" the kitchen and customer use. The dispatch queue starts two-thirds down the
page under 13 tiles and 8 policy cards, "يحتاج موزّع" is the last column, manual assignment means
choosing a driver ID from an empty combobox, alerts beep only on /dispatch and only if switched on,
there are no keyboard shortcuts, and when the API drops the page shows English "Failed to fetch" with
zeroed tiles under a green "live" dot.

---

## 3. Scorecards

### 3.1 Merchant (0–10)

| # | Dimension | Now | Target | Why the score |
|---|---|---|---|---|
| 1 | 2-metre glanceability | 6 | 9 | 34 px ticket number, ring and amber "new" column read from across the counter; item lines at 16 px don't, and in a rush only one ticket per column is visible (M-05). |
| 2 | Order-card hierarchy | 7 | 9 | Number → age/items/people → payment → items by person → notes is right. The order note mixes delivery and kitchen instructions, allergies are not flagged, "5 صنف" (M-09, M-21). |
| 3 | Alarm design (escalate, silence, never miss) | 4 | 9 | Fixed 4 s chime, no escalation, silence is permanent, misses vanish, the pre-prompt covers the alarm, no wake lock, sound lock found late (M-01…M-04). |
| 4 | Accept / prep-time speed | 7 | 9 | 2 taps with an honest default; no one-tap accept and no "+5 د" after accepting (M-12). |
| 5 | Error prevention | 7 | 9 | Reject needs a reason and nudges to partial / busy / close; partial accept is line-level only (M-18). |
| 6 | Busy and close flows | 8 | 9 | Busy chip with countdown, close needs a reason, paused/off-hours strips. Remote changes arrive on the 30 s poll (M-26). |
| 7 | Menu editing efficiency | 8 | 9 | "خلص اليوم" in one tap with undo, price history, photo import with a correction table. Unlabelled availability switch (M-24). |
| 8 | Money clarity | 5 | 9 | Today and disputes are excellent; the header shows a red negative balance with a disabled button and no reason, the cap remainder exceeds the cap, the weekly statement does not bridge (M-07, M-17). |
| 9 | Insights usefulness | 7 | 9 | Prep honesty and reject rate come with advice in plain Iraqi; the best-seller bars are mis-scaled; first day is a blank grid (M-13, M-25). |
| 10 | Staff permissions clarity | 7 | 8 | Money tab hidden for staff, owner-only gate; inconsistent phone masks; no "what staff can do" line (M-23). |
| 11 | Tablet layout | 6 | 9 | Header, banner and three columns are clean; one ticket per column in a rush; floating pill collides with titles (M-05, M-15). |
| 12 | Phone layout | 5 | 8 | Header + cash + banner take ~37% of the screen; Accept is below the fold on a group order (M-06). |
| 13 | States (loading, empty, error, offline) | 5 | 9 | Empty columns are good; offline lags 30 s, API down = endless splash, duplicate error strip (M-08, M-16). |
| 14 | Copy and voice | 8 | 9 | Iraqi, short, imperative; plural and "لـ" glitches (M-21). |
| 15 | Accessibility (contrast, targets, a11y labels) | 7 | 9 | Tokens pass AA; targets ≥ 44 px; card edge 1.32:1 relies on shadow under glare (M-27). |
| | **Overall** | **6.4** | **9** | |

### 3.2 Console (0–10)

| # | Dimension | Now | Target | Why the score |
|---|---|---|---|---|
| 1 | Density vs clarity at peak | 4 | 9 | 13 tiles + 8 policy cards above the queue; 17 identical "عيّن يدوياً" buttons; config sits where the work should be (K-03, K-18). |
| 2 | Map legibility | 4 | 8 | Garage labels collide, Eastern digits, colour-only driver state that fails CVD, IDs in the side list (K-09, K-01). |
| 3 | Triage ("what needs me now") | 3 | 9 | "يحتاج موزّع" last and below the fold; no global badge or alert; sound opt-in and page-local (K-03, K-05). |
| 4 | Keyboard-first workflows | 1 | 8 | Only Escape; no navigation, assignment or reply shortcuts (K-07). |
| 5 | Identity and recognition | 2 | 9 | Drivers, merchants, items, orders and trips as IDs; ticket numbers not shown or searchable (K-01, K-02). |
| 6 | Consistency across pages | 5 | 9 | Names on approvals/finance, IDs elsewhere; date formats differ; theme drifted from tokens (K-10, K-15). |
| 7 | Dark theme quality and contrast | 6 | 9 | Calm warm-dark palette; 4 failing pairs incl. 12 px tile labels at 3.81:1 (K-11). |
| 8 | Support desk efficiency | 6 | 9 | Canned replies with actions, refund chips, fault + escalate in one card; no customer panel, unranked macros, off-voice "المندوب" (K-12). |
| 9 | Finance trustworthiness | 7 | 9 | "الدفتر متوازن" with the last close, cash round, per-driver bars; IDs, raw account names and confusing signs (K-16). |
| 10 | Metrics wall readability | 8 | 9 | 96 px numbers with "على الهدف / بعيد عن الهدف" labels and targets; small footers, no stale warning (K-21). |
| 11 | Control room (kill switches, caps, banner) | 8 | 9 | Reason required, customer message preview, "الموقّف هسة" panel, audit log; default message off-voice (K-13). |
| 12 | Approvals | 8 | 9 | Master/detail, counts per type, quick reasons; empty compare pane, no landmark map (K-20). |
| 13 | RTL tables, numbers, dates | 5 | 9 | Tables align correctly; US date inputs, ambiguous "4/10", signed amounts like "34,900-" (K-15, K-16). |
| 14 | States (loading, empty, error, role) | 3 | 9 | No skeletons, English errors, zeros on failure, all nav shown to every role (K-06, K-08). |
| | **Overall** | **5.0** | **9** | |

### 3.3 Nielsen heuristics (0–4)

| # | Heuristic | Merchant | Key issue | Console | Key issue |
|---|---|---|---|---|---|
| 1 | Visibility of system status | 2 | Offline after ≤ 30 s, API down = splash, misses vanish | 2 | Green "live" dot during failure; zeros instead of "—" |
| 2 | Match with the real world | 4 | Kitchen-ticket language, Iraqi dialect, cash first | 1 | `p_103`, `org_7`, `ci_57`, "bike", "Failed to fetch" |
| 3 | User control and freedom | 3 | Undo on sold-out; silence cannot be undone | 3 | Escape, cancel, reset policy; one-click policy change |
| 4 | Consistency and standards | 3 | Three different "new" counts at once | 2 | Names on some pages, IDs on others; tokens drifted |
| 5 | Error prevention | 3 | Reject nudges; line-level partial only | 2 | Assign by typing an ID; no confirm on policy |
| 6 | Recognition rather than recall | 3 | Everything visible; missed orders leave no record | 1 | Dispatcher must remember which ID is which driver |
| 7 | Flexibility and efficiency | 2 | No one-tap accept, no "+5", no history | 1 | No shortcuts, no bulk, no saved filters |
| 8 | Aesthetic and minimalist design | 3 | Calm, warm, focused; rush hides tickets | 2 | Config and engineering metrics above the queue |
| 9 | Error recovery | 2 | Errors are Iraqi and specific; splash has no exit | 2 | Retry exists; English messages |
| 10 | Help and documentation | 2 | Inline hints ("كن دقيق…"); no first-day guide | 2 | Subtitles; no shortcut sheet or runbook links |
| | **Total** | **27 / 40** (Acceptable, near Good) | | **18 / 40** (Poor) | |

### 3.4 Cognitive load (8-item checklist)

- **Merchant board, tablet, rush:** fails single focus (8 rings competing, 7 hidden) and working memory
  (what was missed is gone). 2 failures: moderate.
- **Console dispatch at peak:** fails single focus, chunking (13 tiles), visual hierarchy (queue below
  config), minimal choices (4 columns × buttons × 8 policy radios), working memory (IDs) and progressive
  disclosure (policy config always open). 6 failures: critical.

### 3.5 "Does it look templated?"

- **Merchant: no.** Cream paper, ink, deep orange, tickets with giant numbers and bold note strips read
  like this kitchen's own tool, not a SaaS kit. The one generic tell is the identical rounded panel with
  an icon tile in the top corner on every Money/Insights card; acceptable.
- **Console: partly.** Pages other than the wall and finance are the default dark admin kit (pill nav,
  rounded card grid, a row of stat tiles, chips everywhere). It isn't ugly; it just says nothing about
  dispatch in Aziziyah. The wall and the cash round are the exceptions and show what the rest could be.

---

## 4. Already world class: keep

### Merchant

- **The ticket number** at 34 px with tabular digits and the 72 px accept ring: readable at 2 m, matches
  the "#1284" the customer and the courier see. (`m/base/tablet-board-board.png`)
- **Items grouped by person** with the person's note under their name and line notes on a warm strip:
  better than Uber Eats, which flattens group orders.
- **Reject that argues back:** each reason offers the better move ("بس صنف واحد خلص؟ اقبل الباقي
  والزبون يقرر", "زحمة؟ شغّل وضع الزحمة بدل ما ترفض"). DoorDash does not do this. (`m/base/tablet-board-reject.png`)
- **Partial accept with a 60-second customer window** and a clear waiting card with a strike-through
  line. (`m/states/tablet-states-partial-waiting.png`)
- **Busy mode** as a header chip with a live countdown "زحمة +10 · 60 د", the accept sheet saying what
  the customer will see.
- **Menu from photos:** photo → reading → correction table with "1 يحتاج تصحيح" → add. Better than
  Talabat's email-a-PDF onboarding. (`m/base/tablet-menu-import-review.png`)
- **Disputes:** the order timeline (accepted, ready on time, picked up, delivered), what was in the bag,
  "إذا ما رديت… ما يكلفك شي" and the hours left to answer. This is Stripe-dispute quality.
  (`m/states/tablet-money2-dispute-open.png`)
- **Deals with projected cost** on a dark summary card before sending ("الكلفة المتوقعة عليك 12,475
  دينار بالأسبوع"). (`m/base/tablet-deals-projection.png`)
- **Insights that tell you what to do:** "تتأخر 3 د عن وعدك بالمعدل — زيد الوقت لما تقبل، أو شغّل وضع
  الزحمة بالذروة"; the peak-hours heatmap is a correct single-hue sequential scale.
- **Cash hand-over with a PIN** and "لا تنطي رمز التسليم إلا بعد ما تعد الفلوس".
- **Empty columns** with an icon and a sentence each ("ماكو شي على النار").
- **Late tickets escalate on their own:** a preparing card past its promise gets a `danger` edge and a
  live "متأخر 8 د" pill; a courier waiting at the counter turns the pill amber "الدليفري ينتظر من 11 د".
  (`m/states/tablet-timeout-t60.png`)

### Console

- **Kill switches:** reason required ("يبقى بالسجل"), optional customer message with a preview, auto
  return, "وقّف الإرسال التلقائي", a "الموقّف هسة" panel and a control log with who and when.
  (`c/1440-controls-switch-dialog.png`, `c/1440-controls-full.png`)
- **Zone caps** as meters with "ممتلئ / طبيعي" and per-zone actions.
- **Approvals** master/detail with counts per type, quick reject reasons and the uploader named.
  (`c/1440-approvals.png`)
- **"الدفتر متوازن"** banner with the last close time, and the **numbered 23:00 cash round** with stops,
  amounts per driver and a route map. This is the trust anchor finance needs. (`c/1440-finance-full.png`)
- **The wall:** "الأسبوع الأول · اليوم 7 — 3 من 6 على الهدف", one metric per card, target printed under
  each number, status as label + colour. (`c/1920-wall.png`)
- **Support refunds** with the monthly cap bar, amount chips, method (wallet / points) and who pays.
- **One focus style** for every control (`:focus-visible` ring) and drawers that take focus and close on
  Escape.

---

## 5. Findings: Merchant

Severity: **P0** broken · **P1** hurts orders, money or ops · **P2** below best in class · **P3** polish.
Effort: **S** ≤ 1 day · **M** 2–4 days · **L** a week or more / cross-app.

| ID | Sev | Screen | Screenshot | Evidence | Why it matters (benchmark) | Recommendation (tokens, components, Iraqi copy) | Effort |
|---|---|---|---|---|---|---|---|
| M-01 | P1 | Board: 90-s timeout | `m/states/tablet-timeout-t60.png` (3 new, ring at 23 s) → `tablet-timeout-t108-after.png` | Three orders left untouched disappear at 90 s; the column reads "ماكو طلبات جديدة هسة" as if nothing happened. The same happens when a partial-accept window expires (`tablet-states-before-timeout` → `after-timeout`). No copy key for a missed order exists in `locales/ar.json`; nothing in history. | A missed order is lost money and a hurt score, and the kitchen never learns it happened. Uber Eats Orders shows "Missed order" and counts misses; DoorDash pauses the store after repeated misses and tells the tablet why. | New `MissedOrderStrip` (`InfoStrip tone="danger"`, sticky under the header, stays until tapped): **"فاتك طلب #7603 — انلغى لأن محد قبله خلال 90 ثانية"**, action **"تمام"**. Keep a "فاتك اليوم: 2" counter in the header. After 2 misses in 30 min: **"فاتتك طلبين. تشغّل وضع الزحمة أو تسد المحل شوية؟"** with both buttons. Needs the timeout event on `live.merchantBoard`. | M |
| M-02 | P1 | Alarm (all screens) | code `features/board/alarm.ts` | `ALARM_REPEAT_MS = 4_000`, one gain (0.35), no change as the deadline nears; `acknowledge()` silences an order for good, so a silenced order auto-rejects in silence. | A loud kitchen needs escalation, not a metronome. Toast and Square KDS escalate colour and sound; DoorDash re-alerts at 30 s left. | Escalation ladder: 90–31 s chime every 4 s; 30–11 s every 2 s, card border `danger` and the ring turns `danger`; last 10 s continuous tone + full-width banner **"باقي 10 ثواني على #3912"**. "سكّت الصوت" becomes a 30-second snooze: **"سكّت 30 ثانية"**, and it re-rings at 20 s left whatever happens. | M |
| M-03 | P1 | Board + push pre-prompt | `m/states/tablet-states-preprompt-over-alarm.png` | `PrePromptGate` opens a modal on the board even while 3 orders ring; "بعدين" re-asks after a day, so it returns at the start of every shift. | A modal over a 90-second decision costs orders. | Never show while `pending.length > 0` or a sheet is open. Show it as an `InfoStrip tone="neutral"` on an empty board: **"خلّي التابلت يرن حتى لو التطبيق مسكّر"** + **"شغّلها"**. | S |
| M-04 | P1 | Board: sound and screen | `m/states/tablet-states-sound-locked.png`; code `lib/alert-sound.ts`, no `expo-keep-awake` | Web audio is locked until the first tap and the board only says so once an order is already ringing; turning sound off in Settings leaves no trace on the board; nothing keeps the screen awake. | A sleeping or muted tablet is the #1 cause of missed orders in every merchant tablet (that is why DoorDash ships a locked-down tablet). | **Start-of-shift gate** (Signature S-M1): one big **"ابدأ الشغل"** tap unlocks audio, requests the wake lock (`navigator.wakeLock` on web, `expo-keep-awake` on native), plays a test chime and checks the printer. Afterwards a persistent danger chip in the header whenever sound can't play or is off: **"الصوت طافي — اضغط حتى تسمع الطلبات"**. | M |
| M-05 | P1 | Board, tablet, rush | `m/states/tablet-states-rush-12-new.png` | 8 new orders, one visible: a 5-item group ticket fills the column; the other seven rings run off-screen. Order is by arrival, not time left. | The kitchen must see every waiting order and its time left at a glance. Deliverect and Toast KDS shrink tickets; Uber Eats tablet lists all pending orders. | When `cols.new.length > 2`: a **queue strip** at the top of the "جديد" column with one chip per order (number + mini `CountdownRing` 32 px + item count), sorted by time left; the first ticket expanded, the rest **compact cards** (number, ring, payment, "N صنف · M أشخاص", Accept/Reject). Tap to expand. | M |
| M-06 | P1 | Board, phone | `m/base/phone-board-board.png`, `m/states/phone-states-rush-12-new.png` | Store row, chip row, cash pill and banner use ~310 of 844 pt; Accept is below the fold on a 5-item order; the banner wraps to two lines in a rush. | One-handed staff on a phone can't reach Accept without scrolling past the items. | Phone header in one 56 pt row (store, open dot, overflow for busy/printer); cash pill moves to the Money tab. Replace the banner with a **sticky bottom accept bar** above the tab bar: **"#8109 · 85 ث"** + **"ارفض" / "اقبل · 15 د"** (`Button size="lg"`, `space[4]` padding, `accent`). | M |
| M-07 | P1 | Header cash pill, Money | `m/base/tablet-board-board.png`, `m/base/tablet-money-today.png` | Header: "رصيد الكاش −4,250 دينار" in red and a disabled "اطلب فلوسك" with no reason. Money: "عليك عمولة 4,250 دينار", "−4,250 دينار" in 64 px red, and "باقي 304,250 دينار للحد" (more than the 300,000 cap). | A red negative number with a dead button reads as "I owe and I'm blocked". Stripe and Talabat explain a negative balance and when it is settled. | Header when negative: **"عليك 4,250 دينار عمولة · تنخصم من فلوسك الجاية"** in `warningText` on `warningTint`, no disabled button. Money hero: show the debt in `text` weight 700, not 64 px danger; cap meter clamps to 0…cap and the remainder is `cap − max(balance, 0)`. Disabled buttons always carry a reason line. | S |
| M-08 | P1 | Offline and API down | `m/states/tablet-states-offline.png` (identical to online), `m/states/tablet-states-api-down.png` (logo only) | `useOnline()` flips only when the 30-s heartbeat fails; the browser `offline` event and SSE errors are ignored. On a cold start with the API unreachable the splash never ends. | At peak, 30 s of false "all good" can cost an order; a tablet stuck on a logo looks broken to the owner. | Mark offline within 3 s (window `online/offline` events + SSE `error`), keep the heartbeat as the backstop. Splash timeout 8 s → full-screen state: **"ما گدرنا نوصل لدرايفر. شيك النت أو الواي فاي"**, **"جرّب مرة ثانية"**, **"اتصل بالدعم"**. | S |
| M-09 | P2 | Order card notes | `m/states/tablet-states-long-note-card.png`, `m/base/tablet-board-board.png` | The order note mixes delivery and kitchen instructions ("دگ الجرس مرتين، البيت الثالث بعد الفرن" on the kitchen card); "وحدة من البنات عندها حساسية" is buried in a paragraph. | The cook needs kitchen notes only; an allergy must be impossible to miss. Square KDS flags allergens. | Customer checkout splits **"ملاحظة للمطبخ"** and **"ملاحظة للدليفري"**; the card shows the kitchen one only (courier note stays in the detail sheet). Words like حساسية / حساس من flag a `StatusPill tone="danger" icon="alert"` **"حساسية"** in the card header. | M (customer + API) |
| M-10 | P2 | Board counts | `m/base/tablet-board-accept.png` | At the same moment: banner "2 طلبات جديدة!", column "جديد 3", rail badge "3" (the banner counts only unsilenced orders). | Three numbers for one thing erodes trust in all of them. | One count everywhere = new orders. Banner adds the state: **"3 طلبات تنتظر · 1 مسكّت"**. | S |
| M-11 | P2 | Order detail (new order) | `m/base/tablet-board-detail.png`, `phone-board-detail.png` | The detail sheet has Accept but no countdown. | Reading a long ticket is exactly when the time runs out. | Pass the same `CountdownRing` (60 px) as `aside`, as `AcceptSheet` does. | S |
| M-12 | P2 | Accept | `m/base/tablet-board-accept.png` | Accept always opens a sheet (2 taps minimum); after accepting there is no way to add time. | Uber Eats accepts in one tap with the default and lets the kitchen add time later; that is how kitchens actually work. | Card primary becomes **"اقبل · 15 د"** (one tap, the store's usual time, busy adds 10); a small chevron opens today's sheet for other times. Preparing card gets **"+5 د"** once (customer told: "المطعم زاد 5 دقايق"). | M (API rule: ask Ali, it changes the promise) |
| M-13 | P2 | Insights: best sellers | `m/base/tablet-insights-insights-2.png`; code `InsightsView.tsx:201,224` | The list is ranked by sales but each bar is `qty / qty of rank 1`, so bars clamp at 100 %: #8 "بيبسي 693 مرة" has a full bar, #2 "مشويات مشكّلة كيلو 46 مرة" a 70 % bar. Title says "الأكثر طلباً". | A chart that contradicts its numbers teaches owners to ignore insights. | Rank by quantity (the title) and scale `qty / maxQty`; sales as the caption. Or a segmented **"بالعدد / بالفلوس"** with matching rank and scale. | S |
| M-14 | P2 | الدوام | `m/base/tablet-followups-hours.png`, `phone-followups-hours.png` | A store with no hours set (open all day) shows "عطلة" on every day while the switch says "مفتوح". | Owners will think customers can't order. | Empty schedule renders **"مفتوح 24 ساعة"** on every day plus **"حدّد أوقات الدوام"**. | S |
| M-15 | P2 | New-order pill off the board | `m/base/tablet-deals-projection.png`, `tablet-followups-hours.png` | The floating "2 طلبات جديدة!" pill sits on top of page titles ("الدوام والزحمة"). | Collides with content and hides the screen title. | Tablet: pulse the rail's الطلبات badge and show the pill inside the rail column (or a 48 px bar under the page header), never over the title. | S |
| M-16 | P2 | Board error | code `Board.tsx` (two identical lines) | `board.isError && !board.data` renders the same `InfoStrip` twice. | Visual noise exactly when the user is worried. | Remove the duplicate; give the strip a retry action. | S |
| M-17 | P2 | Weekly statement | `m/states/tablet-money2-statement.png` | "رصيد أول الأسبوع 142,834", "الصافي 15,620", "استلمت 250,204", "رصيد آخر الأسبوع −4,250" with no visible bridge between them (the four numbers don't add up on screen; may be demo history, but the screen must show how they connect). | Money screens earn trust by reconciling in front of the user (Stripe payouts). | A bridge row: **"رصيد أول الأسبوع + الصافي − اللي استلمته ± تعديلات = رصيد آخر الأسبوع"**, each term tappable to its lines. | M |
| M-18 | P2 | Partial accept | `m/base/tablet-board-accept-partial.png` | A line is all-or-nothing: "2× لفة تكة" can't become "1 of 2 out". | Common in kebab shops: one skewer left. | A qty stepper per line in "شنو اللي خلص؟" (`Stepper`, min 0, max qty). | M (API) |
| M-19 | P2 | Board | n/a | Picked-up orders leave the board; no "today" list. | A customer calls about an order from 10 minutes ago; staff have no screen to find it. Every benchmark has order history. | **"طلبات اليوم"** drawer from the header: last 30 orders, status, search by "#". | M |
| M-20 | P2 | Card ↔ chat | `m/base/phone-merchant-chat-detail.png` | Unread courier messages show only inside the detail sheet. | "وين الطلب؟" from a courier at the door goes unseen. | Unread `Badge` on the card's courier pill + a soft single chime. | S |
| M-21 | P3 | Copy | board, banners | "5 صنف", "2 طلبات جديدة!", "لـ أبو حسين" renders as a detached "ل"; the API's SMS says "3 أصناف". | Small errors, read 200 times a day. | Plural helper: **1 صنف · 2 صنفين · 3–10 أصناف · 11+ صنف**; **"طلبين جداد!"**; per-person header **"أبو حسين"** with the person icon (no "لـ"). | S |
| M-22 | P3 | Group header | `m/base/tablet-board-board.png` | The orderer's avatar is "ص" (first letter of "صاحب الطلب"). | Reads as a person called ص. | Person icon for the orderer; initials only for named people. | S |
| M-23 | P3 | Staff | `m/base/tablet-staff-staff.png` | "+96477*****67" for members, "0780 ••• 4455" for invites. | Two masks for one thing. | One mask everywhere: **"0770 ••• 4567"**. Add one line under roles: **"الموظف يشوف الطلبات والمنيو، ما يشوف الفلوس"**. | S |
| M-24 | P3 | Menu rows | `m/base/tablet-menu-menu.png` | An unlabelled green switch beside a "خلص اليوم" button: two availability controls. | Mixed-literacy staff need the label. | Caption under the switch **"بالمنيو"** (or a 3-state segmented: متوفر · خلص اليوم · مخفي). | S |
| M-25 | P3 | Insights, first day | `m/states/tablet-states-insights-staff-new-store.png` | A blank heatmap grid and dashes. | First impressions of the analytics. | Empty state: **"الإحصائيات تبين بعد أول 20 طلب"** + three tips (prep time honesty, "خلص" instead of reject, busy mode). | S |
| M-26 | P3 | Remote close | `m/states/tablet-states-closed.png` (still "مفتوح" 6 s after a server-side close) | `storeStatus` refetches every 30 s; a close from the Console may take that long to show. Verify whether `live.merchantBoard` carries store changes in production (the demo hook may bypass events). | Kill switches should reach the kitchen at once. | Push store changes on the live stream; refetch status on every board event. | S |
| M-27 | P3 | Cards under glare | `m/base/tablet-board-board.png` | Card edge `border` on white is 1.32:1 and white card on `surfaceSunken` 1.18:1; separation relies on a soft shadow. | Kitchen tablets sit under bright light, often at an angle. | Card border `borderStrong`; new cards keep the 3 px accent ring. | S |

---

## 6. Findings: Console

| ID | Sev | Screen | Screenshot | Evidence | Why it matters (benchmark) | Recommendation (tokens, components, Iraqi copy) | Effort |
|---|---|---|---|---|---|---|---|
| K-01 | P1 | Map, dispatch, orders, order detail, drivers, ledger, finance | `c/1440-map.png`, `c/1440-dispatch-full.png`, `c/1440-orders.png`, `c/1440-order-detail-full.png`, `c/1440-drivers.png` | Drivers `p_103`, restaurants `org_7`, items `ci_57 ×1`, customers `p_450`, trips `trip_1761`. Finance mixes names (منتظر، سيف) with IDs. The contracts carry no display names. | A dispatcher calls حيدر, not `p_169`. Onfleet, Bringg and Uber ops all lead with name, photo and plate. With IDs the dispatcher works from memory at peak. | Add `displayName` (first name + initial), vehicle and plate to console read models through a logged `identity_vault` read for staff roles; merchant and item names from the catalog. Show **"حيدر ك. · بايك · واسط 45671"**; the ID becomes a `Mono` chip with copy-on-click. Never show an ID where a name exists. | L |
| K-02 | P1 | Orders, support, dispatch | `c/1440-orders.png`, `c/1440-support.png` | Orders appear as `ord_969`; `orderTicketNumber` (used by merchant and customer) is not used anywhere in the console; the order search matches IDs only. | The kitchen and the customer both say "#1284" on the phone; support can't find it. | Primary label **"#1284"** everywhere (orders table, support rows, dispatch cards, order header); search accepts "#1284", "1284" and the phone's last 4 digits. | S |
| K-03 | P1 | Dispatch | `c/1440-dispatch.png`, `c/1280-dispatch.png` | Queue starts at y≈620 of 900 (1440) and is just visible at 1280×720, under a 13-tile right-now bar and 8 policy cards. Columns run يبحث → معروض → مُعيَّن → **يحتاج موزّع** (last, leftmost). No map on the page although the spec says map 2/3 + queue 1/3. | The one column that needs a human is the last thing the eye reaches. Uber/Bolt ops put exceptions first. | Layout per spec: map (start, 2/3) + queue (end, 1/3). Queue order: **يحتاج موزّع** first, then معروض, يبحث, مُعيَّن (collapsed). Right-now bar: one row of 6 tiles (طلبات/ساعة، سواق أونلاين، وقت القبول، متأخرة، يحتاج موزّع، كاش بالميدان). Policy switches move to /controls. | M |
| K-04 | P1 | Dispatch: manual assign | `c/1440-dispatch-override.png` | "تعيين يدوي" opens with an empty "رقم السايق" combobox; suggestions are ID chips; no distance, ETA, cash held or cap. | Assigning by ID is guesswork; at peak it's the slowest action on the screen. Onfleet shows nearest drivers with ETA; Bringg lets you drag. | Candidate list (5): name, vehicle, distance and ETA to pickup, current job, cash vs cap bar; keys **1–5** pick, **Enter** sends. Drag a card onto a map marker to assign. Button: **"دز العرض لحيدر"**. | M–L |
| K-05 | P1 | All pages | `c/1440-support.png`; code `dispatch-page.tsx useAlertSound` | The beep exists only on /dispatch, defaults off ("صوت التنبيه طافي"), resets on reload and beeps once per increase. Nav has no badges. | Two dispatchers also do support; a "needs dispatcher" card while they answer a ticket goes unheard. | Global `AlertCenter` in `Shell`: badges on nav (**التوزيع 2 · الدعم 4 · الموافقات 8**); a sticky bar on every page when needs-dispatcher > 0: **"طلبين يحتاجون موزّع · أقدم واحد من 2:10"** + **"روح للتوزيع"**; sound on after a one-time unlock, repeating every 15 s until someone claims. | M |
| K-06 | P1 | All pages: loading and error | `c/state-error-dispatch.png`, `c/state-error-support.png`; code (no skeletons) | API down: **"ما گدرنا نجيب البيانات: Failed to fetch"** while tiles show "يحتاج موزّع 0, معروض 0" and the badge stays green "يتحدّث كل 2 ثانية". Pages render nothing until data arrives. | Zeros during an outage tell a dispatcher "all clear". Stripe and Linear grey out stale data and say when it was fresh. | On error: tiles show "—", a stale banner **"البيانات قديمة: آخر تحديث قبل 40 ثانية"**, the live dot turns `bad` with **"مقطوع"**; map network errors to **"ما نگدر نوصل للسيرفر. نحاول كل 5 ثواني"**. Skeleton rows on first load. | S–M |
| K-07 | P1 | Dispatch, support, approvals | code (only Escape handled) | No keyboard shortcuts anywhere. | Internal tools at this pace are keyboard-first (Linear, Front, Zendesk). | Shortcut map with a **?** sheet: `g m/d/o/s/f` navigation, `/` search, `j/k` next/prev card, `a` assign, `1–5` pick driver, `r` reply, `e` escalate, `Ctrl+Enter` send, approvals `a` approve / `x` reject. Show the key next to each primary button. | M |
| K-08 | P2 | Nav, roles | `c/role-support-dispatch.png`, `c/role-fieldops-finance.png` | Support and field ops see all 11 nav items; restricted pages say "ما عندك صلاحية لهاي الصفحة" while the right-now bar still shows cash in the field to support. | Noise, and data shown to roles that shouldn't see it. | Filter `NAV` by `me.roles`; hide widgets the role can't read; land each role on its home (support → الدعم, field ops → الموافقات). | S |
| K-09 | P2 | Map | `c/1440-map.png` | Garage labels pile up at the centre ("كراج البوابة ١ / كراج السوق / كراج البوابة ٢") with Eastern digits; driver state is colour only and fails the palette validator (free #1f9d55 vs over-cap #d03b3b ΔE 4.1 deutan); zone tiers use 5 categorical hues for an ordinal scale. | Colour-blind dispatchers can't tell free from over-cap; the centre is unreadable at launch density. | Label collision (offset + leader lines, hide on zoom-out), Western digits. State by **shape + colour**: filled dot free, ring offered, square on job, ✕ glyph over cap, hollow offline. Tiers as one hue light→dark (sequential). Hover card with name, plate, cash and job. | M |
| K-10 | P2 | Theme | `apps/console/src/app/globals.css` | Hard-coded `#1a1917`, `#2c2a26`, accent `#f2a33a` ("placeholder amber"), success `#1f9d55`, danger `#d03b3b`; tokens say neutral.900 `#1F1A14`, brand accent `#E08A1E`, success `#2F8F5B`, danger `#C2412D`. | Two brands drift apart; the CLAUDE.md rule is colours only from `packages/design-tokens`. | Generate the CSS variables from `@driver/design-tokens` (`themes.dark` exists) at build time; delete the literals. | S |
| K-11 | P2 | Contrast | `c/1440-dispatch.png` | `muted` on `surface-2` (12 px tile labels) 3.81:1; `faint` on `surface-2` (trip IDs in cards) 2.29:1; `bad` text on `surface` 2.98:1; `line` borders 2.09:1. | Fails WCAG AA for small text on a screen read for 14 hours. | Tile labels `neutral.300 #D6C8B4`; `faint` only on `bg`; error text `danger.100 #F2C3B9` on dark; borders `neutral.600` lifted to ≥ 3:1 for interactive edges. | S |
| K-12 | P2 | Support case | `c/1440-support-case-full.png` | No customer panel (phone, order history, past disputes, refunds); 11 canned chips in fixed order; SLA chip "فات 20:07" reads like a clock time; canned replies say "المندوب" to customers (voice guide: الدليفري). | Time to resolve depends on context in one glance (Zendesk/Intercom sidebars). | Right column **"الزبون"**: name, masked phone + call, orders 30 d, disputes, refunds this month. Canned sorted by the suggested resolution first. SLA as **"متأخرة 20 ساعة"** / **"باقي 17 ساعة"**. Replace "المندوب" with "الدليفري" in `canned.ts` and `console.sup_*`. | M |
| K-13 | P2 | Kill-switch message | `c/1440-controls-switch-dialog.png`; `console.ctl_refusal_*` | Default customer text **"خدمة {name} موقّفة مؤقتاً. نرجع قريب إن شاء الله"**. | Voice rules: apology → next step with a time, no "إن شاء الله" in ETAs. | **"خدمة التكسي موقّفة لحد الساعة {time}. اطلب تكتك أو جرّب بعدين"**; when no end time: **"نبلغك أول ما ترجع"** with a notify opt-in. | S |
| K-14 | P2 | Dispatch: policy switches | `c/1440-dispatch.png` | One click switches a vertical between بث / تلقائي / اقتراح بس; no confirm or reason; sits above the queue. | A misclick at peak changes how every order is dispatched. | Move to /controls; confirm dialog with a reason like the kill switches: **"تغيّر توزيع الأكل إلى اقتراح بس؟"**. | S |
| K-15 | P2 | Dates, inputs, leaks | `c/1440-orders.png`, `c/1440-driver-ledger.png`, `c/1440-order-detail-full.png` | Native date inputs show "mm/dd/yyyy, --:-- --"; dates "4/10" (day or month?); "bike", "bank", "merchant_cash:org_7", "d9.h52" on screen. | English and raw keys in an Arabic tool; "4/10" is ambiguous. | Arabic quick ranges (**اليوم · أمس · هالأسبوع**) + an Arabic date picker; dates as **"4 تشرين الأول"**; label maps for vehicle and account names; refs as `Mono` chips. | S–M |
| K-16 | P2 | Driver ledger, finance | `c/1440-driver-ledger.png` | "الكاش بيده −34,900" next to "عليه للشركة 17,500"; minus renders after the number ("34,900-"). | Finance at 23:00 needs words, not signs. | **"بيده 34,900 دينار"**, **"عليه للشركة 17,500 دينار"**, **"له 2,000 دينار"**; colour + word for direction; numbers isolated LTR with U+2212 when a sign is unavoidable. | S |
| K-17 | P2 | Orders table | `c/1440-orders.png` | Status chips nearly all the same blue (المطعم قبل، دا يتحضّر، لگينا سايق، انستلم); no late column or sort. | The table can't be scanned for trouble. | Chip tone by phase: waiting `warn`, moving `live`, done `done`, problem `bad`; a **"متأخر"** column (minutes) sortable, problems first by default. | S |
| K-18 | P2 | Dispatch cards | `c/1440-dispatch-full.png` | Every card carries a full-width "عيّن يدوياً"; 17 scheduled orders ("مجدول") fill "يبحث". | Repetition hides the one card that matters. | Card action on hover/focus (and the `a` key); scheduled orders in a collapsed **"مجدولة (17)"** group. | S |
| K-19 | P3 | Login | `c/1440-login.png` | Card sits high; full nav visible while signed out. | First impression. | Centre the card; hide nav until signed in. | S |
| K-20 | P3 | Approvals | `c/1440-approvals-item.png` | "للمقارنة" pane takes half the width with "ماكو صورة للمقارنة"; no mini map for a landmark. | Space wasted where the reviewer needs location. | Collapse the compare pane when empty; landmark approvals show a small map with the pin. | S |
| K-21 | P3 | Wall | `c/1920-wall.png` | Footer lines at 14 px can't be read from the room; no stale warning if the refresh fails; "1 د" unit split. | The wall is read from 3–5 m. | Footers ≥ 24 px; trend arrow vs yesterday; a full-width red line **"الشاشة ما تتحدث من 2 دقيقة"** when stale. | S |
| K-22 | P3 | Order detail log | `c/1440-order-detail-full.png` | 26 rows all at "6:37 ص" with actor IDs (انبعث عرض، العرض انتهى…). | Noise hides the story. | Collapse dispatch events: **"عرضناه على 3 سواق، 2 ما ردوا، قبله حيدر بعد 40 ثانية"**; expand on click. | S |
| K-23 | P3 | Right-now bar | `c/1440-dispatch.png` | "Outbox: ينتظر / فشل 0 / 0", "بتعويض 0" on the dispatcher's prime space. | Engineering metrics belong on /system. | Move them; keep a single red system pill in the shell when the outbox fails. | S |

---

## 7. Persona walk-throughs

**Khalid, kitchen owner (tablet on the counter, phone at home).** Opens the app at 11:00: the push
pre-prompt covers the board (M-03); taps "بعدين" and it comes back tomorrow. The header says "رصيد الكاش
−4,250 دينار" in red with a dead button (M-07), and he calls Driver to ask what he owes. Insights tell him
"تتأخر 3 د عن وعدك بالمعدل" and what to do, which he likes, but the best-seller bars don't match the
numbers (M-13). Red flags: debt without explanation, no record of missed orders (M-01).

**Cashier at the counter (mixed literacy, reads the number and the ring).** The ring and the number work
at 2 m. A courier asks "#7046؟" and the ready card says "الدليفري ينتظر من 11 د" (good). A customer
calls about an order picked up 10 minutes ago: nowhere to find it (M-19). During a rush she taps "سكّت
الصوت" to hear the phone, then the 90 s run out in silence (M-02, M-01).

**Cook at the pass (greasy hands, glances up).** Needs "what's next and what's special". Line notes on
the warm strip are excellent; the allergy is inside a delivery paragraph (M-09). "+5 دقايق" after
accepting is the most common thing a cook wants and isn't there (M-12).

**Dispatcher at 20:30 peak.** Lands on the map (no tiles offline, IDs in the list). Goes to التوزيع:
scrolls past 13 tiles and 8 policy cards to the queue (K-03); the red column is on the far left. Opens
"تعيين يدوي" and must pick an ID (K-04). While answering a WhatsApp ticket on الدعم, a new
"يحتاج موزّع" card arrives with no sound or badge (K-05). No keys to move faster (K-07).

**Support agent (زينب).** Her nav shows pages she can't open (K-08). A customer says "طلبي #1284": search
doesn't find it (K-02). The case has canned replies with one-tap refunds (good) but no customer history
(K-12), and the reply text says "المندوب".

**Finance at 23:00.** "الدفتر متوازن" and the numbered cash round are exactly right. The ledger says
"−34,900" and "17,500" side by side (K-16), driver rows mix names and `p_`, and account names leak
("merchant_cash:org_7").

---

## 8. Signature moments (build-ready)

Each moment is the thing a user would describe to a friend. Specs use existing tokens and components;
copy is final Iraqi Arabic unless marked.

### Merchant

**S-M1 · "ابدأ الشغل": the start-of-shift gate and the alarm ladder** (fixes M-02, M-03, M-04)
- *Layout:* full-screen sheet over the board at first open each day (and after any reload while signed in):
  title **"يلا نبدأ الشغل"**, three check rows (`EntryTile`): **الصوت** (plays the chime, ✓ icon
  `check`), **الشاشة تبقى شاعلة** (wake lock), **الطابعة** (state from `usePrinterSnapshot`); one
  `Button size="lg" fullWidth` **"ابدأ الشغل"**.
- *Ladder:* ring states by time left: `> 30 s` accent ring, chime/4 s; `30–11 s` ring and card border
  `danger`, chime/2 s, card scale pulse 1.00→1.02 (180 ms, `Easing.out(quad)`, off with reduce motion);
  `≤ 10 s` continuous tone, full-width banner **"باقي 10 ثواني على #3912"**. "سكّت 30 ثانية" snoozes.
- *A11y:* banner `accessibilityLiveRegion="assertive"`; ring has `accessibilityLabel` "باقي N ثانية".
- *Edge:* web without wake-lock API → keep the header chip **"خلّي الشاشة شاعلة من إعدادات التابلت"**.

**S-M2 · Rush queue** (fixes M-05, M-06)
- *Tablet:* when new > 2, a 64 px strip at the top of "جديد": chips `radius.pill`, `surface`, 1 px
  `borderStrong`, each = `#1151` (bodyStrong, tabular) + `CountdownRing` 32/4 + "5 صنف"; sorted by time
  left; tap scrolls to the ticket. Tickets after the first render compact (header, payment, one line
  "5 أصناف · 3 أشخاص", Accept/Reject).
- *Suggestion:* at ≥ 4 waiting, `InfoStrip tone="warning"` **"4 طلبات تنتظر. تشغّل وضع الزحمة؟"** +
  **"شغّله"**.
- *Phone:* sticky accept bar above the tab bar (88 pt): ring 40, **"#8109"**, **"ارفض"** secondary,
  **"اقبل · 15 د"** primary `flex: 2`.

**S-M3 · One-tap honest accept** (fixes M-12)
- Card primary **"اقبل · 15 د"** (`Button size="lg" haptic="success"`), chevron `chevron-down` opens the
  existing `AcceptSheet`. Toast **"انقبل. جاهز خلال 15 دقيقة"**. Preparing card chip **"+5 د"** (once),
  toast **"زدنا 5 دقايق. الزبون عرف"**. Needs an API rule; ask Ali before building.

**S-M4 · The courier at the pass**
- When `courier.state = arrived`, the ready card turns `successTint` full-bleed with **"حيدر وصل — سلّمه
  #7046"**, plate "واسط 45671", and after 3 min `warningTint` **"حيدر ينتظر من 4 د"**. One button
  **"سلّمته"** (records hand-over; ties into M-19 history).

**S-M5 · Money you can read in one line** (fixes M-07, M-17)
- Header pill states: positive **"إلك 87,500 دينار · توصلك الليلة ويا الدليفري"**; negative
  **"عليك 4,250 دينار عمولة · تنخصم من الجاية"**; requested **"فلوسك جاية قبل 9:40"**. Statement bridge
  row as in M-17.

**S-M6 · End of shift**
- At close (or 00:30): a summary card **"اليوم: 42 طلب · فاتك 0 · وقتك مضبوط 91% · الصافي 512,000
  دينار"** with one advice line from Insights. Shareable to WhatsApp.

### Console

**S-K1 · The triage bar** (fixes K-03, K-05)
- `Shell` top bar (sticky, 48 px, `bg-danger-500/15`, border `bad`) on every page when needs-dispatcher
  > 0: **"طلبين يحتاجون موزّع · أقدم واحد من 2:10"**, action **"خذه"** (`a`), which opens the card with
  candidates. Nav badges from one `useAlertCounts()` query. Sound: two-tone 880/660 Hz every 15 s until
  claimed; claimed shows the claimer's name to the other dispatcher.

**S-K2 · Assign by name, on the map** (fixes K-01, K-04)
- Dispatch layout: map (start, `2fr`) + queue (end, `1fr`). Selecting a card draws pickup→drop-off and
  highlights 5 candidates on the map with numbers 1–5; side list rows: **"1 · حيدر ك. · بايك · 1.2 كم ·
  4 د · كاش 34,900 / 75,000"**. Keys 1–5 then Enter; drag a card onto a marker.

**S-K3 · One identity, one search** (fixes K-02, K-15)
- `Ctrl+K` palette: type **"1284"**, **"0770 ••• 4567"** tail, a name or a plate; results grouped
  طلبات / سواق / مطاعم / زباين. "#1284" is the order's name on every page.

**S-K4 · Support case 360** (fixes K-12)
- Right rail "الزبون" card; the suggested resolution as a primary chip **"عوّض 1,000 + اعتذار"** with
  the canned text pre-filled; `Ctrl+Enter` sends, `e` escalates. Resolution survey result shown when it
  arrives.

**S-K5 · 23:00 cash round mode**
- Already the best screen. Add: per-stop **"استلمت"** check with the courier's PIN, live **"جمعنا
  612,000 من 746,710"**, and a printable route for the field-ops phone.

**S-K6 · Wall in TV mode** (fixes K-21)
- `?tv=1`: no links, 1920 grid, footers 24 px, trend arrows vs yesterday, stale line at 2 min, and the
  single most urgent tile pulses once a minute when off target.

**Built 2026-10-05 (Phase 3, brief D).** S-M1, S-M2, S-M3 (Phase 1–2) and S-K1–S-K4 (Console redesign)
were already in; S-K1 gained its strip on every page. New: S-M4 (`orders.merchant.handOver`, column
`orders.handed_over_at`, event `order.handed_over`; no state or money change), S-M5 (server headline on
`merchantAdmin.money.cash`, statement `adjustmentsIqd` for the M-17 bridge), S-M6
(`merchantAdmin.daySummary`; due at close or 00:30–05:00 for the day before; local calendar day), S-K5
(round receipts are the existing `ops.recordCashReceipt`/`driver_settlement` with the courier's daily
code; tonight's round counts ops-round receipts from 18:00 Baghdad), S-K6 (`previous` and `better` per
tile: the value as it stood 24 h ago; disputes and the ledger have none). Copy: no em dash; minutes
written out ("4 دقايق", "11 دقيقة") — the wall's median no longer reads "1 د".

---

## 9. Top 12 "do next"

### Merchant (ranked by orders and money saved per day of work)

1. **M-01** Missed-order strip and counter.
2. **M-02** Alarm ladder; silence becomes a 30-s snooze.
3. **M-03** No pre-prompt while orders ring.
4. **M-04** "ابدأ الشغل" gate: audio unlock, wake lock, test chime; sound-off chip.
5. **M-08** Offline in ≤ 3 s; splash timeout with an error and retry.
6. **M-05** Rush queue strip and compact tickets on the tablet.
7. **M-07** Explain a negative balance; clamp the cap meter; reasons on disabled buttons.
8. **M-06** Phone: one-row header and the sticky accept bar.
9. **M-11** + **M-10** Countdown in the detail sheet; one "new" count.
10. **M-13** Fix the best-seller scale.
11. **M-09** Kitchen vs courier notes; allergy pill (cross-app).
12. **M-12** One-tap accept and "+5 د" (needs Ali's OK: it changes the promise rule).

### Console (ranked by dispatcher and support minutes saved at peak)

1. **K-02** "#1284" everywhere and searchable.
2. **K-01** Names, vehicles and plates instead of IDs (logged vault read).
3. **K-03** Dispatch layout per spec: map + queue, "يحتاج موزّع" first, policy to /controls.
4. **K-05** Global triage bar, nav badges, sound on by default.
5. **K-04** Candidate list with ETA and cash; keys 1–5; drag to assign.
6. **K-06** Honest error and stale states; skeletons; Arabic network errors.
7. **K-07** Keyboard map and "?" sheet.
8. **K-08** Role-based nav and widgets.
9. **K-11** + **K-10** Contrast fixes; CSS vars generated from design tokens.
10. **K-12** Support customer panel, ranked macros, SLA wording, "الدليفري".
11. **K-09** Map labels, Western digits, shape-coded driver state, sequential tiers.
12. **K-13** + **K-16** Kill-switch customer copy with a time; ledger words instead of signs.

---

## 10. Appendix

### 10.1 Contrast (WCAG 2.1, computed)

| Pair | Ratio | Verdict |
|---|---|---|
| Merchant `textMuted #6B6157` on `surfaceSunken #F3EBDD` | 5.11 | pass |
| Merchant `accentText #9A5200` on `accentTint #FCEBD3` | 5.02 | pass |
| Merchant `onAccent #1F1A14` on `accent #E08A1E` | 6.43 | pass (white would be 2.68: keep ink) |
| Merchant `warningText #8A5300` on `warningTint #FBEBCC` | 5.38 | pass |
| Merchant card `border #EADFCF` on white (non-text) | 1.32 | weak under glare (M-27) |
| Console `muted #a39e94` on `bg` / `surface` | 6.59 / 5.37 | pass |
| Console `muted` on `surface-2 #44413b` (stat-tile labels, 12 px) | 3.81 | **fail** (K-11) |
| Console `faint #7c776e` on `surface-2` (IDs in cards) | 2.29 | **fail** |
| Console `bad #d03b3b` text on `surface #2c2a26` | 2.98 | **fail** |
| Console `line #5e5a52` on `surface` (control edges) | 2.09 | **fail** for interactive borders |
| Console `accent #f2a33a` on `surface-2` | 4.88 | pass |
| Console chips (danger-100 / info-100 on tinted surface-2) | 5.98 / 6.60 | pass |

### 10.2 Palette validation (`dataviz/scripts/validate_palette.js`, dark, surface `#1a1917`)

- **Map driver states** `#1f9d55, #f2a33a, #4e9bc4, #d03b3b, #7c776e`: FAIL. CVD worst pair free ↔
  over-cap ΔE 4.1 (deutan); offline ↔ on-job ΔE 14.0 for normal vision. Needs shape encoding (K-09).
- **Zone tiers** `#f2a33a, #d9c25b, #6fb58a, #4e9bc4, #8c7ad1`: FAIL (centre ↔ near ΔE 3.8 deutan). The
  data is ordinal (distance bands), so use a single-hue sequential ramp, not categorical hues.
- **Wall status** `#2F8F5B` vs `#C2412D`: CVD ΔE 5.9 (below 8) but every card also carries the label
  "على الهدف / بعيد عن الهدف": legal with secondary encoding. Keep the labels.
- **Merchant heatmap**: single hue, light → dark, five steps: correct sequential form.

### 10.3 Screenshot index

Under `/tmp/claude-0/-home-claude-driver/9e36f95e-a04f-5dd2-b358-67d18250f0e3/scratchpad/audit/`:

- `merchant/base/`: the repo shot lists (board, menu, deals, insights, money, staff, chat, follow-ups) at
  `tablet-*` 1280×800 and `phone-*` 390×844, 121 files. Board shots after "اطلب فلوسك" and the
  follow-ups hours editor are missing because the demo balance is negative (button disabled) and the
  demo store has no hours to edit.
- `merchant/states/`: audit-only states: `*-states-preprompt-over-alarm`, `*-sound-locked`,
  `*-rush-12-new(-full)`, `*-long-note-card`, `*-board-many`, `*-partial-waiting(-board)`,
  `*-alarm-on-menu`, `*-before-timeout`, `*-after-timeout`, `*-closed`, `*-offline`, `*-api-down`,
  `*-stores-picker`, `*-empty-board`, `*-insights-staff-new-store`, `*-more-staff`,
  `tablet-timeout-t0-three-new` / `-t60` / `-t100-after` / `-t108-after` (unattended 90-s window), and
  `*-money2-statement(-full)`, `*-money2-disputes`, `*-money2-dispute-open`.
- `console/`: `1440-*` and `1280-*` for every page (+ `1440-*-full`), `1440-dispatch-override`,
  `1440-controls-switch-dialog`, `1440-approvals-item`, `1440-dispatch-focus`, `1920-wall`,
  `state-loading-*`, `state-error-*`, `state-signed-out-dispatch`, `state-support-resolved`,
  `role-fieldops-*`, `role-support-*`.

Capture scripts (audit tooling, not in the repo): `scratchpad/mc-audit/` (`mshots.mjs` = the repo's
`web-shots.mjs` plus a pre-prompt opt-out and SSE-safe navigation, `mextra/states.mjs`,
`mextra/money2.mjs`, `mextra2/timeout.mjs`, `place.mjs` placing real customer orders over tRPC, `cshots.mjs` for the Console).
Note: the Merchant Metro config blocks any path containing `.claude/`, so an export from an agent
worktree needs that entry removed locally for the build (reverted after).
