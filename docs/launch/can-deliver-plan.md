# Can deliver (G0): the companion plan

Started 2026-10-07. Owner: the "Launch build: before-launch list" thread, with Ali.

This is the companion plan named in the launch plan (`audit/plan.md` §8.1 in the project files). The
launch plan covers the customer app and its server. A real food order also needs couriers, kitchens on
tablets, prices, zones, the street map, support staff, accounts and the stores. That is **G0, "can
deliver"**, and this file tracks every G0 row and every item in `docs/before-launch.md`.

**Why we can start now.** `CLAUDE.md` says not to start anything in `docs/before-launch.md` unless Ali
asks. On 2026-10-07 Ali approved the launch plan ("go ahead i like it"), including decision **D-22**:
"start the before-launch items in G0 now, through the companion plan". So the G0 items are open from
today. Items that are not needed for a food-only launch stay parked (section 5).

## 1. How this works

- **Dates.** D-day is **Mon 7 Dec 2026** (D-2). "D-24" means 24 days before: Fri 13 Nov.
- **Two halves.**
  - **G0-closed** rows must be green by **D-24 (Fri 13 Nov)**, the closed-test build cut. Without them
    there is no real food order to test.
  - **G0-launch** rows can only be proven while the closed test runs. They are checked at go/no-go,
    **D-4 (Thu 3 Dec)**.
- **Green** means the pass line in the row is met and recorded in `docs/launch/gates.md` (date, who
  checked, evidence link), as for every other gate.
- **Ali's own actions and money.** Anything that is Ali's own action or involves money (accounts,
  phone numbers, prices, people, rotas) is put to Ali as a decision with a recommendation. No thread
  acts on it for him. Money rules stay switched off until Ali gives his numbers (M-1 … M-14).
- **Code.** This plan writes no app code. Code a G0 row needs goes to the lane that owns it, through
  the project's coordinator: **A** server core, **B** platform, **C** app, **D** comms and identity,
  **E** Console. The street map, zones and landmarks belong to the **map session** outside this
  project (it owns `packages/map/**`).
- **Review.** This file is reviewed every week with `gates.md`. A row that slips its date is raised
  to Ali the same day, with what it moves.

## 2. Key dates

| Date | Day | What |
|---|---|---|
| Wed 14 Oct | D-54 | Fly and Supabase accounts open (G0-14) |
| Thu 15 Oct | D-53 | This plan agreed with Ali; G0-6 street-map date agreed with the map session |
| Sun 18 Oct | D-50 | D-24 (waves) and D-25 (which Play account) decided; re-plan |
| Wed 28 Oct | D-40 | Cloudflare, EAS, domain open (G0-14) |
| Mon 2 Nov | D-35 | Prices (G0-7), zones (G0-8), partner phones (G0-1), Play location declaration ready (G0-2) |
| Wed 4 Nov | D-33 | D-U-N-S number received (needed for the Play organisation account) |
| Mon 9 Nov | D-28 | Play organisation account verified, apps created (G0-3); kitchens on tablets (G0-4); map (G0-6); SOS rota (G0-9); support (G0-11); landmarks (G0-12); SMS and WhatsApp (G0-13) |
| Tue 10 Nov | D-27 | Closed-track releases submitted, with the location declaration (G0-2, G0-3) |
| **Wed 11 Nov** | D-26 | **Dress rehearsal** (G0-16); kitchen throughput first measured (G0-17) |
| **Fri 13 Nov** | D-24 | **G0-closed green**: couriers (G0-5), calls (G0-10), photos (G0-19) |
| Mon 16 Nov | D-21 | Closed track live; location declaration accepted (G0-2) |
| Mon 23 Nov | D-14 | Throughput re-measured (G0-17); dinner courier roster (G0-18) |
| Thu 26 Nov | D-11 | Game day: kill switches tested (G0-15) |
| Mon 30 Nov | D-7 | Demand plan and wave 1 (G0-20) |
| **Thu 3 Dec** | D-4 | **Go/no-go**: G0-launch green |

## 3. The G0 rows

Status today (2026-10-07) is in the last column. "Waits on Ali" means nothing can move until Ali acts
or answers; the question is in section 4.

### G0-closed (green by Fri 13 Nov)

| # | What | Owner | Due | Pass | Status / next step |
|---|---|---|---|---|---|
| G0-1 | **Partner app on real phones**: location keeps reporting with the app closed; live updates work on a phone, not only on the web | Partner app thread (code), Ali (phones) | D-35 Mon 2 Nov | On 3 of the 7 test phones (6.2), a courier goes online, locks the phone 15 min: the Console shows a fix at least every 60 s; an offer arrives by live update within 5 s | Built 2026-10-07, never tried on a phone. Needs the first EAS development build (lane C, D-42 Mon 26 Oct) and the test phones (Ali buys this week). Hand-off: partner thread runs the phone test in the week of 29 Oct |
| G0-2 | **Google Play background-location declaration** for the partner app: the in-app explanation screen, a short video, the form text | Partner thread (screen, video), Ali (submits) | Ready D-35; submitted D-27; accepted D-21 | Declaration accepted on the organisation account | The in-app explanation exists. Still to do: record the video on a real phone (after G0-1), write the form text, and update `docs/deploy/mobile.md` (it still says the apps ask for no foreground-service permission and upload to the *internal* track; the plan uses the *closed* track). Until accepted, couriers use an EAS internal-distribution APK |
| G0-3 | **The 3 apps in the Play organisation account only** (D-25); test builds before that are EAS internal-distribution APKs | Ali (account), lane D (store setup) | Created D-28; submitted D-27; live D-21 | Closed track live with 12+ testers | Waits on Ali: company registration → certificate (D-47) → D-U-N-S (D-33) → Play organisation account (D-28). The chain has no slack: start the company filing this week. Nothing is created in any Play account before D-28 |
| G0-4 | **Merchant app on the 4 launch kitchens' tablets**, staff trained; printer optional | Merchant thread, field ops | D-28 Mon 9 Nov | Each kitchen accepts, marks ready and refuses a test order on its own tablet; menus entered through the merchant app and checked by a second person (§8.2) | Waits on Ali: which 4 kitchens are signed, and who does field ops (question 3). Tablets: one per kitchen (Ali's purchase, question 6) |
| G0-5 | **At least 29 couriers** recruited, documents and main photo approved in the Console, briefed on street hand-over, dish-unavailable choice and cash | Ali, field ops | D-24 Fri 13 Nov | 29 couriers approved in the Console; briefing attended (signed list) | Waits on Ali: field ops lead (question 3). Briefing script ready: `docs/launch/courier-briefing.md` (lines marked ⚠ follow rules still open) |
| G0-6 | **Real street map on phones** (phones show a zone sketch today; the web has the real map) | **Map session** (outside this project) | D-28 Mon 9 Nov; date agreed by D-53 | Courier and customer apps show the street map on an Android phone, offline tiles included | Needs the map session's owner. Ali: please ask that session for a date by Thu 15 Oct (question 7) |
| G0-7 | **Real Aziziyah price tables** 💰 | Ali | D-35 Mon 2 Nov | Ali's numbers entered in the Console; the sim passes with them | Waits on Ali's numbers. This thread can prepare a fill-in sheet with today's demo values and what each one changes (question 5) |
| G0-8 | **34 zones approved and checked in**, with any fee changes 💰 | Ali, map session | D-35 Mon 2 Nov | Console zone map matches Ali's approval; fee changes approved by Ali | Ali's drawings exist, not approved. Map session owns loading them |
| G0-9 | **SOS rota and escalation**, at least 2 people (D-19) | Ali | D-28 Mon 9 Nov | Two named people on a written rota; an SOS test at night reaches the person on duty, and the escalation reaches the second | Waits on Ali: name the second person (question 2). Code: today every live dispatcher gets every SOS and "on shift" means every dispatcher; a rota and a named escalation person are a Console + server change (hand-off to lane E and lane A). The auto phone call to Ali needs calls (G0-10); until then escalation goes by push, WhatsApp and SMS |
| G0-10 | **Calls** between customer and courier ("we carry them") | Lane C (app) | D-24 Fri 13 Nov | Chat and voice notes work between customer and courier on 2 real phones; the call button reads «قريباً» everywhere | **Decided by Ali 2026-10-07: chat first.** Chat and voice notes at launch, numbers hidden; in-app internet calls are built after launch. Food tracking keeps chat as the main button and a greyed «قريباً» call button (lane C) |
| G0-11 | **Support staffed** for the closed test and launch week; canned replies in Iraqi Arabic; AI first-line **not** at launch | Ali (D-20) | D-28 Mon 9 Nov | Rota written (2 people, 10:00–24:00 in launch week, a backup); canned replies loaded in the Console | Waits on Ali: who (question 2). Canned replies: drafted by lane C, Ali approves (plan §8.3) |
| G0-12 | **Launch content**: 50+ landmarks and meeting points with photos | Field ops (photos), map session (loading) | D-28 Mon 9 Nov | 50 landmarks visible in the app, each with a photo | Waits on field ops (question 3) |
| G0-13 | **SMS provider live; WhatsApp Business verified, templates approved; the real WhatsApp support number** | Ali (accounts, number), lane D (setup) | D-28 Mon 9 Nov | 100 sign-in codes on the 3 networks arrive within 30 s (p95); one send per WhatsApp template; the support number answers | Waits on Ali: a dedicated support SIM, the SMS gateway contract, and WhatsApp Business verification (needs the company papers) (question 1). The parents' خطوط templates are **not** needed for a food-only launch |
| G0-14 | **Accounts**: Fly and Supabase by **D-54 Wed 14 Oct** (lane B builds staging in week 1); Cloudflare Pages/R2, EAS, the domain by D-40 Wed 28 Oct | Ali | D-54 / D-40 | Each account open, billing set, access shared with the threads through secrets only | **Waits on Ali, due in a week** (question 1) |
| G0-16 | **Full dress rehearsal** on EAS internal-distribution builds: real kitchens, couriers and staff, 20+ orders including a dispute, an SOS and a failed delivery, at dinner | Ali + all threads | **D-26 Wed 11 Nov** | 20+ orders end in the right state; the dispute, the SOS and the failed delivery each handled end to end | Script ready: `docs/launch/dress-rehearsal.md` |
| G0-17a | **Kitchen throughput first measured** at the rehearsal (orders per hour per kitchen at dinner); kitchen caps set from it | Ali, field ops, merchant thread | D-26 Wed 11 Nov | A number per kitchen in `gates.md`; caps = that number × 0.5 h | Measured at G0-16 |
| G0-19 | **Courier photos checked by a person**: the selfie and face check accept any photo today, so every courier's main photo is approved in the Console queue | Ali, field ops | D-24 Fri 13 Nov | All 29 couriers have a person-approved photo | The Console queue exists (`docs/api/driver-photos.md`). Process only; no code |

### G0-launch (green at go/no-go, Thu 3 Dec)

| # | What | Owner | Due | Pass | Status / next step |
|---|---|---|---|---|---|
| G0-15 | **Kill switches tested** | Lane B (W6), ops | D-11 Thu 26 Nov (game day) | Each switch turned off and on at the game day, effect seen in the apps | Lane B builds; this thread adds it to the game-day script |
| G0-17b | **Kitchen throughput re-measured** at the closed-test dinner peaks; caps reset | Ali, field ops, merchant thread | D-14 Mon 23 Nov | Updated number per kitchen; caps never above it | After the closed test starts |
| G0-18 | **Couriers on shift at the dinner peak** ≥ (kitchens' orders per hour ÷ 2.5) × 1.2, with a written launch-week roster | Ali, field ops | D-14 Mon 23 Nov | Roster covers 19:00–23:00 every day of launch week (about 29 with 4 kitchens) | Waits on G0-5 and G0-17 |
| G0-20 | **Demand plan per D-24**: wave 1 (about 450 customers) from the measured capacity at ≤ 80 %, the waitlist live, next waves' kitchens and couriers dated | Ali, field ops, lane D (W5 waitlist) | D-7 Mon 30 Nov | Wave size set in controls; waitlist on; recruiting dates written | Waits on D-24 (waves recommended), answer by Sun 18 Oct |

## 4. Questions for Ali

Each is Ali's own action or involves money, so no thread does it for him. Recommended answers first.

1. **Accounts and numbers (this week).** Open Fly.io and Supabase Pro (Frankfurt) by **Wed 14 Oct**
   so staging can be built; then Cloudflare, the EAS plan (D-11) and the domain (D-18) by Wed 28 Oct.
   Get a **dedicated SIM for the WhatsApp support number** (not your own phone) and ask two Iraqi SMS
   gateways for a quote. File the **company registration this week**: WhatsApp Business verification,
   D-U-N-S and the Play organisation account all wait on its certificate.
   *Recommended: yes to all; the threads give you step-by-step instructions for each account.*
2. **People (D-19, D-20, by Mon 2 Nov).** Name the second person for SOS, alerts and the 48-hour
   dispute escalation, and the two support people for launch week (10:00–24:00 in shifts) with a
   backup. *Recommended: the launch playbook's team, Ali + 2 dispatcher/support + 1 field ops.*
3. **Field ops lead (this week).** One person who signs the 4 kitchens, recruits and briefs 29
   couriers, and photographs 50+ landmarks. G0-4, 5, 12, 17, 18 and 19 all depend on this person.
   *Recommended: name one by Sun 18 Oct; the courier recruiting starts the same week.*
4. **Calls (G0-10): decided 2026-10-07, chat first.** Chat and voice notes at launch; in-app
   internet calls after launch.
5. **Prices (G0-7) and zones (G0-8) 💰, by Mon 2 Nov.** The fill-in sheet is ready: `/mnt/project-files/launch/price-sheet.md` (food first; taxi, tuktuk and seat prices, including the parked ideas, for about D+30).
   Ali writes his number next to each line; empty means today's number stays.
6. **Things to buy.** The 7 test phones (plan 6.2, this week) and one tablet per launch kitchen (by
   Mon 2 Nov). *Recommended: yes; the plan lists the phone models.*
7. **Street map (G0-6).** The street map on phones belongs to the map session, which is not part of
   this project. *Recommended: ask that session for a date before Mon 9 Nov, agreed by Thu 15 Oct.*
8. **Brand symbol (A, B or C).** The store icon and splash screen (lane D, 5–12 Nov) need it.
   *Recommended: choose by Wed 28 Oct.*

## 5. Every item in `before-launch.md`, and where it goes

Food-only launch (D-1) means rides, Baghdad/Kut seats and خطوط open about D+30, so their items wait.

| `before-launch.md` item | Where it goes now |
|---|---|
| §1 WhatsApp support number | G0-13 (question 1) |
| §1 SOS on duty and escalation | G0-9 (question 2) |
| §1 Calls ("we carry them") | G0-10: chat first at launch, in-app calls after (Ali, 2026-10-07) |
| §1 Parents' WhatsApp messages (خطوط) | After launch: خطوط opens about D+30 (D-1) |
| §1 Brand symbol | Gate G1 (REL-27, lane D) (question 8) |
| §1 Real price tables | G0-7 (question 5) |
| §1 Zone outlines | G0-8, map session |
| §1 Taste panel; quiet-day and Ramadan calendar | After launch (D-14, D-15: mid-December) |
| §1 SMS fallback limits | Plan D-5 and D-9 (lane D) |
| §1 Stamp cards, points expiry, invite gifts 💰 | M-5: invite rewards off for launch; the rest after launch |
| §1 Merchant staff invite "accept" step | After launch |
| §2 Company registration, Play organisation account | G0-3 (question 1) |
| §2 Expo account, Play Console, closed test | G0-3; gate G1 |
| §2 Development build | Lane C (first EAS development build, D-42 Mon 26 Oct) |
| §2 App versions 1.0.0 | Gate G1 (REL-28, lane D) |
| §2 Supabase, Fly.io | G0-14 (question 1) |
| §2 Cloudflare Pages and R2 | G0-14 |
| §2 SMS provider | G0-13 |
| §2 WhatsApp Business and templates | G0-13 (food templates only at launch) |
| §2 Push on 5 test phones | Plan 6.4 (lane D, W2), now 7 phones |
| §2 Cheap Android reference phone | Plan 6.2: the 7 test phones (question 6) |
| §2 Road routing server (OSRM) | After launch |
| §2 Apple developer account | After launch: iPhone about D+30 (D-16) |
| §2 Domain, Sentry | G0-14 (domain, D-18); gate G5 (Sentry, D-7, lane B) |
| §3 Street map on phones | G0-6, map session |
| §3 Partner location with the app closed; Play declaration | G0-1, G0-2 |
| §3 Live updates on phones | G0-1 |
| §3 Selfie and face check accept any photo | G0-19 (a person checks every photo) |
| §3 Menu import from a photo (stub) | Not needed: kitchens enter menus in the merchant app (§8.2) |
| §3 Receipt printer, restaurant camera | G0-4: printer optional at launch |
| §3 خطوط daily runs not created automatically | After launch (خطوط about D+30) |
| §3 AI first-line support | Not at launch (G0-11) |
| §3 Landmarks, canned replies, dress rehearsal, kill switches | G0-12, G0-11, G0-16, G0-15 |
| §4 Parents' WhatsApp notes | After launch, with خطوط |
| §5 Parked features | After launch, unchanged |
| §6 Small known gaps | Unchanged: fix when convenient |

## 6. Hand-offs to the lanes

Sent through the coordinator; the owning lane builds and keeps its own PR.

| To | What | For |
|---|---|---|
| Partner app thread | Phone test of background location and live updates on 3 test phones; record the Play declaration video | G0-1, G0-2 |
| Lane D (comms and identity) | Update `docs/deploy/mobile.md`: partner foreground-service location permission; closed track, not internal; EAS internal-distribution APKs before D-28 | G0-2, G0-3 |
| Lane E (Console) + lane A (server) | SOS on-duty rota: who is on shift, a named escalation person, instead of "every live dispatcher" | G0-9 |
| Lane C (app) | Food tracking: chat as the main button, greyed «قريباً» call button; calls come after launch (G0-10, chat first) | G0-10 |
| Lane C (app) | Draft the canned support replies in Iraqi Arabic for Ali's OK | G0-11 |
| Lane B (platform) | Kill switches ready for the game day | G0-15 |
| Lane D (W5) | Waitlist and wave size in controls | G0-20 |
| Map session (outside the project; Ali asks) | A date for the street map on phones, zones and landmarks loading | G0-6, G0-8, G0-12 |

## 7. Change log

- 2026-10-07: first draft, after Ali approved the launch plan and D-22.
- 2026-10-07: Ali chose "chat first" for calls (G0-10).
- 2026-10-07: dress rehearsal script and courier briefing written.
- 2026-10-07: price sheet ready for Ali (G0-7), with the parked ride and seat prices.
