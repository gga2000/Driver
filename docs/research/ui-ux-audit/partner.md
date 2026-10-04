# Driver Partner — UI/UX audit (2026-10-04)

Audit only: no product code changed. Scope is `apps/partner` at `2874b7f` in every role: courier,
tuktuk/taxi, الرجعة, خطوط, fleet owner and field ops. Everything was captured on the web export
against the partner demo API and compared with Uber Driver, DoorDash Dasher, Careem Captain, Bolt
Driver, Grab Driver, Swiggy/Zomato partner and the Talabat rider app.

**Bottom line.** The money screens are better than most partner apps, and so are the voice and the
brand. The scorecard and the الرجعة pricing are too. The trouble is in the moments that decide a
shift. On a real phone an offer makes no sound. SOS does nothing. The app keeps saying "شغّال،
ندورلك طلب" after the network has gone. A courier can decline an offer with the easiest tap on the
screen and complete a pickup by accident. Fix those first; most of the rest is polish on solid
ground.

---

## 1. Method

| Skill applied | How it shows up here |
|---|---|
| `design:design-critique` | First 2-second impression, usability, hierarchy, consistency and accessibility for each screen (§5 findings) |
| `anthropic-skills:critique` | Nielsen 0–4 scoring (§3.2), cognitive-load checklist (§3.3), four persona walk-throughs (§2), P0–P3 severity, anti-pattern check (§3.4) |
| `frontend-design` | Visual direction for the signature moments (§6): spend the boldness in one place (the offer card), keep everything else quiet |
| `anthropic-skills:onboarding-cro` | Activation path from install to first job (P-12, S-8): time-to-value, one goal per session, progress and no dead ends |
| `design:ux-copy` | Every copy recommendation follows what happened, why, and what to do next, in Iraqi wording per the voice spec |
| `dataviz` | Earnings chart, cash cap bar and scorecard bars. The breakdown palette went through `validate_palette.js` (§3.5) |
| `anthropic-skills:marketing-psychology` | Motivation and earnings framing, kept ethical: goal-gradient, peak-end and loss framing used only where the loss is real (P-11, S-3, S-4). No dark patterns |

**Capture.** 135 screenshots are in
`/tmp/claude-0/-home-claude-driver/9e36f95e-a04f-5dd2-b358-67d18250f0e3/scratchpad/audit/partner/`
(file names below are relative to that folder). The setup was:

- the existing `scripts/web-shots.mjs`, all 8 groups (core, earnings, partner-chat, followups, fleet,
  intercity, khat, ops) at 390×844;
- an `audit-*` pass: sign-in, the offer ring at 15 s, 5 s and 1 s, a missed offer, the network
  dropped while online, loading, server errors, a job action with no network;
- a `small-*` pass on a 360×740 phone.

The demo API ran on :3502 and was restarted between groups by PID. I read every screenshot. I also
read the code for haptics, sound, motion, gestures, offline handling and accessibility labels.

**Limits.** The capture is the web build. Native haptics, sound, background behaviour and
font scaling were judged from code, not from a device. Notes on running the capture are in
Appendix B (the harness currently fails on its own).

## 2. Personas and what broke for each

| Persona | Primary action walked | Red flags found |
|---|---|---|
| **Haydar, 19, bike courier.** Phone in a handlebar mount, one thumb, 6–10 jobs on a lunch peak, plays it fast | Offer → accept → pickup → door → cash → next | The offer makes no sound on his Android in the foreground (P-01). ارفض sits under his right thumb at the same size as اقبل (P-03). On a 360-px phone the 18,000 cash-to-collect row is below the fold (P-04). استلمت الطلب is one tap with no undo, and it works while the food is still "يتحضّر" (P-08). The done screen says "+1,000" and nothing about having just gone 7,500 over his cash cap, so the next offers stop without a reason (P-06). |
| **Abu Ali, 45, tuktuk driver, reads slowly.** Relies on icons, colour and numbers; calls rather than types | Go online → ride offer → pick up → drop off → collect fare | The pay line "بعد حصة درايفر 10%" is fine. But the ride ends with one tap and no "استلم 2,500 دينار" confirm (P-13). The cash card shows two numbers (82,500 in hand, 67,500 owed) and a bar with two markers that he can't tell apart (P-05). The gate banner says "عندك مستمسك منتهي" without saying which one (P-29). The home error state uses a phone icon for "no internet" (P-33). |
| **Hajji Kareem, الرجعة driver at the Baghdad garage.** Standing at the car, riders arriving, cash in hand | Announce → board seats by PIN → mark walk-ups → depart | The departure screen is 4,560 px tall: seat map, PIN pad, riders and route stacked, so he scrolls between them for every rider (P-24). The seat bars use four colours with no legend (P-23). He can't call a late rider from the app (P-14). The announce form still states the old T−30 low-fill rule (P-16). Garage names flip between "البوابة ٢" and "البوابة 2" (P-22). |
| **Sajjad, fleet owner who also drives.** Four cars, five drivers, checks money at night | See who is over the cap, whose papers expire, his own earnings | Fleet lives on the third level of الحساب, and fleet alerts (a driver over cap, expired insurance) never reach his home (P-27). The fleet hero shows earnings but not the owner's share. The driver detail has no call button. Pending invites are handled well. |

## 3. Scorecard

### 3.1 Dimensions (0–10, now → target)

| # | Dimension | Now | Target | Why it isn't higher yet |
|---|---|---:|---:|---|
| 1 | Offer glanceability (judge it in 2 s) | 6 | 9 | Pay is huge and clear. Total time and distance are missing. Cash and drop-off fall below the fold on small phones (P-04). |
| 2 | One-thumb reach and tap targets on the move | 6 | 9 | Targets are ≥ 44 px. But decline is in the best thumb spot (P-03), SOS is a 44-px tap, and khat "غايب؟" is a text link (P-31). |
| 3 | Contrast in sunlight | 6 | 8 | Text passes AA (5.0–6.4:1). The orange ring arc and bars are 2.5–2.6:1, and map labels are about 2.5:1 (P-21). |
| 4 | Information priority on offer and job | 6 | 9 | No ticket number at pickup (P-07). The top-up card sits on every step (P-18). A single pay line repeats the hero. |
| 5 | Error prevention (accept, decline, complete) | 5 | 9 | Offline gets a hold-to-stop, which is good. Pickup, deliver and ride-complete are single taps with no undo (P-08). Decline has no friction (P-03). |
| 6 | Cash clarity | 5 | 9 | The door hand-over panel is good. The cap maths shows two numbers, the bar is green at 91 % (P-05), the done screen says nothing about the cap (P-06), and rides have no cash confirm (P-13). |
| 7 | Earnings motivation and transparency | 7 | 9 | Hero, chart, named components and job drill-down are strong. Partial-vs-full comparisons demotivate (P-11). Errors show a false 0 (P-10). |
| 8 | Trust (why offered, why paid) | 7 | 9 | Every pay component is named and take rates are shown. "Why you got this offer" is missing, and the batch "(70%)" is jargon (P-19). |
| 9 | Onboarding and activation | 3 | 8 | There is no driver sign-up in the app. "Not a partner" tells people to upload documents the app can't take (P-12). |
| 10 | Multi-role navigation | 5 | 8 | Modes are filtered correctly. Fleet and ops are buried, and home ignores the second role (P-27). |
| 11 | الرجعة garage speed | 6 | 9 | Seat map, PIN pad, late meter and departure blockers are all excellent ideas. They are stacked in one long scroll (P-24). |
| 12 | خطوط child safety | 5 | 9 | The "نزل" → guardian notification and the absence reasons are good. Missing: child photo, guardian call, end-of-run seat check, and substitute offers kept out of an active run (P-15). |
| 13 | Voice and low literacy | 7 | 9 | Real Iraqi voice and Western digits. Leaks: "مندوب", "٢", "4 ساعة", "يبعد 0 كم", English "SOS" label, a gendered "ما يروح" (P-22, P-36, P-37). |
| 14 | Brand consistency as a work tool | 8 | 9 | Cream, ink and orange are applied with restraint, and the dark earnings hero works. Back arrows and keypads differ between screens (P-34, P-35). |
| 15 | States (loading, empty, error, offline) | 4 | 9 | Home has skeletons and a retry. Being offline isn't detected (P-09), earnings has no error state (P-10), and job actions spin with no network (P-09). |
| 16 | Alerts (sound, vibration, screen awake) | 2 | 9 | Native sound is a no-op, the vibration is one heavy tick, and nothing keeps the screen awake (P-01). |
| 17 | Safety (SOS, contact) | 2 | 9 | SOS is a stub toast on food and ride jobs and absent from الرجعة, private rides and خطوط. Riders can't be called on الرجعة or خطوط (P-02, P-14). |
| | **Average** | **5.3** | **8.8** | |

### 3.2 Nielsen heuristics (0–4)

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 2 | Stays "شغّال" with no network for 16 s or more (`audit-home-offline-network.png`). Job actions spin forever offline. |
| 2 | Match with the real world | 3 | Iraqi voice, Arabic month names, a car seat map with the driver on the left. "(70%)" and "مؤشر الاعتمادية" are abstract. |
| 3 | User control and freedom | 2 | No undo for استلمت, سلّمت or انتهت. The offer decline is instant. The hold-to-go-offline is a good counter-example. |
| 4 | Consistency and standards | 3 | Two back-arrow styles, two keypad layouts, two digit systems in garage names. |
| 5 | Error prevention | 2 | Pickup is allowed while the food is "preparing". Absence can be reported for a child who already boarded (HTTP 409). The final check-in try doesn't warn. |
| 6 | Recognition over recall | 3 | Pills and icons do well. The seat-bar colours must be memorised. |
| 7 | Flexibility and efficiency | 2 | No garage mode, no auto-return after a job, no quick settle from home. |
| 8 | Aesthetic and minimalist design | 3 | Calm and branded. The departure and khat screens are overloaded. |
| 9 | Error recovery | 2 | Earnings failure shows "0 دينار · ماكو ربح". Offline taps give no message. |
| 10 | Help and documentation | 1 | No help or support entry anywhere. The locked screen's WhatsApp contact is a stub. |
| | **Total** | **23/40** | Acceptable base; significant fixes needed before a public launch. |

### 3.3 Cognitive load (8-item checklist; failures)

| Screen | Failures | Verdict |
|---|---:|---|
| Offer (390×844) | 1 (progressive disclosure: one pay line repeats the hero) | Low |
| Offer (360×740) | 2 (+ hierarchy: cash and drop-off hidden) | Moderate |
| Job | 2 (single focus: the top-up card; chunking: 4 contacts + top-up + stops + pay) | Moderate |
| الرجعة departure | 4 (single focus, one thing at a time, chunking, progressive disclosure) | **High** |
| خطوط run | 3 (single focus: substitute offers on top; one thing at a time; minimal choices: صعد / غايب؟ / غايب اليوم on each row) | Moderate–high |
| Earnings | 1 (cash card: two measures on one bar) | Low |

### 3.4 Anti-pattern verdict

Nobody would take this for a generic AI-made app. The cream and ink palette is the brand's own
(brand spec). The dark earnings hero, the welcome card drawn as a tilted offer, and the illustrated
check-in face all feel specific to the product. Two template tells remain. Cards are cut the same
way everywhere (one radius, the same sunken tint on pay lines, demand rows and notes), so the
emphasis that should belong to cash goes flat. And separators are middle dots
("استلام · شارع 30 · …") on nearly every meta line. Both are minor.

### 3.5 Data-viz check

- The earnings breakdown palette (`#9A5200, #E08A1E, #2F8F5B, #2F6FB0`) **passes**
  `validate_palette.js --mode light`: lightness band, chroma, CVD (worst ΔE 8.7 protan) and
  normal-vision floor. There is one WARN: accent `#E08A1E` is 2.61:1 against the surface. The legend
  rows with amounts are the required relief. **Keep.**
- The cash cap bar encodes two measures on one track: cash in hand as the fill, owed as a tick. Its
  colour comes from the owed figure while its length comes from cash in hand. That is the root of
  P-05.
- The scorecard metric bars show target and Silver ticks without labels on the bar. The rating bar
  is blue while the other "تمام" bars are green (P-41).
- The day chart's hour axis has no ص/م (P-30).

---

## 4. Already world class — keep

1. **Named pay on every offer and job** ("أجرة التوصيل 1,000 · إضافة الليل +250 · تعويض الاستلام
   +250"), plus the take rate stated outright ("بعد حصة درايفر 10%"). That beats Uber's single
   upfront fare for trust (`core-offer-ride.png`, `earnings-week-job-open.png`).
2. **Hold-to-go-offline** (0.9 s fill with a warning haptic) and a one-tap go-online with a spring
   and a success tick (`core-home-online.png`). It's the right asymmetry.
3. **The cash hand-over at the door.** The amount to collect sits big and alone, with "عد الفلوس
   قدام الزبون قبل ما تأكد" and the amount in the button label ("استلمت 14,000 دينار")
   (`core-job-cash.png`).
4. **The unreachable-customer protocol**: a 5:00 ring and a timeline of what we do (we called and
   sent WhatsApp, dispatcher at 3 min, you can end at 5 min) (`core-job-unreachable.png`).
5. **The earnings hero and drill-down**: count-up net, tap-a-bar chart, "أحسن وقت", every job
   expanding to its components and the cash taken, and "الكاش مو إلك: يروح للمطعم والشركة"
   (`earnings-day-full.png`).
6. **The scorecard**: gauge, tier ladder with caps, nudges dated to the Sunday they take effect,
   and a learning-month card ("أول شهر بدون أي إجراء") (`earnings-scorecard-full.png`,
   `earnings-scorecard-month-one.png`). This follows the scoring spec's "never same day" rule
   faithfully.
7. **Gate states**: the switch itself becomes a locked control that says why ("سوّي التسجيل
   اليومي أول · الزر مقفول لحد ما تخلص هذا") (`earnings-home-checkin-needed.png`).
8. **Documents**: most urgent first, the rejection reason in plain words, days left, and camera
   offered first (`earnings-documents-mixed.png`).
9. **الرجعة pricing honesty**: "إذا كملت: 42,000 دينار، يبقالك 37,500"; demand chips by time
   window ("12 · 7:00"); departure blockers spelled out ("3 ركاب بعدهم ما صعدوا")
   (`intercity-announce-full.png`, `intercity-pin-typing.png`).
10. **Fleet consent card**: what the owner will and won't see, before he sees anything
    (`followups-invite-sheet.png`).
11. **The top-up desk**: the cash-cap before/after warning *before* the courier confirms ("بعد الشحن
    يصير بيدك 93,500 من 75,000") (`followups-topup-found.png`).
12. **Chat quick replies** in real courier speech ("ما دا ألگى البيت، دزلي لوكيشن")
    (`partner-chat-customer-thread.png`).

---

## 5. Findings

Severity: **P0** broken or unsafe · **P1** hurts earnings, trust or safety · **P2** below best in
class · **P3** polish. Effort: **S** < 1 day · **M** 1–3 days · **L** > 3 days or cross-app/API.
Screenshots are in the capture folder (§1).

| ID | Sev | Screen | Screenshot | Evidence | Why it matters + benchmark | Recommendation (tokens, components, Iraqi copy) | Effort |
|---|---|---|---|---|---|---|---|
| P-01 | **P0** | Offer (native) | `audit-offer-t15.png` | `src/lib/alert.native.ts` `playOfferChime(){}` is a no-op (TODO). `haptics.ts` maps `heavy` to one `impactAsync`, a single short tick. There's no `Vibration` pattern and no keep-awake (`grep keep-awake` finds nothing). | With the phone in a mount or pocket on a noisy road, a 15–20 s offer with no sound is a missed offer. That costs earnings and counts against acceptance. Uber, Dasher, Careem and Talabat all loop a loud tone plus a vibration pattern until answered, and keep the screen on while online. | Add `expo-av`. Loop `offer.wav` at max volume (`playsInSilentModeIOS`, `shouldDuckAndroid:false`) until answered or expired. Run a `Vibration.vibrate([0,600,300,600], true)` pattern; cancel both on answer. Add `expo-keep-awake` while online or on a job. Add a "جرّب صوت الطلب" test in الحساب (S-8). | M |
| P-02 | **P0** | Job / الرجعة / private ride / خطوط | `core-job-to-pickup.png` | `app/job.tsx:195`: the SOS `IconButton` shows `partner.stub_toast`. `accessibilityLabel="SOS"` is English. There is no SOS at all on `intercity/departure`, `intercity/request` (private ride) or `khat`. | The scoring and safety spec §3 requires a 3-second hold, a dispatcher red alert, live location and an emergency contact on every active trip. A stub that says "soon" at the worst moment is worse than no button. Uber and Careem keep a safety toolkit on every trip. | Build a shared `SosButton` in `@driver/ui`: 3 s hold with a radial fill in `colors.danger`, haptic every second, and a confirmation sheet "وصلنا تنبيهك. الديسباتشر يشوف موقعك هسة ويتصل بيك" (voice spec #26). Mount it on job, departure, private ride and khat. Label it "طوارئ". Until the API exists, hide the button rather than show a stub. | L (API) |
| P-03 | P1 | Offer | `core-offer.png`, `audit-offer-t05.png` | `offer.tsx`: decline and accept sit in one row (`flex:1` / `flex:2`). In RTL, ارفض lands bottom-right, the natural right-thumb spot, at the same 56-px height. No confirm, no reason. | Accidental declines lower acceptance (20 % of the index) and cost money. Dasher and Uber make Accept a full-width hero and Decline a small secondary control away from the thumb. | Make Accept full width (`Button size="lg"`, min 64 px, `radius.xl`) with the countdown filling the button itself. Move decline to a small outline chip at the top start: "مو هسة" with `icon="x"`, ≥ 44 px. After a decline, show a 3-second toast with optional one-tap reasons ("بعيد"، "الكاش هواي"، "مشغول") that feed dispatch. | S |
| P-04 | P1 | Offer | `small-offer-food.png`, `small-offer-batch.png` | At 360×740 the 300-px map plus the hero push drop-off and the cash row ("تستلم كاش 18,000") below the fold. On a batch offer the pickup sits under the bottom bar. No total time or total km is shown, only "يبعد 0.6 كم" and "المشوار 2.8 كم". | A 15-second decision can't involve scrolling. Uber shows fare, total minutes and miles on one line; Bolt and Careem show pickup ETA and trip length up front. "يبعد 0 كم عنك" reads like a bug. | Shrink the map to `min(220, 28vh)` on compact heights. Add one summary line under the pay: "1,000 دينار · 3.4 كم · ~14 دقيقة" (`variant="title"`, tabular). Move the cash chip into the summary row (`warningTint`). Show "جنبك" when under 0.1 km. Fold the single-component pay line into a "تفاصيل" disclosure when there is only one component. | M |
| P-05 | P1 | Home, earnings cash card, hand-over sheet | `core-home-offline.png`, `earnings-day-full.png`, `earnings-handover.png` | Home bar: 68,500 of 75,000 (91 % fill) is **green** because the tone follows `owedIqd` while the fill follows `heldIqd` (`HomeParts.tsx` `CashBar`). Earnings: "الكاش بيدك 82,500 · بذمتك للشركة 67,500 · اقترب من سقف الكاش (90%)" while he is 7,500 over the cap in hand. The hand-over sheet shows a code and "الكاش بيدك 82,500" but not how much to hand over. | Low-literacy drivers read bar length and colour, not footnotes. A 91 %-full green bar says "fine". Careem Captain shows one figure ("you owe X"), a coloured state and a settle CTA. | Lead with one number: "لازم تسلّم 67,500 دينار" (heading). The bar tracks only what counts against the cap; tone from the same number (success < 80 %, warning ≥ 80 %, danger ≥ 100 %). Move "بيدك 82,500" to a secondary line explaining the difference ("منها 15,000 للمطاعم"). In the sheet, put the amount above the code: "سلّم 67,500 دينار لموظف العمليات". Make the copy follow the state: "صرت فوگ السقف" instead of "اقتربت" when over. | M |
| P-06 | P1 | Job done | `core-job-done.png` | `DonePanel` shows "خلصت الطلب · +1,000 دينار لحسابك · رجوع للرئيسية". The courier had 68,500 and just took 14,000, so 82,500 against a 75,000 cap. The next demo offer failed with "Cash cap reached" and the screen never told him. | This is the peak-end moment of every job, and it is also the moment the courier finds out he can't work. Dasher's post-delivery screen shows earnings, the next step and any account blocker. | Add a cash line under the earning: "بيدك هسة 82,500 من 75,000" with the cap bar. When over the cap: a `dangerTint` card, "صرت فوگ السقف. الطلبات توقفت لحد ما تسلّم 7,500 دينار", plus a "سلّم الفلوس" button opening the hand-over sheet. Otherwise auto-return home in 4 s ("نرجعك للطلبات…", cancelable). See S-3. | S |
| P-07 | P1 | Job (pickup) | `core-job-at-pickup.png` vs `partner-chat-customer-thread.png` | The pickup step shows "مطعم خالد · شارع 30" and prep state. There's no ticket number, item count or bag count; `PartnerJobStop` carries no ticket field. The chat header does show "طلب #8", and the kitchen calls out "#1284" (`orderTicketNumber`). | Wrong-bag pickups are a top cause of disputes, and batch offers make two bags from the same kitchen likely. Dasher, Swiggy and Talabat show the order number (and customer first name or items) at pickup. | Add `ticketNumber` and `itemCount` to `PartnerJobStop` (an additive contract change). Show a large ticket chip on the pickup step ("#1284", `display` variant, tabular, `surfaceSunken`) and "3 أصناف · طابق الرقم ويا المطعم". In a batch, show both tickets with "كيس 1 / كيس 2". | M (API) |
| P-08 | P1 | Job / ride / الرجعة | `core-job-at-pickup.png`, `intercity-departed.png` | `job.tsx`: `استلمت الطلب`, ride `انتهت الرحلة` and الرجعة `وصلنا` are single-tap `Button`s with no undo. Pickup is allowed while `job-wait-ready` says "الطلب بعده يتحضّر". | A pocket tap or a mount bump marks the food picked up: the kitchen board drops the order and the customer reads "بالطريق". Uber's slide-to-confirm for trip start and complete exists for exactly this. | New `SlideToConfirm` in `@driver/ui` (72 px track, `accent`, thumb ≥ 58 px, RTL direction-aware, haptic at 50 % and 100 %, `reduceMotion` fallback to a 0.9 s hold). Use it for استلمت، سلّمت، انتهت الرحلة، انطلقنا، وصلنا. Keep "وصلت" a tap. When the kitchen still says preparing: "المطعم بعده ما خلّص. متأكد استلمت؟" in the slide label. Offer a 5 s "تراجع" toast where the API allows a revert. | M |
| P-09 | P1 | Home, job (connectivity) | `audit-home-offline-network.png`, `audit-job-action-offline.png` | After 16 s offline, home still shows the green dot and "شغّال، ندورلك طلب"; the connection strip only appears on `status.isError`. On web, React Query pauses queries offline, so it never errors. No NetInfo. On the job, the action button spins indefinitely with no network. | On patchy 4G this is the most common silent failure: the driver believes he is getting offers. Uber and Careem show a red "you're offline" bar within seconds and queue trip events. | Add `@react-native-community/netinfo`, wire it to React Query's `onlineManager`, and add a `ConnectionStrip` on home and job: `dangerTint`, icon `wifi-off`, "النت مقطوع، ما توصلك طلبات. نرجعك أول ما يرجع" plus "آخر تحديث قبل 40 ثانية". Turn the status dot grey. Queue trip actions offline (they already carry `occurredAt`): mark the step done, show "محفوظ، يندز أول ما يرجع النت" (`warningTint`), and replay in order. | M |
| P-10 | P1 | Earnings | `audit-earnings-error.png` | With `driverAccount.*` failing, the hero shows "0 دينار · ماكو ربح بهالفترة" and the cards stay skeletons forever (`earnings.tsx` has no `isError` branch). | A false zero on an earnings screen is a trust breaker ("وين فلوسي؟"), and drivers phone support. | Add an error state: keep the last good view if there is one, plus a strip "ما گدرنا نحدّث أرباحك. فلوسك محفوظة"; with nothing cached, `EmptyState` with "جرب مرة ثانية". Never render 0 on error. | S |
| P-11 | P1 | Earnings | `earnings-week.png`, `small-earnings.png` | `percentChange(current, prev.totals.netIqd)` compares a partial period with a full one: Sunday morning shows "88% أقل من الأسبوع الفات"; 9 am shows "10% أقل من أمس". | Built-in negative framing every morning and every Sunday is demotivating and inaccurate (a mental-accounting trap). | Compare like with like: "لحد هسة أمس: 12,000 · إنت فوگه بـ 2,000" (same hour or same weekday-to-date). Hide the pill until 2 hours (day) or 1 day (week) of data. Down arrows only for completed periods. | S |
| P-12 | P1 | Welcome, not-partner (activation) | `core-welcome.png`, `core-not-partner.png` | No in-app driver sign-up. "Not a partner" says "إذا رفعت أوراقك، نراجعها" but the app has no way to upload them, so the only action is WhatsApp. Ops onboarding is merchant-only (`ops-onboard-shop.png`). The spec (scoring §2) puts driver onboarding in Partner (~10 min). | The welcome sells "اشتغل بوقتك، وربحك واضح" and then dead-ends. Every benchmark lets a driver apply in-app with a progress checklist. | Add "سجّل كشريك" on welcome. Run a 6-step checklist (S-8): الاسم → سيلفي → الهوية وجه/ظهر → المركبة واللوحة → المناطق والأوقات → مراجعة. Reuse `DocumentParts` upload and `CheckInParts`. Show progress ("خطوة 3 من 6") and a 24-hour expectation with a WhatsApp confirmation. Turn "not partner" into the checklist start. | L |
| P-13 | P1 | Job (ride, cash) | `core-offer-ride.png` | `job.tsx` `advance()` opens the hand-over panel only when `!ride`. A cash ride completes with `handover: {}` and the server assumes the full fare was collected (`orders.service.completeRide`). | The driver is never prompted to collect, and the ledger counts the cash against his cap anyway. Careem Captain has a dedicated "collect cash" step with the amount and change. | Reuse `HandoverPanel` for cash rides: "استلم 2,500 دينار من الراكب" → "استلمت 2,500 دينار" (slide). No photo for rides. | S |
| P-14 | P1 | الرجعة departure, private ride, خطوط | `intercity-departure-full.png`, `intercity-ride.png`, `khat-run-full.png` | No call or message for riders or guardians (only `job.tsx` uses `useMaskedCall`). The late meter shows "حسين متأخر 12 دقيقة" with no way to reach him. | At a garage the first move is to call the late rider. Careem and Uber always expose masked call. | Add a 44-px phone `IconButton` per rider row (departure riders, private ride, khat stop guardians) through `chat.requestCall` (a new masked-call scope). On the late-meter card add "اتصل بحسين". | M (API) |
| P-15 | P1 | خطوط run | `khat-run-full.png`, `khat-absence.png`, `khat-done.png` | Substitute-offer cards ("أغطّي الخط", "باقي 1 دقيقة") sit **above** the driver's own active run, duplicated in the demo. No child photo at boarding; no guardian contact; no end-of-run seat check; "مريم ما يروح اليوم؟" is offered after she boarded (`khat.reportAbsence` 409). | Distraction while driving children, and the forgotten-child risk, are the two safety failures that end school-route businesses. Best-in-class school transport adds a post-trip "child check" sweep and photo-verified boarding. | Hide substitute offers while a run is active (or reduce them to a quiet badge). Child photo on each row (the guardian already provides it) with "صعد" as a 56-px button. Remove "غايب؟" once boarded. Before "خلص خط اليوم", require a two-step check: "تأكد ما بقى طفل بالسيارة · باوع للمقاعد الورا" → slide "تأكدت، السيارة فاضية". Add a guardian call per stop. See S-6. | M |
| P-16 | P1 | الرجعة announce | `intercity-announce-full.png` | `partner.ic_announce_lowfill`: "قبل الحركة بنص ساعة إذا أقل من 3 مقاعد محجوزة، الطلعة تنلغي". The rule was amended 2026-10-04 (dispatch spec §3): never before T−10, and a short-notice car is judged at its hard latest departure. Apps review #12 left this open. | Stating the wrong cancellation rule makes drivers avoid announcing late, which is exactly the walk-up supply the amendment protects. | Copy: "إذا ما وصلت 3 مقاعد، الطلعة تنلغي قبل الحركة بـ10 دقايق بس، والركاب ينتقلون لأقرب سيارة. إذا أعلنت قبل أقل من نص ساعة، ننتظر لآخر حد للحركة". Make it vary with the chosen time (show the actual cut-off time). | S |
| P-17 | P1 | Check-in (failed, locked) | `earnings-checkin-failed.png`, `earnings-home-locked.png` | "ما طابقت الصورة · باقيلك محاولة وحدة · محاولة 2 من 2" doesn't say that failing locks him out for the day. Locked: "فريق العمليات راح يتصل بيك" with no reason, no time, and a stubbed WhatsApp button. | A whole day's earnings ride on this one photo. Telling the consequence honestly is a regret-aversion fix, not a threat. Uber's Real-Time ID check gives concrete tips before the retry. | Before the last try, a `warningTint` card: "هاي آخر محاولة اليوم. إذا ما طابقت يتوقف شغلك لباچر. شيل الخوذة والنظارة، ووگف بالضو". Locked: say why ("الصورة ما طابقت مرتين"), say when ("نتصل بيك خلال ساعة"), and give a working call button for the ops number from config. | S |
| P-18 | P1 | Job | `core-job-to-pickup.png`, `core-job-at-pickup.png`, `core-job-to-dropoff.png` | `TopUpEntry` shows "الزبون يريد يشحن محفظته" on every step of every courier job (`canTopUpOnJob` is role-based, not request-based). | It reads as an actual customer request, and it takes the prime slot under the contacts on each step. | Rename it to "شحن محفظة زبون" and move it into a "أكثر" overflow at the bottom of the job. Highlight it only when the customer actually starts a top-up (push from the customer app), with "علي يريد يشحن 25,000 دينار". | S |
| P-19 | P2 | Offer (batch) | `core-offer-batch.png` | "طلب على طريقك (70%)" is jargon (70 % of what?). No combined total and no added minutes for the first customer (spec: second pickup adds ≤ 4 min). | Trust comes from showing the trade: Uber's "add-on trip" shows the extra pay and extra time. | Lines: "طلب ثاني على طريقك +700 دينار", "مجموع الطلبين 1,700 دينار", "يزيد 4 دقايق على الطلب الأول". Drop the percentage or explain it: "70% من أجرة توصيله". | S |
| P-20 | P2 | Global toasts | `core-offer-batch.png`, `small-home-online.png` | The decline toast covers the next offer's cash row. The "شغّال" toast covers the stop switch. | Toasts over primary controls during time pressure hide information or block taps. | Place toasts at the top under the status bar on work screens (`Toast` placement prop), or above the action bar with `bottomInset`. Clear toasts when an offer arrives. | S |
| P-21 | P2 | Map, offer ring, bars (sunlight) | `core-home-offline.png`, `audit-offer-t15.png` | Zone labels in muted text on cream are about 2.5:1. The orange ring arc on white is 2.6:1 and the cash and earnings bars on cream 2.5:1 (computed). The home map shows nothing actionable (no demand heat), and the food-offer map doesn't frame the drop-off. | Direct sun washes out sub-3:1 graphics; work apps aim for 7:1 on key numbers. Uber, Bolt and Careem shade surge and busy areas on the map. | Ring track `border` and arc `accentText #9A5200` (5:1) until 5 s, then `danger`. Bars: `accentText` or `primary[700]` on cream. Map labels `text` with a 2-px cream halo. Tint busy zones with `accentTint` at 40 % from `partner.status.demand` and outline them. Fit the offer camera to self + pickup + drop-off. | M |
| P-22 | P2 | الرجعة board, requests | `intercity-board-full.png`, `intercity-request-offer.png`, `intercity-ride.png` | "كراج البوابة ٢" and "كراج البوابة ١" in Eastern digits on the board, requests and private ride; "كراج البوابة 2" on announce. Source: `packages/map/src/garages.ts`, `packages/db/prisma/seed-data.ts` (review #23 left open). | It breaks the voice rule (Western digits) and the same garage reads two ways on two screens. | Normalise at the source (`@driver/map` garages and the DB seed) to "1/2", and update the tests that pin the old names. | S |
| P-23 | P2 | الرجعة board | `intercity-board-full.png`, `small-intercity-board.png` | Seat bars use orange, blue, white and green with no legend; the meaning lives only in the line below ("1 صعدوا · 1 من الكراج"). | Colour-only state fails colour-blind and low-literacy readers. | Put an icon inside each pill (check = boarded, garage = walk-up, person = booked, empty outline = free) and a one-line legend under the first card. Keep the colours. | S |
| P-24 | P2 | الرجعة departure | `intercity-departure-full.png`, `intercity-walkup-panel.png` | One 4,560-px scroll: status checks, late meter, seat map, PIN pad, riders, route, departure. | At the garage a driver alternates between PIN entry and seats 7 times per car. Scrolling between them is the bottleneck. | Garage mode (S-5): the seat map fills the screen; tapping a booked seat opens a PIN sheet for that rider; tapping an empty seat opens the walk-up sheet. Riders and route move to a second tab. Keep the "انطلقنا" slide pinned. | M |
| P-25 | P2 | Offer missed / declined | `audit-offer-missed-home.png` | A missed offer shows only "فات الطلب". Nothing says it counts as ignored (timeout is 10 % of the index). | The scorecard later penalises something the moment never explained. Dasher states the effect on acceptance rate. | Toast: "فات الطلب، ينحسب ما رديت عليه" with a link "شلون ينحسب؟" to the scorecard metric. No loss-framing of the money. | S |
| P-26 | P2 | Unreachable | `core-job-unreachable.png` | The panel replaces the job body, so the call and message buttons disappear while waiting. The disabled "انتظر 4:56" is white on a pale red (≈ 2:1). | The driver needs to keep calling during the 5 minutes. | Keep `QuickAction` call and message under the timeline. Disabled state: `dangerTint` background, `dangerText` label. | S |
| P-27 | P2 | الحساب, home (multi-role) | `core-tab-account.png`, `fleet-overview.png`, `fleet-driver.png` | Account has check-in, documents and scorecard only; no help or support, vehicle, sound and notification check, language, or shift preferences. Fleet and ops appear only as "more" rows. Fleet alerts never reach home. The fleet driver detail has no call. | A driver who also owns cars has to remember to look. Grab and Careem put a role switcher and a help centre on the profile. | Account: add "مساعدة ودعم" (call ops, WhatsApp, FAQ), "مركبتي", "صوت الطلبات" (test) and "اللغة". For multi-role: a segmented "سايق / أسطولي" at the top of home, plus a fleet alert chip ("2 سواق فوگ السقف"). Fleet driver: call button and "سجّل استلام كاش" shortcut. | M |
| P-28 | P2 | Job contacts | `core-job-at-pickup.png` | "اتصال" calls the kitchen at pickup and the customer otherwise; the label never says which. | Calling the wrong party wastes a minute and annoys customers. | Dynamic label: "اتصل بالمطعم" / "اتصل بالزبون", with the icon tinted to match the target. | S |
| P-29 | P2 | Home gates | `earnings-home-doc-expired.png`, `earnings-home-checkin-needed.png` | "عندك مستمسك منتهي · جدّده حتى تشتغل" doesn't name the document. The locked switch is not itself tappable to fix. | Recognition over recall: one tap should go straight to the fix. | "إجازة السوق انتهت يوم 2 تشرين الأول". Make the whole locked switch open `/checkin` or `/documents`. | S |
| P-30 | P2 | Earnings day chart | `earnings-day-full.png` | Hour labels "12 3 6 9 12 3 6 9" without ص/م; "أحسن وقت: الساعة 3". | Ambiguous for planning tomorrow's shift. | Labels "12ص 6ص 12ظ 6م"; "أحسن وقت: 3 العصر". | S |
| P-31 | P2 | خطوط rows | `khat-run-full.png` | "غايب؟" is an underlined text link (hitSlop 8) right under the name, next to the صعد button. | Mis-taps during a fast stop. | Turn it into a 44-px secondary chip at the row end; hide it once boarded. | S |
| P-32 | P2 | الرجعة requests | `intercity-request-stranded.png`, `intercity-request-offer.png` | A women-only request ("نساء") can be bid by any driver, with no eligibility signal. The take shows 8 % here and 10 % on seats with no explanation. | The family-option spec (scoring §4) routes these only to vetted drivers. Two take rates without a reason erode trust. | Show "إنت مؤهل لرحلات العوائل ✓" (check icon) or hide the request. One line on the take: "خاص: حصة درايفر 8% (أقل من المقاعد)". | S |
| P-33 | P2 | Home error | `audit-home-error.png` | The "ماكو نت" error uses a phone icon; network loss and server failure share one copy. | The icon misleads low-literacy users. | `wifi-off` icon for network loss; a server error reads "عدنا مشكلة، جرّب بعد شوي". | S |
| P-34 | P2 | Headers | `fleet-driver.png`, `intercity-announce-full.png` vs `core-job-to-pickup.png` | Stack headers draw "←" at the right; job and chat use the chevron ">". Same action, two glyphs. | Consistency; in RTL, back points to the start side. | One `BackButton` (`chevron-back`, auto-mirrored) used by the Stack `headerLeft`. Verify on device with `I18nManager.forceRTL`. | S |
| P-35 | P3 | Keypads | `intercity-pin-typing.png`, `ops-cash-amount.png` | Backspace is bottom-left on the departure PIN pad and bottom-right on the ops pad. | Muscle memory across screens. | One `NumberPad` in `@driver/ui` (backspace on the end side, 64-px keys). | S |
| P-36 | P3 | Copy | `ops-home.png` | `partner.ops_action_cash_sub` "من مندوب" and `ops_rcpt_another` "من مندوب ثاني"; `copy.test.ts` bans only "المندوب". | Voice guide: الدليفري. | "من دليفري، برمزه اليومي". Extend the test to the bare form. | S |
| P-37 | P3 | Copy grammar | `intercity-board-full.png`, `small-offer-batch.png`, `khat-absence.png` | "تطلع بعد 4 ساعة و34 دقيقة"; "يبعد 0 كم عنك"; "مريم ما يروح اليوم؟". | Natural Iraqi plurals; no gender guesswork (voice §3). | "4 ساعات و34 دقيقة"; "جنبك"; "{name}: غياب اليوم؟". | S |
| P-38 | P3 | Motion and accessibility | code | `ThemeProvider` `reduceMotion` defaults to false and isn't wired to `AccessibilityInfo`. The offer ring doesn't announce seconds to screen readers. | Respect OS settings; TalkBack users get nothing as the timer runs. | Read `AccessibilityInfo.isReduceMotionEnabled()`. `accessibilityLiveRegion` on the ring value at 10 and 5 s ("باقي 5 ثواني"). | S |
| P-39 | P3 | Job done | `core-job-done.png` | A bare check and "رجوع للرئيسية". | Peak-end: the end of each job is the habit loop. | See S-3. | S |
| P-40 | P3 | Online switch | `core-home-offline.png` | The offline pill has a thumb and arrow (a slider affordance) but is a tap. | A driver may try to swipe; it still works, but the affordance lies. | Either make it a real slide (P-08's `SlideToConfirm`) or drop the thumb and keep a big tap button "ابدأ الشغل". | S |
| P-41 | P3 | Scorecard | `earnings-scorecard-full.png` | Target and Silver ticks are unlabeled on the bars. The rating bar is blue while the other "تمام" bars are green. | Data-viz: colour follows status consistently. Ticks need labels. | Small labels under the ticks ("الهدف"، "فضي"). Status colour for every bar. | S |

Counts: **P0 2 · P1 16 · P2 16 · P3 7** (41 findings).

---

## 6. Signature moments (build-ready)

Visual direction for all eight: work-tool calm. Ink on cream, orange only for "act now", and the
one bold element on each screen is the number the driver acts on. Motion only answers his actions
or the clock.

### S-1 The 2-second offer card
```
┌──────────────────────────────┐  map 220 px (compact) / 300 px
│ [مو هسة ✕]          طلب جديد ● │  decline chip top-start, 44 px
│        map: self → pickup → drop (camera fits all 3)
├──────────────────────────────┤
│ 1,000 دينار                   │  display 56, tabular, ink
│ 3.4 كم · ~14 دقيقة · كاش 18,000│  title; cash chip warningTint
│ ● مطعم خالد · شارع 30 · جاهز بعد 9 د
│ ■ الزبون · زاكور               │
│ ليش إنت؟ أقرب دليفري (0.6 كم)  │  footnote, textMuted
├──────────────────────────────┤
│ [████████ اقبل · 15 ████░░░░] │  full width 72 px; fill = time left
└──────────────────────────────┘
```
- Sound and vibration loop until answered (P-01). At ≤ 5 s the button fill turns `danger` and the
  haptic `warning` repeats every second.
- Accept is a tap (speed). The chip-placed decline is the friction.
- "ليش إنت؟" comes from dispatch ranking (distance, tier, load), shown honestly.
- Components: `OfferCard`, `CountdownButton` (new, in `@driver/ui`), `MetaChip`.

### S-2 Cash at the door with change helper
- Amount to collect at display size, then: "الزبون دفع:" chips [15,000] [20,000] [25,000]
  [50,000] [غير] → "رجّعله 6,000 دينار" in `successText`.
- Optional "حط الباقي بمحفظته" when the customer agrees. Careem pioneered the change-to-wallet
  pattern; here it reuses the top-up rails.
- Slide "استلمت 14,000 دينار" (P-08). Then the cap bar animates from 68,500 to 82,500, and turns
  danger past the cap with the settle CTA (P-06).

### S-3 End of job (peak-end)
- A green check scales in, "+1,000 دينار" counts up, and a ring fills "اليوم 15,000 · 7 طلبات".
- The cash line and cap state (P-06). If he's over the cap, a settle card replaces auto-return.
- Otherwise auto-return in 4 s: "نرجعك للطلبات…" with a "خليني هنا" escape. The demand chip
  ("الطلب عالي بالمركز") gives the next goal.
- Goal-gradient, used honestly: show progress toward a real configured bonus ("باقي طلبين على
  مكافأة 2,000"), never an invented target.

### S-4 End-of-shift summary (on hold-to-go-offline)
- Online time, jobs, net, **per hour** ("3,750 دينار بالساعة"), tips, best hour, cash to hand over
  today with the code button, and tomorrow's busiest window from last week's data.
- A share-to-WhatsApp image of the day (drivers already share screenshots) with the brand mark.
- Shift-end is also where a single nudge goes (one scorecard item below the Silver line), never
  more than one.

### S-5 الرجعة garage mode
- The full-screen seat map is the page. Seat states carry icons and a legend (P-23).
- Tap a booked seat → PIN sheet for that rider (`NumberPad`, 64-px keys) → seat turns
  "صعد ✓" with a haptic.
- Tap an empty seat → walk-up sheet (رجال / نساء / عائلة, cash amount).
- Late rider seat: red with "متأخر 12 د · اتصل" (P-14) and the meter "إلك 1,000".
- Bottom: a slide "انطلقنا" that names the blocker when locked ("3 ركاب بعدهم").
- Riders, route and money move to a "التفاصيل" tab.

### S-6 خطوط child-safe run
- Header: "بالسيارة 2 · وصلوا 0 من 5 · غايب 1" as big tabular chips.
- Rows show the child's photo, name and the guardian call icon. "صعد" is a 56-px button; once
  boarded the row shows the time and the absence chip disappears.
- Substitute offers are suppressed during the run (P-15).
- Finish: a two-step "تأكد ما بقى طفل بالسيارة" sweep. A short illustration of the back seats, then
  a slide "تأكدت، السيارة فاضية". It is logged for ops.
- Guardians get "{child} وصل {place} بالسلامة الساعة {time}" (voice spec #21).

### S-7 "Why was I paid this" receipt
- Any job in earnings opens a receipt: each component with its `quote.reason.*` line ("الجو مطر،
  الدليفري يستاهل"), the take rate, cash taken and where it went, and the ticket number.
- "عندي اعتراض" opens a prefilled support chat with the job attached. This is the trust loop that
  Uber's trip receipts and Dasher's "pay details" provide.

### S-8 Readiness and activation checklist
- **New drivers**: a 6-step checklist from welcome (P-12) with progress, resumable, each step
  reusing the existing document and selfie parts, ending "حسابك بالمراجعة، نرد عليك واتساب خلال
  24 ساعة".
- **Every shift**: "جاهز تستلم طلبات" above the switch, with GPS ✓ · النت ✓ · صوت الطلبات ✓ ·
  البطارية 64 %. Any red item explains itself and links to the fix ("الصوت مطفي، شغّله حتى ما
  يفوتك طلب"). This is the first thing a low-literacy driver can read at a glance.

---

## 7. Top 15 — do next (ranked)

| # | Do | Findings | Effort |
|---|---|---|---|
| 1 | Loud looping offer sound, vibration pattern and keep-awake on native | P-01 | M |
| 2 | Real SOS (3 s hold) on every active trip, or hide the stub | P-02 | L |
| 3 | Connectivity: NetInfo, offline strip, queued trip actions | P-09 | M |
| 4 | Offer ergonomics: full-width accept with timer fill, small decline away from the thumb | P-03 | S |
| 5 | Cash clarity: one "لازم تسلّم" number, honest bar tone, amount on the hand-over sheet | P-05 | M |
| 6 | Done screen: cash and cap state, settle CTA, auto-return | P-06, P-39 | S |
| 7 | Ticket number and item count at pickup | P-07 | M |
| 8 | `SlideToConfirm` for pickup, deliver, ride end, depart and arrive | P-08, P-40 | M |
| 9 | Offer fits above the fold on 360×740, plus a total km and minutes line | P-04 | M |
| 10 | Earnings error state (no false zero) and fair comparisons | P-10, P-11 | S |
| 11 | خطوط safety: no substitute offers mid-run, child photo, end-of-run seat check | P-15 | M |
| 12 | Masked call on الرجعة, private ride and خطوط | P-14 | M |
| 13 | Cash confirm on cash rides | P-13 | S |
| 14 | Copy fixes: low-fill rule, last check-in try, top-up entry, batch "(70%)", "مندوب", digits | P-16, P-17, P-18, P-19, P-22, P-36, P-37 | S |
| 15 | Driver self-onboarding checklist | P-12 | L |

---

## Appendix A — screenshot index (by flow)

- **Sign-in**: `core-welcome`, `audit-phone-empty`, `audit-phone-filled`, `audit-otp`,
  `audit-otp-wrong`, `core-not-partner`
- **Home**: `core-home-offline`, `core-home-online`, `core-home-intercity`, `core-home-khat`,
  `earnings-home-checkin-needed`, `earnings-home-locked`, `earnings-home-doc-expired`,
  `earnings-home-unlocked`, `audit-home-loading`, `audit-home-error`,
  `audit-home-offline-network`, `small-home-offline`, `small-home-online`
- **Offer**: `core-offer`, `core-offer-batch`, `core-offer-ride`, `audit-offer-t15`,
  `audit-offer-t05`, `audit-offer-t01`, `audit-offer-missed-home`, `small-offer-food`,
  `small-offer-batch`
- **Job**: `core-job-to-pickup`, `core-job-at-pickup`, `core-job-to-dropoff`,
  `core-job-at-dropoff`, `core-job-cash`, `core-job-done`, `core-job-unreachable`,
  `audit-job-action-offline`, `small-job-to-dropoff`, `small-job-cash`, `followups-job-topup-entry`,
  `followups-topup-*`, `partner-chat-*`
- **Earnings and account**: `core-tab-earnings`, `earnings-day*`, `earnings-week*`,
  `earnings-month-last`, `earnings-statement-*`, `earnings-handover`, `earnings-scorecard*`,
  `earnings-documents-*`, `earnings-upload-*`, `earnings-checkin-*`, `core-tab-account`,
  `audit-earnings-error`, `small-earnings`
- **الرجعة**: `intercity-*`, `small-intercity-board`
- **خطوط**: `khat-*`, `small-khat-run`
- **Fleet**: `fleet-*`, `followups-fleet-*`, `followups-invite-*`
- **Ops**: `ops-*`

## Appendix B — capture notes for whoever runs this next

- **Metro in a worktree**: `apps/partner/metro.config.js` block-lists `.claude`, so `expo export`
  fails inside `.claude/worktrees/*` ("Unable to resolve … expo-router/entry.js"). I exported with
  that entry removed locally and restored the file. Consider matching only nested `.claude` folders
  under the workspace root.
- **`web-shots.mjs` fails on its own today**: the push pre-prompt ("لا يفوتك طلب") opens on home
  and intercepts the first `online-switch` click. Set `driver.partner.push-preprompt` in an init
  script, or dismiss `push-preprompt-later` in `signIn`. Also, `waitUntil: 'networkidle'` never
  settles once signed in (the live SSE stream), so `goto` and `reload` time out; `load` plus a short
  settle works.
- **Demo state accumulates**: re-running `core` against the same API puts the courier over his cap,
  and `/demo/job` then fails with "Cash cap reached". OTP requests are rate-limited per phone
  (429), so run groups against a fresh API.
- `khat` logs a 409 on `khat.reportAbsence` (absence for a child who had already boarded; see P-15).
- **Outside partner scope, seen in the API log**: the WhatsApp boarding pass sends raw seat keys
  ("مقعد rear_left، rear_middle") to customers. `wa.rajaa_boarding_pass` needs the seat labels.
