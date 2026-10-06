# Live moments audit: tracking, chat, share, SOS, taxi and tuktuk

Slice 3 of the customer-app design audit · 2026-10-05 · audit only, no repo files touched.

**Evidence.** The capture run's screenshots are in `scratchpad/audit/shots/` (`track-*`, `ride-*`, `chat-*`, plus `food-waiting`). I recorded my own live sequences on the private copy (:8190 / :3210) in `scratchpad/audit/shots-extra/live/`, with contact sheets in `shots-extra/sheet-*.png`. The sequences are: first open (4 frames, 350 ms apart), courier glide (12 frames, 450 ms), sheet drag (8 steps plus release), near → door → delivered burst (12 frames, 80 ms), reopening a delivered order, low rating, every degraded state, offline, the SOS hold (8 frames, 450 ms) and its sheet, the public share page, and a live tuktuk search (58 s).

**Code read.** `app/order/[id].tsx` and `features/track/*` (moments, story, AlmostThere, Arrival, SheetParts, TrackMap, map/Overlay, timeline). Also `features/ride/LiveParts`, `features/notify/*`, `features/safety/SosControl`, `app/share/[token].tsx`, `lib/sound.ts`, `packages/ui/motion` and the tokens.

**Skills applied.**
- `design:design-critique` gave the structure.
- `marketing-psychology` supplied the lenses: peak-end, goal-gradient, Zeigarnik, operational transparency (labour illusion), reciprocity and loss aversion.
- `design:accessibility-review` covered reduce motion, live regions and tap targets.
- `vercel-react-native-skills` guided the feasibility notes: animate transform and opacity only, keep work on the UI thread, and stay within a budget for low-end Android.

**Limits.**
- Haptics and sounds can't be observed on web, so I judged them from code.
- The web-search budget was already spent, so the 2025–26 platform notes (Android 16 Live Updates, Live Activities, Material 3 Expressive) come from my own knowledge, not fresh sources.
- Parallel audit runs had used up the OTP throttle on 127.0.0.1. I sent only my OTP request through the LAN address of the same private API.

---

## 1. Joy score and emotional journey

### Joy score: **5.5 / 10 now → 8.5 target**

| Part | Now | Target | One-line reason |
|---|---|---|---|
| Food tracking | 6.5 | 9 | Honest by design: delay credit, cash hand-off, soft cues, moments that fire only on real transitions. The peak is underpowered, it replays on reopen, and the first open is hijacked by a permission sheet. |
| Taxi / tuktuk live | 4.0 | 8.5 | Matching a driver and the driver arriving, the two highest-emotion beats of a ride, are **silent**. The search has no end, and drivers are shown by an initial instead of a face. |
| Chat / share / SOS | 6.0 | 8 | Solid: masked numbers, Iraqi quick replies, view counts, a 3-second hold. But chat loses the live context, the share sheet shows a raw URL, and the SOS sheet's biggest button is "cancel". |

### Emotional journey map

Anxiety runs from 1 (calm) to 5 (spiking). "Lever" points to a finding (`L-xx`) or a signature upgrade (`S-x`).

| # | Stage | Feels now (anxiety) | Should feel | Design lever |
|---|---|---|---|---|
| 1 | Order placed → waiting for kitchen (`food-waiting.png`) | "Did they even get it?" (3). The ring is static and the copy repeats itself. | "They've seen it, it's moving." (1) | `L-26`: say "seen", dedupe the copy, and use this dead time for the push ask (`L-01`) |
| 2 | First open of the live map (`first-open-01.png`, every `track-*.png`) | Hijacked: a permission sheet covers the courier and ETA (3) | "My order is real." The map and the ETA come first (1) | `L-01`, `L-28` |
| 3 | Preparing, 15–30 min of dead time (`state-preparing.png`) | Bored. Opens the app over and over; a thin ring is all that happens (3) | Looked after: something visibly happens, and it's fine to lock the phone (1) | `S-3` kitchen theatre, `S-1` lock screen |
| 4 | Courier assigned / at kitchen | Neutral; just a name in a note (2) | Knows who's coming: photo, name (1) | `L-06` |
| 5 | On the way (`sheet-glide.png`) | Hopeful, but the marker is jammed in a corner and a straight dotted line crosses the Tigris (2) | Anticipation, with minutes they believe (1) | `L-07`, `L-20` |
| 6 | Almost there (`door-00.png`) | The card only appears once he's at the door, and says "قريب" while the status says "عند بابك" (3) | "Get ready": 2 min out, cash amount ready (1) | `L-05` |
| 7 | At the door / unreachable (`state-unreachable.png`) | Panic: a 4:58 ring dominates and the map is dimmed (5) | Guided: "here he is, here's what to do" (2) | `L-10` |
| 8 | Delivered, the **peak** (`sheet-burst.png`) | Pleasant but small. A 0.9 s dot spray, then an empty screen. It replays on every reopen (2) | A warm peak with a person in it, played once (0) | `L-08`, `L-04`, `S-4` |
| 9 | Rating → points, the **end** (`track-rating-points.png`) | Fine but flat: "+21" said three ways, with a wallet icon (1) | Closure and progress: "79 more points to a free delivery" (0) | `L-21`, `S-5` |
| 10 | Ride: where to / choose (`ride-choose.png`) | Efficient, though the vehicle icons are generic (1) | Confident and a little covetable (0) | Keep, plus vehicle art (`S-2`) |
| 11 | Ride: searching (`sheet-ride.png`, 0:01→0:58) | Rising: a stopwatch counts up, there are no cars on the map and no way out except cancel (4→5) | Reassured: "cars are near, we're widening", with a fallback (2) | `L-03` |
| 12 | Ride: driver found (`ride-matched.png`) | **Nothing happens**: no buzz, no sound, no reveal (3) | Peak 1: "لگينالك سايق" with face and plate (0) | `L-02`, `S-2` |
| 13 | Ride: driver at pickup (`ride-at-pickup.png`) | Silent again. If the phone is in a pocket, the free wait ticks away (4) | Clear alarm with plate and car, "طالع هسة" (1) | `L-02` |
| 14 | Ride: on trip (`ride-on-trip.png`) | The call button is the primary action while you sit in the car, and "cancel" is still offered (2) | Safe and calm: share, SOS, progress (1) | `L-16`, `S-6` |
| 15 | Ride: arrived (`ride-arrived.png`) | "وصلت بالسلامة / وصلت بالسلامة" (the same line twice), and "rate in two taps" for a one-step rating (1) | Relief and closure; family told automatically (0) | `L-09`, `S-6` |

**Peak-end verdict.** Today the most intense moments are negative: the permission sheet, the endless ride search, and the unreachable countdown. The positive peak (delivered) is polite and gets cheapened by replays. The end (points) is fine. Rides have no positive peak at all. The highest-leverage work is to:
1. Give rides their two peaks (`L-02`, `S-2`).
2. Turn the anxiety spikes into guided moments (`L-03`, `L-10`).
3. Make delivered warmer and one-time, with a person in it (`L-04`, `L-08`, `S-4`).

This stays inside Ali's decision D5 ("calm, with a few special moments"); it just adds the ride's two moments to that short list.

---

## 2. The roast

1. Rides are a silent movie. The moment a stranger accepts and the moment he's outside your house get **no buzz, no sound and no reveal**. `moments.ts` only knows food: its `BEFORE_ACCEPT` set holds only `waiting_merchant`, and `at_pickup` is never treated as a moment.
2. The first thing a brand-new customer sees after ordering isn't their order. It's a 70%-of-screen sheet asking for notifications, on every open until they answer. (C-23 from the last audit is still open.)
3. The "delivered" peak is 14 dots flying 92 px for 900 ms, then half an empty cream screen. Reopen the order later and the confetti fires again, as if it had just arrived.
4. "الدليفري قريب" shows up when he's already **at your door**, at the same moment the status says "الدليفري عند بابك". The card and the sheet contradict each other.
5. The ride search is a stopwatch with no finish line: 0:58 and counting, an empty map, no nearby cars, no "try a taxi instead". The copy honestly widens the search ("كل السواق بالعزيزية يشوفون طلبك هسة"), and then nothing else happens.
6. A woman booking a tuktuk at night gets "ع" in a circle instead of a driver's face. The collapsed floating card doesn't even show the plate.
7. The route is a dotted straight line drawn across the Tigris. Meanwhile the courier sits in the top-left corner of the frame, because the camera fits courier and door to opposite edges.
8. "شنو ما عجبك" is great, but the delivered moment never shows the courier: you rate "سجاد" without ever seeing his face.
9. The SOS sheet's biggest button is "كنسل". Calling the police is a small text link at the bottom, and the copy speaks of "الديسباتشر".
10. Arabic grammar slips exactly where people stare: "8 دقيقة" on the late banner, "3 دقيقة" and "2 دقيقة" on the map pill, while the same screen says "آخر موقع قبل 3 دقايق".

---

## 3. Findings

Severity: **P1** hurts trust or joy · **P2** below best-in-class · **P3** polish. Screenshots are under `shots/`, or `shots-extra/live/` when prefixed `live/`.

| ID | Sev | Screen | Screenshot | Evidence | Why (principle + benchmark) | Recommendation (build-ready) | Effort |
|---|---|---|---|---|---|---|---|
| L-01 | P1 | First open of the live map | `track-preparing.png`, `track-on-the-way.png`, `live/first-open-01.png` | `PrePromptGate active={live}` opens the shared `PermissionPrompt` about 350 ms after the map appears, over 60–70% of the screen. It shows on every open until answered (snooze only after "بعدين"). Still open from C-23. It also promises "تنبيه قبل ما يوصل الدليفري بدقيقتين", but the near trigger is 500 m straight-line. | Peak-end: it hijacks the most anticipated view. Permission priming works best right after value is shown. Uber Eats asks after the first status update; DoorDash asks inline. | Remove the modal from `/order/[id]`. (a) Food: ask on the waiting-for-kitchen screen as an inline card under the ring. Title "نخبرك أول ما المطعم يقبل؟", body "إشعار لكل خطوة، بدون إزعاج", buttons "إي، خبرني" / "لا هسة". (b) Rides: inline card in the collapsed sheet right after the match. Title "نخبرك لمن يوصل السايق؟", same buttons. Keep the snooze. Point copy: change "بدقيقتين" to "قبل ما يوصل الدليفري" unless `L-05` ships. | S |
| L-02 | P1 | Ride matched and driver at pickup | `ride-matched.png`, `ride-at-pickup.png` | `momentsBetween` fires `accepted` only from `waiting_merchant`, so `searching → to_pickup` triggers nothing. `at_pickup` isn't a moment. `trip.status.accepted` ("السايق {name} قبل مشوارك") exists but is never shown. | The two emotional peaks of a ride are unmarked. With the phone in a pocket, the 3-minute free wait burns silently (loss aversion: paid wait after 3 min). Uber and Careem: match card plus a "Your driver is here" alert with the plate. | Add ride moments `matched` and `driver_here` to `moments.ts` (with tests). **matched**: `haptic('success')` + `accepted` cue; the status line shows "لگينالك سايق: عباس" for 4 s, then "عباس بالطريق إلك"; the float enters with `FadeInUp` on `spring.gentle` and the avatar scales 0.85→1 on `spring.select` (see `S-2`). **driver_here**: `haptic('heavy')` twice, 120 ms apart, + `near` cue + a card over the map. Card title "عباس وصل" with the plate chip at 28 px ("واسط 8841") and "باجاج · أحمر"; primary "طالع هسة" sends `customer_coming_out`, secondary "اتصل". The server push mirrors it: "عباس وصل · باجاج أحمر · واسط 8841". Under reduce motion: instant swap, haptics kept. | S–M |
| L-03 | P1 | Ride searching | `ride-searching.png`, `live/ride-search-27s.png`, `sheet-ride.png` | `SearchCounter` counts up with no ceiling (0:58 in my run). The camera frames the whole route, so the radar at the pickup is tiny. No nearby vehicles. No give-up or fallback state in the customer code, and no `no_driver` copy. | Uncertain waits feel longer than known waits (Maister). Goal-gradient needs a visible finish. Uber shows nearby cars and a progress bar; Bolt and inDrive offer alternatives. | (1) Camera: centre the pickup at zoom 15.5 while searching; radar rings sized by wave (nearest ≈ 600 m, wider ≈ 1.5 km, everyone = whole frame), animated with `withTiming` at `duration.deliberate` on `bezier.decelerate`. (2) Show up to 8 nearby vehicles as top-down icons (spec c10). (3) Replace the count-up stopwatch with three stage dots under the wave line ("1 من 3"), with the counter as small caption text. (4) After the `everyone` stage + 45 s, show an offer card. Title "ما لگينا تكتك فاضي هسة"; body "نجرب تكسي؟ يوصلك بـ 3,000 دينار"; buttons "إي، دورلي تكسي" / "ضل دوّر" / "ألغي (مجاني)". **Needs Ali**: the server give-up time, and whether the switch re-quotes (money stays server-side). | M |
| L-04 | P1 | Arrival replay | `live/reopen-delivered.png` | `arrivalSeen` is component state, so every reopen of a delivered, unrated order replays the full-screen celebration and the success haptic. | A peak repeated becomes noise; it also misleads ("did a second order arrive?"). Apple Wallet and Uber show the celebration once, then a receipt. | Persist `arrival-seen:{orderId}` in `storage`. Show the overlay only on a live transition, or when the screen opens within 10 min of `deliveredAt`. Afterwards open straight to a calm receipt with the rating sheet at detent 1. | S |
| L-05 | P1 | Almost there / at the door | `live/door-00.png`, `live/arrive-00.png` | The card appears only inside `NEAR_DROPOFF_M = 500` straight-line metres (the spec says 300). In the demo it first appeared when the courier was already at the door, reading "الدليفري قريب" while the status line says "الدليفري عند بابك" and the pill says "1 دقيقة". | Contradiction erodes trust; "get ready" must arrive before the knock. Deliveroo: "rider is 2 min away"; Swiggy uses a haptic plus a sound at the approach. | Trigger on whichever comes first: the server's `courier_near` (300 m by road, c5) or `ETA ≤ 2 min`. When `trip.state = arrived_dropoff` and `dropsBeforeMine = 0`, swap the card. Title "حيدر عند بابك" with his photo; body "جهّز 11,500 دينار واطلع له" (or "الطلب مدفوع، بس اطلع له"); `haptic('medium')`; card at 72 px tall with a 2 px accent border, entering on `spring.gentle`. Hide the minutes pill at the door. Pick one value for 300 vs 500 and align the pre-prompt copy. | S |
| L-06 | P1 | Driver identity (rides) | `ride-matched-expanded.png`, `ride-matched.png` | The driver is "ع" in a circle (no portrait). The collapsed `CourierFloat` passes no plate, so the plate is only in the expanded sheet. | At pickup the plate and the face are the safety check. Uber shows the plate largest; Careem shows the captain's photo. | Launch blocker for rides: a portrait at onboarding plus the daily "متحقق اليوم" selfie match (ops); `DriverChip.photoUrl` is already wired. Add `plate` to `CourierFloat` during `to_pickup` and `at_pickup`. Pickup alert per `L-02`. | S (UI) + ops |
| L-07 | P1 | On-the-way map honesty | `track-on-the-way.png`, `sheet-glide.png` | With no road route (`onRoad=false`), a dotted straight line runs from courier to home, across the river. `storyShot` fits courier and door to opposite edges, so the marker sits in the top-left corner. Minutes are shown as a single number. | People notice and screenshot a route through water. The map has to be believable (maps spec goal). Google Maps shows a range when uncertain. | Until SP4 road routing (D3) lands: (1) no straight line across water when `onRoad` is false; draw only a 60 px heading arrow from the courier, plus the home pin; (2) minutes as a range when the basis is an estimate: "6–9 دقايق" (spec c3); (3) frame with the courier centred in the upper 60% and look-ahead toward home (spec c4 "follow with look-ahead") instead of fit-both-to-edges. | S |
| L-08 | P1 | Delivered: the peak | `track-arrival.png`, `live/burst-01..settled.png` | The burst is 14 dots, 92 px reach, 900 ms. The title "وصل طلبك" plus the subtitle "طلبك من مطعم خالد وصل. بالعافية" says "arrived" twice. With no gate photo, about 40% of the screen is empty. The courier is absent. The haptic fires on overlay mount while the cue fires from the moment, so the two aren't synced. "بابك مثل ما حفظته" shows you your own door. | Peak-end: the peak should be warm, personal and synced across senses (sound, haptic and visual on the same frame). DoorDash shows the Dasher and a thank-you; Swiggy uses a delivered haptic. | Choreography, about 1.6 s total (calm per D5): 0 ms fade-in (`duration.base`, decelerate) → 80 ms check scales 0.6→1 on `spring.select` with `haptic('success')` and the `delivered` cue on the same frame → 120 ms a single accent ripple ring 88→200 px, opacity 0.35→0, `duration.deliberate` (keep the dots, 20 dots, 120 px reach) → 220 ms title rises 8 px, `duration.slow` → 400 ms the courier row: avatar, "حيدر وصّلها", heart button "شكراً حيدر" (`S-4`). Copy: title "وصل طلبك", subtitle "بالعافية · من مطعم خالد". Without a photo, fill the space with an order summary card (items, total, "الوصل يوصلك على واتساب"). Replace the self-gate photo with the courier's drop-off photo for leave-at-door orders; otherwise omit it. Reduce motion: no ripple or dots, cross-fade only. | M |
| L-09 | P2 | Ride arrived copy | `ride-arrived.png` | Title "وصلت بالسلامة", subtitle "وصلت بالسلامة". The CTA says "قيّم بلمستين" but rides have one step ("1 من 1"). | Duplication reads as a bug, and a promise of two taps on a one-step rating is wrong. | Subtitle: "ويا عباس · 12 دقيقة" (from the trip's start and complete). CTA for rides: "قيّم عباس"; keep "قيّم بلمستين" for food. | S |
| L-10 | P1 | Unreachable | `track-unreachable.png`, `live/state-unreachable.png` | A full-width panel with a 4:58 ring; the map is dimmed so you can't see **where** he's standing. The actions are "أني هنا جاي" and the masked call. | The most stressful moment, with money at risk ("تنحسب عليك قيمة الطلب"). Guidance beats a timer. Uber: "Driver is waiting at…" with a pin; DoorDash: the Dasher's location plus a photo. | Spotlight him: un-dim a 140 px circle around the marker, with his photo and "حيدر واقف هنا · 40 متر من بابك". Buttons: primary "أني نازل" (sends `customer_coming_out` and a server "responded" flag; **needs Ali** on whether it pauses the 5-min clock), then "اتصل بدون ما يبين رقمك" and "دزله لوكيشني". Shrink the ring to a 56 px chip beside the title. Keep the final-minute copy. | M |
| L-11 | P2 | Timeline stale note | `chat-order-buttons.png`, `live/drag-release-650.png` | After pickup, the completed step "جاهز وينتظر الدليفري" still carries "حيدر بالمطعم ينتظر طلبك", right above "حيدر بالطريق إلك". `prepNote()` runs whatever the current step is. | Contradictory status hurts the timeline's credibility. | In `deliveryTimeline`, set `note: prepNote()` only when `current === 'preparing'`; add a test. | S |
| L-12 | P2 | Chat header ticket | `chat-courier-thread.png` vs `chat-order-buttons.png` | The chat says "طلب #44"; the order screen says "طلب #8485". `app/chat/[orderId].tsx` never passes `orderNumber`. Still open from C-22. | One order, one number (consistency). | Pass `orderNumber={orderTicketNumber(orderId)}` to `ChatScreen`. | S |
| L-13 | P2 | Chat loses live context | `chat-courier-thread.png` | The header shows name, role and ticket only. While chatting you can't see where he is or how long until he arrives; the quick replies are the same in every phase. | Uber and Careem chat keep the trip status in the header. Fitts/Hick: the right reply first. | Header subtitle shows live status: "بالطريق · 4 دقايق" / "عند بابك" (from `orders.track`); tap returns to the map. Order quick replies by phase: at the door, "طالع هسة" first; on the way, "تعال للباب الثاني" first. | S |
| L-14 | P3 | Chat location bubble | `chat-courier-thread.png` | "لوكيشن · افتح بالخريطة" with no thumbnail. | A courier hunting for a door needs to see it at a glance. WhatsApp shows a map thumbnail. | A 160×96 static thumbnail: the SVG zone base plus a pin offline, a tile snapshot once SP2 lands. Tapping opens the in-app map first. | M |
| L-15 | P2 | Ride destination pin | `ride-choose.png`, `ride-searching.png` | The destination ("حديقة الشاشة", "وجهتك") uses the **home** icon. Still open from C-34. | Wrong iconography confuses pickup, home and destination. | Flag icon for ride destinations; home only when the drop-off is a saved place labelled home. | S |
| L-16 | P2 | Ride on trip | `ride-on-trip.png`, `ride-on-trip-actions.png` | The float's primary (accent) button is "call driver" while you sit in his car. "الغي الطلب" is still listed during "المشوار ماشي" (`canCancel` uses `pickedUpAt`, which rides don't set). | Put the right action at the right time. Uber's on-trip panel puts share-trip and the safety toolkit first. | In `on_the_way` for rides, the float buttons become share (accent, "شارك") + chat; the call moves into the sheet. Hide cancel once `trip.state = in_transit`; "عندي مشكلة" stays. **Needs Ali**: any mid-trip stop or partial fare rule. | S |
| L-17 | P2 | SOS sheet | `live/sos-sheet.png`, `sheet-sos.png` | After the 3-second hold, the sheet's most prominent button is the outlined "كنسل — تنبيه بالغلط (10)"; "اتصل بالشرطة 104" is a text link. The copy says "الديسباتشر". Without an emergency contact you get "تگدر تضيفه من حسابك", a dead end mid-emergency. No driver or plate summary to read out. | In an emergency, the most important action must be the biggest. Uber's Safety Toolkit leads with the 911 call and shows the car details; Bolt is similar. Voice: Iraqi, not English jargon. | Order: (1) filled danger button "اتصل بالشرطة 104"; (2) a car card to read out: "عباس · تويوتا كورولا أبيض · واسط 31207"; (3) "فريق درايفر يشوف موقعك هسة ويتصل بيك"; (4) text button "كنسل، ضغطتها بالغلط (10)". No contact: inline "دز موقعي لواحد أثق بيه", which opens the system share sheet with the trip link. Replace "الديسباتشر" with "فريق درايفر". Emergency numbers are already on Ali's open-questions list (maps spec §11). | S–M |
| L-18 | P2 | Late and reassigning | `track-late.png`, `live/state-late-sheet.png`, `track-reassigning.png` | Late is said three times: banner, pill ("متأخرين 8 دقيقة") and timeline note, with the credit sentence twice. Reassigning: the ETA jumps (6:32, 29 min) without saying the time changed or whether the credit applies. | Say it once, well (minimalism). The honest-delay copy is a brand asset, so don't dilute it. | Banner keeps the full apology with credit progress (d-5 from the last audit). Pill becomes "الوقت الجديد 6:19 م". The timeline note drops the credit sentence. Reassigning body: "طلبك محفوظ. الوقت الجديد 6:32 م، وإذا تعدّى التأخير 20 دقيقة التوصيل علينا". | S |
| L-19 | P3 | Motion tokens | `AlmostThere.tsx`, `Arrival.tsx` | Hard-coded values: `FadeInDown.duration(260)`, `FadeIn.duration(220)`, `ZoomIn.springify().damping(11)`, `BURST_MS 900`, points delays 700/650/1300, `fontSize: 36`. No "celebrate" or "reveal" token. | The tokens are the system (brand spec); moments drift when values are ad hoc. Material 3 Expressive separates spatial springs from effects springs. | Add `motion.spring.celebrate {damping:12, stiffness:180, mass:0.8}`, `motion.spring.reveal {damping:18, stiffness:220, mass:0.9}`, `motion.duration.celebrate 900`, and a `display` type variant at 36/52. Replace the literals. | S |
| L-20 | P3 | Minutes grammar | `track-late.png`, `track-signal-lost.png`, `ride-choose.png`, `ride-matched.png` | "8 دقيقة", "3 دقيقة", "2 دقيقة", "1 دقيقة" on the pill, ETA box, late banner and choose screen, while `track.signal_lost_n` says "3 دقايق" and the share page already pluralises views (مرتين / مرات). The voice spec §5 deliberately chose `{n} دقيقة`. | The pill on the courier is the most-read text in the app, and Iraqis notice "2 دقيقة" (it was flagged in C-28). | **Needs Ali** (it reverses a voice-spec rule). A helper `minutesLabel(n)` built on `Intl.PluralRules('ar')`: 1 "دقيقة", 2 "دقيقتين", 3–10 "{n} دقايق", 11+ "{n} دقيقة". Use it on the pill, ETA box, banners and search chips. | S |
| L-21 | P2 | Points: the end | `track-rating-points.png` | "+21" / "كسبت 21 نقطة" / "انضافت لمحفظتك" say the same thing three times. The wallet icon mixes up money and points. No sense of progress. | The end should show progress (goal-gradient, Zeigarnik). Starbucks and Careem Rewards show "x to next reward". | One line: "+21 نقطة". A progress bar underneath: "باقيلك 79 نقطة على توصيلة ببلاش". Coin or star icon instead of the wallet. Count-up `duration.countUp`, then the bar fills over `duration.slow`. **Needs Ali**: reward thresholds (economics). | S–M |
| L-22 | P2 | Share for the watcher | `chat-ride-share-sheet.png`, `chat-share-page.png`, `chat-share-ended.png` | The sheet shows a raw URL ("http://127.0.0.1:55557/share/shr_38bff…"). The page polls every 5 s and has no route. After expiry the watcher sees "انتهت المشاركة" / "هذا الرابط ما يبين شي بعد", even when the ride ended safely. | The watcher is often a worried parent; the last thing they see should be reassurance. Uber's Share My Trip ends with "arrived". | Sheet: a preview card ("أهلك يشوفون: اسم السايق، السيارة، اللوحة، مكان السيارة"), primary "دز على واتساب", secondary "انسخ الرابط", no raw URL. Page: after a completed trip, even past the window, show "المشوار خلص بالسلامة الساعة 6:12 م" instead of expired; revoked stays as is. Route plus SSE per c9. | S–M |
| L-23 | P2 | Screen readers on the live screen | `SheetParts.tsx`, `AlmostThere.tsx` | `status-line` has no `accessibilityLiveRegion`. `DegradedBanner` and the almost-there card rely on `accessibilityRole="alert"`, which TalkBack doesn't announce on Android. The map label is static (`track.map_label`). Reduce motion is respected well: `usePulse`, the radar, the prep ring and the burst all go still. | WCAG 4.1.3 Status Messages. A blind customer should hear "طلبك بالطريق" without hunting for it. | `accessibilityLiveRegion="polite"` on `status-line`; `"assertive"` on the almost-there, at-door and driver-here cards. `AccessibilityInfo.announceForAccessibility(statusLine)` on each moment (iOS). A dynamic map label: "حيدر بعيد 1.2 كم، يوصل بعد 6 دقايق". Don't make the ETA box live (it would chatter every minute). | S |
| L-24 | P2 | Sound etiquette and tech | `lib/sound.ts` | expo-av plays the cues on the media stream, so on Android they play even with the ringer on silent or vibrate (iOS respects the silent switch). expo-av is deprecated (expo-audio replaces it). | Prayer times, night and mosques: a chime from a "silent" phone is a brand faux pas. | Respect Android's ringer mode: skip the cue when it isn't normal, either via a tiny native check or by playing moments as a local notification on a "لحظات الطلب" channel, which honours DND. Migrate to `expo-audio`. Keep the files ≤ 30 KB. | S–M |
| L-25 | P2 | Ride story camera | `ride-matched.png`, `ride-on-trip.png` | `storyShot` has food rules only; rides fall back to "everything ahead", so both legs are drawn as a dotted V and the approach is small. | The camera should tell the current chapter. Uber zooms on driver plus pickup until pickup, then follows the trip. | Ride rules: `to_pickup` = driver + pickup, zoom 15–17; `at_pickup` = pickup at 16.5 with the car; `on_the_way` = follow the car with look-ahead to the destination. Draw only the active leg solid; the next leg at 30% opacity. | S |
| L-26 | P2 | Waiting for kitchen | `food-waiting.png` | "ننتظر مطعم خالد يأكد طلبك" + "ننتظر المطعم يأكد، عادةً خلال دقيقة" repeats itself (C-28 open). The ring is static; there is no "seen" signal. | Operational transparency: the first proof of handling lowers anxiety the most. WhatsApp's "seen" ticks; Talabat's "restaurant is reviewing". | Subtitle: "عادةً يرد خلال دقيقة". When the merchant opens the ticket, show "المطعم شاف طلبك" with a double tick (**needs** a `seenAt` event from the merchant app). The ring fills over the "usual" 60 s; after that, "بعده ما رد · نتصل بيه هسة" only if ops really auto-call. | M |
| L-27 | P3 | Float collisions | `ride-matched.png` | `CourierFloat` covers the "نقطة الركوب" pin label and the OSM credit. | Polish; legibility. | Include the label height (30 px + stem) in the camera's bottom pad when a pin is in focus; move the credit into a small "ⓘ" chip at top-end. | S |
| L-28 | P3 | First-frame jump | `live/first-open-00.png` → `01` | The first frame draws a different framing, then the camera snaps. | Jank on the first impression, worse on low-end Android. | Keep the overlay at opacity 0 until `placed`, then fade in over `duration.fast`. | S |
| L-29 | P2 | Animation cost on low-end Android | `map/Overlay.tsx` | `RouteLine` recomputes and re-sets the SVG `d` of the whole polyline on every frame (two paths). Up to three loops run alongside it (courier pulse, prep ring, radar ×3). | `vercel-react-native-skills` animation rules: animate transform and opacity; avoid per-frame layout or path work. On a 2 GB Android, SVG path parsing at 60 fps drops frames. | Draw the route once per path change. Animate the travelled part by masking (`strokeDashoffset`, one number), or recompute `d` at most 15 fps with a ≥ 1 px movement guard (`useFrameCallback`). Pause pulses when the sheet is above detent 1 or the app is in the background. Profile on the reference cheap Android (maps spec §11 open question 3). | M |

---

## 4. Signature upgrades

### S-1. "على شاشة القفل": a live order outside the app
- **What.** One quiet, persistent notification per live order or ride. It shows stage segments (قبل · يتحضّر · بالطريق · عند بابك), a tracker icon (motorbike or tuktuk) riding the bar, "6–8 دقايق", the courier's first name, and actions "اتصل" / "الطلب". It ends as "وصل طلبك · قيّم" for 30 min. Rides add the plate once matched.
- **Why it delights.** People lock the phone during 25 minutes of prep. The open loop (Zeigarnik) stays visible without opening the app, which beats "opening the app 9 times". Iraq is overwhelmingly Android and many phones are Samsung A-series, so this is the highest-reach "wow" available.
- **Build sketch.**
  - Android ≤ 15: an Expo native module (`expo-modules-core`, Kotlin) `LiveOrderNotice.update({stage, minutesLow, minutesHigh, name, plate})` → an ongoing `NotificationCompat` notification with determinate progress, on a "تتبع الطلب" channel (low importance, no sound).
  - Android 16: `Notification.ProgressStyle` with segments and points, plus a request for promoted-ongoing "Live Update" status (status-bar chip). Follow the platform's promotion criteria: ongoing, standard template, no custom view.
  - iOS: an ActivityKit Live Activity (Dynamic Island) via a widget-extension config plugin, fed by APNs live-activity pushes.
  - Feed: FCM/APNs data messages from the API on each stage change, plus a minutes refresh at most every 60 s, computed server-side (one ETA, D3).
  - This is spec c8, which the spec marks "later". I recommend pulling the Android part forward right after SP1, because push is currently broken (no EAS `projectId`).
- **Benchmarks.** Uber / Uber Eats Live Activities, DoorDash, Swiggy's ongoing notification, Android 16 Live Updates (ProgressStyle), Samsung One UI Now Bar.
- **Effort.** L (Android M, iOS M).
- **Risk.** Battery is near zero (push-driven, no client polling or GPS). Data is about 1 KB per update × ~30 per order. OEM battery killers don't matter because nothing runs in the background. Live Update promotion can be refused if the design breaks the rules, so build to them. iOS needs the Apple developer account (open question 1).

### S-2. "لگينالك سايق": the driver reveal, and "السايق وصل"
- **What.**
  - On match, the radar rings collapse onto the matched car (600 ms). The car glides in, and a card rises over the map: photo, first name, "متحقق اليوم", "تويوتا كورولا · أبيض", a plate chip styled like an Iraqi plate, ★ 4.9. Below it, one tap: "دز المشوار لأهلي" (pre-picked trusted contact).
  - At pickup, the plate grows to 32 px, there are two heavy buzzes, the `near` cue plays, and a push reads "عباس وصل · باجاج أحمر · واسط 8841", with the "طالع هسة" quick reply.
  - Vehicle art on the choose screen uses the same top-down tuktuk and car as the map, so the vehicle you pick is the vehicle you watch.
- **Why it delights.** It turns the silent match (L-02) into the ride's peak, and it's a safety ritual: face, plate, car. Peak-end gets a real peak; anxiety drops exactly when a stranger enters your evening.
- **Build sketch.** `moments.ts` gets `matched | driver_here`. `RadarPulse` gets a `collapseTo` shared value (`withTiming` at `duration.slow`, `bezier.standard`). The card uses `FadeInUp.springify()` with `spring.reveal` (`L-19`). `DriverChip` gets `plateSize="xl"`. The push template lives server-side.
- **Benchmarks.** Uber's match card and "Your driver is here", Careem's captain card, Bolt.
- **Effort.** M.
- **Risk.** Low. Reduce motion makes it an instant swap, with haptics kept. No battery or data cost beyond one push.

### S-3. "شغل المطبخ": kitchen theatre for the prep dead time (honest labour illusion)
- **What.** While preparing, the collapsed sheet shows a little illustrated "ticket" of **your** items, using taxonomy art (لفة، صحن، مشروب) that the last audit's C-10 asked for. Lines tick off as **real** events land:
  1. "المطعم قبل" (`acceptedAt`)
  2. "حيدر رايح للمطعم" (courier assigned)
  3. "حيدر وصل المطعم" (pickup `arrivedAt`)
  4. "الطلب جاهز" (`readyAt`)

  The prep ring becomes a bar against `promisedReadyAt`. One line of true local flavour comes from the merchant profile, e.g. "مطعم خالد يشوي على الفحم من 1998". It complements d-3 (the kitchen-to-door strip) by covering the leg before pickup.
- **Why it delights.** Showing the work raises perceived value and patience (Buell & Norton, operational transparency). It fills the longest dead time with something true, not a fake progress bar.
- **Build sketch.** Pure client work from existing timestamps. SVG plus Reanimated; ticks on `spring.select`, the bar on `withTiming(duration.slow)`. Merchant flavour is a new optional `story` field on the merchant profile (content work). Optional later: a one-tap "بدأنا نحضّر" in the merchant app (**needs Ali**, since it adds merchant workload).
- **Benchmarks.** Domino's Tracker (prep → bake → quality check), Wolt's kitchen progress, Deliveroo's "being prepared".
- **Effort.** M.
- **Risk.** Honesty: never animate progress that no event backs; when there's no event, hold still and say so. Static under reduce motion. No network cost.

### S-4. "شكراً حيدر": put the person in the peak
- **What.**
  - The delivered screen shows the courier (photo, name) with a single heart button, "شكراً حيدر". The courier app buzzes: "زينب شكرتك".
  - After 4–5 stars, optional compliment chips: "سريع"، "محترم"، "الأكل وصل حار"، "لگى البيت بسهولة". They accumulate into the courier's card: "12 زبون قالوا محترم".
  - The rating question shows his face ("شلون كان سجاد؟" with the avatar) instead of a nameless star row.
- **Why it delights.** Reciprocity, and the end becomes human. It makes couriers want to work for Driver (supply-side retention). It also gives the next customer social proof on the courier card.
- **Build sketch.** Extend rating tags with positive tags (the server already stores tags). A courier-app toast via `live.*`. Heart press: `usePressScale` + `useSelectSpring` + `haptic('light')`. No free text to the courier, presets only (safety). Post-delivery tipping is out: the API takes tips only at checkout (**needs Ali** if wanted).
- **Benchmarks.** DoorDash "Thank your Dasher", Uber compliments and badges, Swiggy.
- **Effort.** M.
- **Risk.** Low. First name only (identity-vault rule). Compliments need a minimum count before they're shown.

### S-5. "قصة الطلب": a shareable order or trip card (journey recap, c11 pulled forward)
- **What.**
  - Food: after a 4–5-star rating, a card with a brand-drawn route doodle (simplified to about 20 points; the line **stops 200 m before your door**), "من مطبخ خالد لبابك بـ 24 دقيقة", "أسرع من الوعد بـ 4 دقايق" only when true, the courier's first name, and "+21 نقطة".
  - Rides: "مشواري ويا عباس · 12 دقيقة · العزيزية".
  - Buttons "شارك على واتساب" / "خلّيها".
- **Why it delights.** The end gets a memento. WhatsApp-status culture makes it free word of mouth, and it's only offered after good experiences.
- **Build sketch.** Compute the simplified line at delivery time, because D6 keeps only summaries after 30 days. Render an SVG card and capture it with `react-native-view-shot`; the image is about 60 KB.
- **Benchmarks.** Uber trip receipts, Strava, Spotify Wrapped (lite).
- **Effort.** M.
- **Risk.** Privacy: the home location is cropped, sharing is opt-in, and no exact addresses appear. Never prompt after a low rating or a late order.

### S-6. "مشوار آمن": a visible safety layer for rides (revisits parked s1/s2)
- **What.**
  1. A "نبعث لأهلي" toggle at booking. The share link goes automatically to a saved trusted contact at match, and a WhatsApp message "وصلت بالسلامة الساعة 6:12 م" goes out at arrival.
  2. A ride check: if the car stops for more than 4 minutes mid-trip, or leaves the expected corridor by more than 500 m, a full-screen gentle check asks "كلشي تمام؟" with "إي تمام" / "ساعدوني" (the second goes to the SOS flow).
  3. A 4-digit ride PIN the driver enters to start the trip, which prevents getting into the wrong car.
  4. A mandatory driver portrait (L-06).
- **Why it delights.** Trust comes before joy, especially for women riders and for children on خطوط. It's the strongest differentiator against informal taxis.
- **Build sketch.** Share links already exist (`tracking.createShareLink`). The ride check is a server rule on the trail (needs SP4 location truth) that pushes a `ride_check` event. The PIN is a field on the driver app's start-trip screen. WhatsApp templates already exist on the API.
- **Benchmarks.** Uber RideCheck and PIN verification, Careem trip sharing, the Bolt Safety Toolkit, inDrive.
- **Effort.** L.
- **Risk.** False positives in traffic: tune thresholds and allow quiet hours. WhatsApp message costs (g2 is parked). **Needs Ali**: s1 and s2 are "parked" on his board.

---

## 5. Keep list (don't lose these while polishing)

- **Honest delay with auto-credit**: "تأخرنا 8 دقيقة وهذا غلطنا. الوقت الجديد 6:19 م. إذا تعدّى التأخير 20 دقيقة، نرجعلك أجرة التوصيل رصيد." Ownership plus the pratfall effect; best in class.
- **The cash hand-off** on arrival ("جهّز 11,500 دينار للدليفري · المبلغ مضبوط، ما يحتاج خردة") and in the almost-there card. It solves the most Iraqi problem in the flow.
- **Moments that fire only on real transitions.** `momentsBetween` never replays "accepted" when you open the app an hour later. Keep that rule, and apply the same discipline to the arrival overlay (L-04).
- **Soft cues ≤ 30 KB** that respect the iPhone silent switch, plus an in-app sound switch.
- **Reduce motion done right**: `usePulse`, the radar, the prep ring and the burst all go still; the courier still glides (that motion carries information).
- **Top-down vehicles and the minutes pill** on the marker. The orange car on the share page is the most "premium" frame in this slice.
- **Search wave copy**: "دزّينا طلبك لأقرب السواق يمّك" → "وسّعنا البحث لسواق أبعد شوية" → "كل السواق بالعزيزية يشوفون طلبك هسة". Operational transparency; just give it a finish line (L-03).
- **Free-wait counter** at pickup with the exact rule ("السايق ينتظرك 3 دقايق مجاناً، بعدها 250 دينار كل 5 دقايق").
- **Free-cancel framing at each stage** ("الإلغاء مجاني هسة", "لا، خليه").
- **Low-rating recovery**: "شنو اللي ما عجبك؟" chips and "افتح شكوى", with the dispute opened before the rating is stored.
- **Chat**: masked numbers with "خفينا الرقم…", Iraqi quick replies ("تعال للباب الثاني", "طالع هسة", "دگ الجرس"), "انقرت" read receipts, and the closed-thread note.
- **Share link**: view count ("ما انفتح بعد"), "وقّف المشاركة", and the privacy line on the public page ("هذي الصفحة ما تبين رقم تلفون ولا اسم كامل ولا عنوان").
- **SOS**: the 3-second hold with a 3-2-1 countdown inside the pill, the 10-second cancel window, and the shared location.
- **Signal lost**: grey marker and an honest "آخر موقع قبل دقيقتين" with "الطلب ماشي".
- **The WhatsApp arriving message** (seen in the API log): "هلا زينب، الدليفري مرتضى يوصلك بعد دقيقتين بطلبك من مطعم خالد. المبلغ 11,500 دينار." Warm, specific, useful.
- **The story-camera concept** (kitchen → courier → door) and the follow-without-seasickness threshold. Extend it to rides (L-25) rather than replace it.
- **The sheet**: smooth drag and snap (`spring.sheet`), the courier float above the collapsed sheet, and "رجّع الخريطة" after a gesture.

---

### Appendix: what "needs Ali"

These are product or money decisions, not design defaults:
- L-03: when the ride search gives up, and whether switching vehicle re-quotes.
- L-10: whether "أني نازل" pauses the unreachable clock.
- L-16: any mid-trip stop rule.
- L-20: minute plurals (reverses voice spec §5).
- L-21: reward thresholds.
- S-3: merchant "started cooking" tap.
- S-4: post-delivery tips.
- S-6: unpark s1/s2 and WhatsApp costs.
- L-17: emergency numbers (already open question 2 in the maps spec).
