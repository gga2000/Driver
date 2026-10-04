# UI/UX audit — all apps (2026-10-04)

Four parallel audits against Talabat, Toters, Baly, Careem, Uber / Uber Eats / Uber Driver, DoorDash
(consumer, Dasher, Merchant), Deliveroo, Grab, Bolt and Deliverect, using design critique, Nielsen
heuristics, persona walk-throughs, cognitive-load checks, WCAG 2.2 contrast/target measurement,
design-system and copy/voice reviews, signup/onboarding/checkout CRO and data-viz validation.
Around 400 screenshots (every screen and state, small and large phones, tablet, laptop, offline,
error, empty and rush states) were taken and viewed.

| Report | Findings | Score now → target |
|---|---|---|
| [customer.md](customer.md) — Driver | 45 (2 P0, 19 P1, 17 P2, 7 P3) | 6.2 → 8.4 |
| [partner.md](partner.md) — Driver Partner | 41 (2 P0, 16 P1) | 5.3 → 8.8 |
| [merchant-and-console.md](merchant-and-console.md) — Driver Merchant | 27 | 6.4 → 9 |
| [merchant-and-console.md](merchant-and-console.md) — Console | 23 | 5.0 → 9 |
| [system-a11y-copy.md](system-a11y-copy.md) — design system, accessibility, motion, copy | 31 | 6.3 → 8.6 |

Severity: **P0** broken or unsafe · **P1** hurts orders, money, trust or safety · **P2** noticeably below
best-in-class · **P3** polish. Each report has a "keep" list, build-ready signature moments and a
ranked do-next list; IDs below link the work back to them.

## Verdict
The foundations are strong and in places already world-class: honest delay credits, the per-person
cart, the الرجعة seat flow and boarding pass, the restaurant ticket design and reject reasons, the
Console control room, a consistent Iraqi voice, Western digits everywhere and labelled icon buttons.
What holds the apps back is not taste but **the moments that fail under real conditions**: alarms
that are silent on real devices, no offline handling anywhere, dead affordances (search, "see all",
SOS), cash numbers that disagree, and operator screens built for a demo rather than a rush hour.
Fix those first; then the system work (contrast, one clock, shared components, terminology) makes
everything feel like one premium product; then the signature moments make it unmistakably Driver.

## Phase 1 — Launch blockers (real devices, real networks, real cash)
1. **Alarms that can't be missed** — S-01, P-01, M-02, M-04: looping offer and new-order sounds on
   native (silent mode included), vibration patterns, keep-awake, "ابدأ الشغل" sound check on the
   tablet, an alarm that escalates; silence becomes a 30 s snooze.
2. **Missed orders never vanish silently** — M-01: missed-order strip and counter, record kept.
3. **Offline everywhere** — C-17, P-09, M-08, K-06, S-07: network detection, one shared offline
   banner, queued driver actions, skeleton timeouts, Arabic network errors, no false "live" dot.
4. **SOS** — P-02: deferred by Ali (decision 3 below): the button stays as a reminder; build the real
   3-second-hold SOS before launch.
5. **Dead affordances** — C-01 search, C-02 "شوف الكل", C-03 "قريباً" tiles with "خبرني".
6. **One cash truth** — P-05, P-06, M-07, C-11, C-04: one "لازم تسلّم" number, honest cap colours,
   amounts on hand-over sheets, explained negative balances, cash amount on the customer's arrival
   screen, wallet usable at food checkout.
7. **Trust leaks** — C-05, C-06, C-08, C-16: hide the dead promo field, explain which deal applied,
   remove "(مسودة)", fixture deals, fake favourites and the false "first delivery free" line.
8. **Console that names things** — K-01, K-02: names/vehicles/plates instead of IDs, "#1284" everywhere
   and searchable.

## Phase 2 — Feels world-class (one system, ergonomic, clear)
- **Contrast & focus** — S-04, S-13, K-10, K-11: `borderStrong` `#8C7F6F`, visible field borders,
  focus rings, check marks on selected chips/seats; Console palette generated from design tokens.
- **One clock** — S-06, C-14: Asia/Baghdad everywhere, ص/م and dates on every time, durations as
  durations.
- **One vocabulary** — S-09, S-08, glossary in system-a11y-copy.md §4: دليفري (never مندوب), مشوار for
  taxi, الديسباتشر, one merchant app name; all API error copy moved into locale files and rewritten.
- **Shared components** — S-05, S-12: ChatThread, OtpInput, ModalSheet, Screen, TabBar,
  PermissionPrompt, SlideToConfirm, SosButton into packages/ui (≈2,500 lines removed).
- **Driver ergonomics** — P-03, P-04, P-08: full-width accept with timer fill, decline away from the
  thumb, offer fits 360×740, total km/min, slide-to-confirm for pickup/deliver/end/depart.
- **Kitchen rush** — M-05, M-06, M-03: rush queue strip and compact tickets, sticky accept bar on
  phone, no permission prompt over a ringing board.
- **Dispatch at peak** — K-03, K-04, K-05, K-07, K-08: map + queue with "يحتاج موزّع" first, candidate
  list with ETA/cash and keys 1–5, triage bar and badges, keyboard map, role-based nav.
- **Customer flow** — C-09 home hierarchy (food in the first fold), C-15 orders list + "اطلبه مرة
  ثانية", C-19/C-20 driver name, photo and plate chip, C-18 guest browse + WhatsApp OTP fallback,
  C-13 help section, C-12 low-rating recovery + tip chips.
- **Type & motion** — S-10, S-11, S-16, S-21, motion language (§6): 12 px floor, numeral tokens,
  font-scale caps, one icon set, named durations/curves, a haptics and sound map, toast behaviour.

## Phase 3 — Signature moments (what makes it unmistakably Driver)
- **"الخردة علينا"** — the cash hand-off as a feature on both sides: the courier's change helper at
  the door (partner S-2) and the customer's "الباقي رصيد" receipt (customer d-1, C-11).
- **The 2-second offer card** (partner S-1) and **end-of-shift summary** (S-4).
- **The garage board as the brand's face** + boarding pass on the lock screen (customer d-2, d-8;
  partner S-5 garage mode).
- **Kitchen-to-door live strip** (customer d-3) fed by the restaurant's real states.
- **Aziziyah landmarks as the address system** (customer d-4) and a welcome that is a map of home (d-6).
- **"Why was I paid this"** receipt (partner S-7), merchant and Console moments (merchant-and-console §8).

## Decisions (Ali, 2026-10-04)
1. **Rounding (C-07): yes to the wallet option.** Totals round to 250; the remainder goes to the
   customer's wallet like change, shown as "الباقي رصيد" (no "تقريب +" line that raises the total).
2. **One-tap accept (M-12): yes.** "اقبل · 15 د" accepts with the store's usual prep time (busy adds
   10); one "+5 د" allowed afterwards, and the customer is told "المطعم زاد 5 دقايق".
3. **SOS (P-02): keep the button as it is for now, as a reminder.** Not built in Phase 1; stays an
   open item that must be built before launch (needs a dispatcher answering every alert).
4. **Guest browsing (C-18): yes.** Home, restaurants and menus are public; the phone number is asked at
   "كمّل الطلب" / "احجز", with "ما وصلك؟ دزلي على واتساب" after 30 s on the OTP screen.

## Process notes
Demo scripts the auditors had to patch (fix before the next round): customer `demo-api.mjs`
`/demo/account` missing awaits; `/demo/chat?scenario=ride` now double-creates the trip; screenshot
scripts wait for "network idle", which never comes with the live (SSE) connection open; the partner
"لا يفوتك طلب" notification pre-prompt blocks the first tap in screenshot runs; the merchant demo's
cash balance is negative, so "اطلب فلوسك" can't be shown.
