# Before launch: everything put off until later

Started 2026-10-06 at Ali's request: "anything for later and postponed till before launch, so we can
work on it later. I don't want to work on them now."

**Rule for every session:** don't start anything on this list unless Ali asks. When Ali says it's time
to prepare for launch, work through it from the top. When an item is done or Ali changes his mind,
update this file in the same commit.

Each item says what it is in plain words and where the details are written. "Blocks launch" means
we can't open to the public without it.

---

## 1. Decisions Ali has postponed

| What | What Ali said | Blocks launch | Details |
|---|---|---|---|
| The real WhatsApp support number | Later (2026-10-06) | Yes: customers, restaurants and drivers all see a placeholder today | `apps/customer/README.md` (`EXPO_PUBLIC_SUPPORT_WHATSAPP`), `apps/merchant/src/lib/env.ts`, `apps/partner/README.md` |
| Who is on duty for SOS, and who it escalates to if nobody answers | Later (2026-10-06). Today every live dispatcher gets every SOS | Yes: an SOS must always reach a person | `docs/api/safety.md` |
| Phone calls between customers and drivers | **No outside "masked call" company: we carry the calls ourselves** (2026-10-06). Before building: confirm with Ali how (in-app calling over the internet, or our own phone line). The SOS call to Ali also needs this | Probably: calls run on a test bridge today | `apps/api/src/shared/call-bridge.ts`, `docs/api/safety.md` "Not done yet" |
| Parents' WhatsApp messages on school runs (خطوط) | **A proper WhatsApp setup, later** (2026-10-06): the parent gets a WhatsApp message when the child gets on and when the child arrives, with the car (driver, car, plate) and the trip details (route, times, where). Wording must not assume boy or girl (child records have no gender). Ali will set the details later | Yes for خطوط | See section 4 |
| The brand symbol (direction A, B or C) | Not chosen | Yes: the app stores need an icon and a splash screen | `docs/specs/2026-10-03-brand.md`, `docs/specs/2026-10-05-customer-joy.md` §10 |
| Real Aziziyah price tables | Not set | Yes | `docs/specs/2026-10-03-launch-playbook.md` §7 |
| Zone outlines: approve Ali's drawn zones and any fee changes they cause | Drawings exist but aren't approved or checked in | Yes (the playbook asks for 34 checked zones) | `docs/specs/2026-10-05-maps-world-class.md` §5.3 |
| Who sits on the local taste panel; which calendar we trust for quiet days and Ramadan | Not chosen | No | `docs/specs/2026-10-05-customer-joy.md` §10 |
| SMS fallback limits (how many SMS per order, monthly cap) | Not set | No | maps spec §5.9 |
| Money rules not yet approved: stamp cards, rolling points expiry, invite-gift amounts | Not approved | No | customer-joy spec §5.7, §6 |
| Merchant staff invite: add an "accept" step? | Not decided | No | `docs/research/2026-10-04-backend-review.md` #6 |

## 2. Accounts and setup

| What | Blocks launch | Details |
|---|---|---|
| Company registration and a Google Play organisation account | Yes | launch playbook §7 |
| Expo account, Google Play Console; a closed test on Play (12 testers, 14 days) before going public | Yes | `docs/deploy/mobile.md` |
| A development build so the apps run on real phones (Expo Go can't run them) | Yes | `docs/deploy/mobile.md` |
| App versions set to 1.0.0 before the first store build | Yes | `docs/deploy/mobile.md` |
| Supabase Pro in Frankfurt (database) | Yes | `docs/deploy/supabase.md`, `docs/deploy/runbook.md` |
| Fly.io for the server | Yes | `docs/deploy/hosting.md` |
| Cloudflare Pages for the web apps; own street map on Cloudflare R2 | Yes | `docs/deploy/web.md`, maps spec §5.2 |
| An SMS provider for sign-in codes (today codes only go to the log) | Yes | `docs/deploy/runbook.md` |
| WhatsApp Business verification and message templates approved (sign-in code, order updates, parents' messages) | Yes | `docs/whatsapp-templates.md` |
| Push notifications working on 5 test phones | Yes | launch playbook §7 |
| A cheap Android phone as our reference test phone | Probably | maps spec §11 |
| Road routing server (OSRM), until then times are straight-line estimates | No | `docs/deploy/hosting.md` |
| Apple developer account (iPhone comes after Android) | No | `docs/deploy/mobile.md` |
| Our own domain; Sentry crash reports (server, three apps and the Console are built and switched off: only a Sentry account and the DSNs are needed; the customer app's speed reports ride the same DSN) | No | `docs/deploy/web.md`, `docs/deploy/hosting.md` "Logs and errors" |

## 3. Built, but not finished for real phones

| What | Blocks launch | Details |
|---|---|---|
| Phones show a simple zone sketch, not a real street map (the web version has the real map) | Yes | maps spec §2 |
| The driver app's location with the app closed: built 2026-10-07 (Android foreground service + background task), **not yet tried on a real phone**; Google Play needs the background-location declaration (disclosure screen + short video) | Yes | `apps/partner/README.md` "Known gaps" |
| Live updates on phones tested on web only, not on a device | Probably | `docs/api/live.md` |
| The food screens (/food street, the four door pages, the night look) checked on the web only: on a real phone, check the photo sizes and crops, the hero's settle-in, scrolling smoothness and that dish photos from the server load and stay cached (Ali 2026-10-08: "have in the to do later") | Probably | `apps/customer/src/features/food-landing/`, `apps/customer/src/features/doors/` |
| Selfie check and face match accept any photo; menu import from a photo is a stub | Probably | `docs/api/partner-merchant-wave2.md` |
| Receipt printer (Bluetooth) and the restaurant's camera for evidence photos | Probably | `apps/merchant/README.md` |
| School-run (خطوط) daily runs aren't created automatically from a subscription | Probably | `docs/api/partner-merchant-wave2.md` |
| AI first-line support from the support spec isn't built | Probably (it's on the launch checklist) | `docs/specs/2026-10-02-notifications-and-support.md` |
| Launch content: 50+ landmarks and meeting points with photos, canned support replies, a full dress rehearsal, kill switches tested | Yes | launch playbook §7 |

## 4. Parents' WhatsApp messages (خطوط), notes for when we build it

What Ali asked for (2026-10-06):
- A WhatsApp message to the parent **when the child gets on** and **when the child arrives**.
- Each message carries the **car details** (driver's name and photo link, car, colour, plate) and the
  **trip details** (pickup and drop-off places, times, the route), in a professional, consistent style.
- Ali will decide the exact contents and design later.

Things to settle then:
- The WhatsApp Business templates must be approved by Meta before use (today's `wa.khat_dropped` says
  «صعد/وصل», which assumes a boy).
- Either ask parents for the child's gender, or write neutral wording.
- Which number sends the messages, and what happens when WhatsApp fails (SMS fallback?).

Where it lives today: `khat.guardian_*` and `push.khat_dropped.body` in the locale files, the WhatsApp
template `wa.khat_dropped` (`docs/whatsapp-templates.md`), and `khat_child_arrived` in the notify module.

## 5. Parked features, after launch unless Ali says otherwise

These come from Ali's boards (joy audit, map plan). Full lists are in the specs. None blocks launch.

- **Customer app:** night theme (the app stays light until then); Silver and Gold tiers once points can
  be spent; a real illustrator, a menu photo day, real sound recordings, animated moments, the Apple
  Wallet pass; group order link, home-screen widgets, «شنو آكل اليوم؟»; Ramadan mode (to be live by
  mid-January 2027). See `docs/specs/2026-10-05-customer-joy.md` §5–§7.
- **Maps, later wave:** lock-screen tracking, journey recap, the school-run route map for parents,
  best route for two orders, cook-on-time, missing streets («where a restaurant's customers are»
  was built on 2026-10-07). Parked:
  incident layer, TV-wall map, weather, delivery PIN, driver goals, shift booking, new-area launch kit.
  See `docs/specs/2026-10-05-maps-world-class.md` §5.5–§5.8 and §10.
- **Menu photos** (Ali, 2026-10-07): the menu photo shoot service is built and stays visible
  (merchant «تصوير المنيو», partner field-ops shoots, Console list; free, no fee). Later: a push to
  field ops when a restaurant asks for a shoot (today only the count on their Ops tile), and menu
  photos made with AI instead of shoots («we will use ai»).
- **Server:** road-time dispatch (learned travel times were built on 2026-10-07); a separate worker process (only needed at
  thousands of orders a day); the Console's sign-in token in a secure cookie.

## 6. Small known gaps, fix when convenient

- Seat-PIN alerts have no "handled" button (they disappear after an hour); a PIN from another car isn't matched.
- A blocked or expired driver goes offline only at his next check-in (up to 30 seconds).
- No automatic flag for couriers who send change to the wallet far more often than others.
- Two kinds of pending request are lost if the server restarts (`docs/persistence.md`).
- Older review notes that may be out of date: `docs/research/2026-10-04-apps-review.md` #13, #18, #23, #26, #32.

## 7. Platform (servers, tests, alerts): dated work and parked items

Added 2026-10-09 when Ali closed the platform thread. Unlike sections 1–6, the dated rows are already
agreed and only wait for their day; the platform work restarts from here.

| When | What | Who | Details |
|---|---|---|---|
| Before 2 Nov | Upgrade Supabase to Pro (Ali said yes on 2026-10-08) | Ali | `docs/deploy/supabase.md` |
| Before 9 Nov | Type the test sign-in code `STAGING_TEST_OTP` into GitHub → Settings → Environments → staging (only there, never in chat) | Ali | `docs/deploy/staging.md` |
| 9 Nov | The big load test on the test server (bigger test server approved), results in `docs/launch/load-YYYY-MM-DD.md` | platform | `docs/launch/load-test.md` |
| Before 20 Nov | Try each Game day button once on a quiet day | platform | `.github/workflows/game-day.yml` |
| 26 Nov, 14:00–18:00 | Game day on the test server; failed rows re-run by 2 Dec | Ali + platform | `docs/launch/game-day.md` |
| When the real server is set up | Error reports (`SENTRY_DSN` on the real API) and uptime monitors with email alerts (Better Stack, free) | platform | `docs/deploy/hosting.md` "Logs and errors" |
| Week before launch | Phone-call alerts (Better Stack Responder, about $29 a month): the alert phone number goes only into Better Stack's own settings, never into this repo | Ali | — |
| Each test-server run | Approve it when GitHub asks ("Review deployments") | Ali | — |

Parked (start when convenient, no date):

- Two database clean-ups wait behind the other teams' database changes: the old-data clean-up (#38) and
  the events index. Each takes the next free migration slot when picked up (`docs/launch/migrations.md`).
- Game day row 11 (the nightly money close on a web machine) has no on-demand start yet; until it does,
  that row is run by hand around the scheduled close time.
- Sign-in texts and phone notifications wait with no time limit if their provider hangs
  (`apps/api/src/shared/messaging/http.ts`, lane D's); game day row 6 will show it.
