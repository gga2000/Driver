# J5d — الرجعة, wallet and account: implementation plan

> **For agentic workers:** implement task by task, TDD for logic, commit after every task (plain-English
> message ending in the Co-Authored-By line). Steps use checkbox (`- [ ]`) syntax.

**Goal:** the customer app's الرجعة trip gets an ending and a ticket you can hold; the wallet explains
itself; the account knows who you are; the safety page becomes a place; chat and share carry live context.

**Spec:** `docs/specs/2026-10-05-customer-joy.md` §5.3 (r1 r4 w1 w5 w7 w9 l7 l8) and §5.5 J5d (r2 r3 r7 w8
w10). Design source: `docs/research/ui-ux-audit/2026-10-05-joy/4-rajaa-wallet-account.md` (R-03, R-04,
R-05, R-10, W-01, W-03, W-04, W-06, W-07, W-08, A-01, A-03, S-2) and `3-live-moments.md` (L-13, L-22).

**Architecture:** money and points figures come only from the API (savings sum, points earned per
booking, approval context are server reads); the app only formats. New persisted data: a seat rating
on `seat_bookings` and trusted contacts + safety switches on the identity vault row (one additive
migration, no new tables). Pure helpers live next to their screens in `apps/customer/src/features/*`
with Vitest tests; API logic gets service tests in the owning module.

**Tech stack:** Expo Router (SDK 52, installed packages only), `@driver/ui` (Istikan theme, `SketchScene`),
NestJS modules with in-memory + Prisma repositories, zod contracts, Vitest.

**Not in this slice (other sessions):** tips, driver photos, the الرجعة lock-screen push and the seat-PIN
attempt log (driver-7c); saved-places screens (driver-5a); Apple Wallet pkpass (later); points expiry of
claimed points (w3, a money rule, not built — the wallet only warns about *pending* points, which the
server already expires after 90 days).

**Already on main (skip):** driver cards on request offers, back buttons, part-of-day times, the pass
date line (J1); Istikan theme (J3a); `safe_arrival` scene (J4).

---

## File map

| Area | Files |
|---|---|
| Contracts | `packages/contracts/src/routes-io.ts` (BookingView `rating`, `pointsEarned`; `RateBookingInput`), `routers/routes.ts` (`rateBooking`), `identity-io.ts` (`trustedContacts`, `safety` prefs), `account-io.ts` (PayerApprovalView `context`, `WalletBalanceView.savings`), `share-io.ts` (`SharedTrip.arrivedAt`), `notify-io.ts` (`rajaa_arrived_contact`) |
| DB | `packages/db/prisma/schema.prisma`, migration `20261006180000_j5d_rating_trusted_contacts` (ALTER TABLE only) |
| API | `modules/routes` (rating, points earned, arrival notify event payload), `modules/identity` (trusted contacts, prefs), `modules/notify` (template + `tc:` recipients + `seat.completed_rider` mapping), `modules/orgs` (approval context binding), `modules/orders` (binds it), `modules/ledger/customer-wallet.ts` (savings), `modules/tracking/share-links.ts` (`arrivedAt`) |
| Customer | `features/rajaa/*` (fit.ts, BoardParts, DepartureTile, PassTicket, SafeArrival, trips.ts), `app/rajaa/*`, `app/(tabs)/{orders,wallet,account}.tsx`, `features/account/*` (wallet-format, wallet-lines.ts, ApprovalCard, MoneyIn), `app/profile/safety.tsx`, `features/chat/*`, `features/share/SharePanel.tsx`, `app/share/[token].tsx`, `app/help/index.tsx`, `scripts/demo-api.mjs` |
| Copy | `packages/i18n/src/locales/{ar-IQ,en}.json` (parity test) |
| UI | `packages/ui/src/components/ChatThread.tsx` (`status` subtitle, ordered quick replies) |

---

### Task 1 — r1 seats that fit you
- [ ] Test `features/rajaa/fit.test.ts`: `seatsForYou(dep)` counts `state==='free' && blocked===null`;
  `fitLabel` → `'fits'` (≥1), `'none_fit'` (free > 0 but none for you), `'full'`; `travellerPref` read/write
  falls back to null on storage errors.
- [ ] `features/rajaa/fit.ts` + device memory through `lib/profile` (`rajaaTravellingAs`).
- [ ] Board: chip row under the route «تسافر: نساء · غيّر» (sheet with رجال/نساء/عائلة the first time);
  `useBoard({ …, travellingAs })`; tile pill «باقي مقعد إلك» / «باقي {n} مقاعد إلك» / grey «المقعد الباقي ما
  يناسبك» + one-line reason, not tappable; seat sheet pre-selects the remembered choice.
- [ ] Commit.

### Task 2 — r7 faster board
- [ ] Test `groupBoard` split: `foldFull(departures)` → `{ open, full }`.
- [ ] Route as one row «بغداد ← العزيزية [⇅]» with the corridor as a small chip; calm line moves under
  the first garage heading as a caption; tiles compact (time · seats-for-you · price on one row, driver chip
  under, no seat map); full cars fold into one 44-pt line per garage «6:15 المسا · كاملة · علي».
- [ ] Screens at 360×740 show 2–3 cars. Commit.

### Task 3 — r3 boarding pass as an object
- [ ] `features/rajaa/PassTicket.tsx`: ticket shape (two half-circle notches cut at the perforation,
  dashed rule), PIN in `face="display"` digits, live «بعد 38 دقيقة» (reuse `DepartureTime` countdown,
  1-minute ticks), stub state (`kept`) after the trip: muted paper, seat · driver · time, «تذكرة محفوظة».
- [ ] Test `passPhase(booking, now)` → `before | boarding | onboard | kept`.
- [ ] Commit.

### Task 4 — w9 safety page (before r2: r2's ping needs the contacts)
- [ ] Contracts: `TrustedContact {name, phone, relation?}` (max 3) on `UpdateProfileInput.trustedContacts`;
  `MeView.trustedContacts[] {name, phoneMasked, relation}` and `MeView.safety {autoShareRajaa,
  autoShareNight, notifyOnArrival}`; `UpdateProfileInput.safety` partial.
- [ ] Identity: vault JSON `trusted_contacts`, `safety_prefs`; the first trusted contact *is* the emergency
  contact (kept in sync both ways, so SOS keeps working); `trustedContactsOf(personId, accessor, purpose)`
  logged vault read. Tests in `profile.test.ts`.
- [ ] Migration (ALTER TABLE `identity_vault.person_identities` ADD 2 JSONB columns).
- [ ] App `profile/safety.tsx`: (1) «ناس نثق بيهم» up to 3 (add/remove), (2) switches, (3) «شلون نحميك»
  list. Account row subtitle names the first contact and sharing state. Commit.

### Task 5 — r2 «وصلت بالسلامة»
- [ ] Contracts: `BookingView.rating {stars, tags, at} | null`, `BookingView.pointsEarned number | null`,
  `RajaaRatingTag` enum (on_time, calm_driving, clean_car, respectful, late, fast_driving, queue_jump),
  `RateBookingInput {bookingId, stars 1–5, tags}`; `routes.rateBooking`.
- [ ] API routes: `rate()` only own completed booking, once (`booking_already_rated`); views read points
  from the ledger group `seat:<bookingId>.*:points`; on completion, if the rider's `notifyOnArrival` is on,
  emit `seat.arrived_safe` → notify `rajaa_arrived_contact` to each trusted contact (`tc:<personId>:<i>`
  recipients). Tests: departures/rating service tests, notify mapping test.
- [ ] Migration column `seat_bookings.rating JSONB`.
- [ ] App `features/rajaa/SafeArrival.tsx` on the pass when `completed`: `SketchScene safe_arrival`,
  «الحمد لله على السلامة», route · «وصلت الساعة 7:42 المسا», «بلّغنا {contact} إنك وصلت» when on, «+{n} نقطة»,
  stars + chips (high/low sets) + «عندي مشكلة» (WhatsApp with the trip), «احجز رجعتك» → board on the
  reverse direction with `day` + `time` presets, «تكتك من الكراج للبيت؟» → `/ride?vehicle=tuktuk`.
- [ ] Test `returnTrip(booking)` (reverse direction, same weekday next week if past, same clock). Commit.

### Task 6 — r4 trips in طلباتي and Help
- [ ] Test `features/rajaa/trips.ts`: `upcomingTrips(bookings, now)` (held/booked/checked_in, soonest
  first) and `pastTrips` (completed/no_show/cancelled…) mapped into day sections with orders.
- [ ] طلباتي: pinned «رحلاتك الجاية» above running orders (route · day time · seat · PIN → pass); past
  seats join the day sections with a seat icon. Help lists bookings (→ WhatsApp with the trip). Commit.

### Task 7 — w1 points you understand
- [ ] Contracts/ledger: earn rules are the city money rules (`AZIZIYAH_MONEY_RULES.points`); no threshold
  exists (any number of points pays the delivery fee first), so no progress bar — just the rules and
  the pending-points expiry the server already returns.
- [ ] Wallet points card: «تكسب نقاط من كل أكل ومشوار ورجعة · 100 نقطة = 1,000 دينار · تنزل من التوصيل أول»,
  expiry warning strip when `pendingExpiresAt` ≤ 14 days. Commit.

### Task 8 — w7 money-in moment + new wallet
- [ ] Test `moneyInSince(lines, lastSeenId)` picks the newest top-up line not yet celebrated.
- [ ] One-time strip «وصل 25,000 دينار لمحفظتك» with a coin, success haptic (skipped on quiet days via
  `useSeason`/quiet flag), remembered per device. Balance 0 and no lines: «ما عندك رصيد بعد» + the
  one-line nudge, no lone «0»; points card hidden until the first points. Commit.

### Task 9 — w8 transactions
- [ ] Test `walletSections(lines, filter, now)`: day headers via `sectionByDay`-style grouping; filters
  الكل · أكل · مشاوير · الرجعة · شحن · نقاط; `lineHref(line)` → `/order/[id]` | `/rajaa/pass/[id]` |
  `/topup`.
- [ ] API: seat lines carry `bookingId` (WalletLine optional field, from the group id `seat:<bookingId>.…`).
- [ ] Commit.

### Task 10 — w5 approvals with context
- [ ] Contracts: `PayerApprovalView.context {merchantName, itemsSummary, itemCount, placeLabel} | null`.
- [ ] API: `HouseholdsRpc.bindOrderContext(reader)`; `OrdersModule.onModuleInit` binds a reader that
  returns the order's store name, first items and drop-off place name. Test in households.rpc.test.
- [ ] App `ApprovalCard`: «طلب من منار: مطعم خالد · 32,000 دينار», «4 أصناف · للبيت», «أكثر من الحد بـ
  7,000 (الحد 25,000)», buttons «وافق هالمرة» / «ارفض» + link «غيّر الحد» → household member. Commit.

### Task 11 — w10 account header
- [ ] API: `wallet.balance` returns `savedThisYearIqd` = Σ (points used `promo_funded points:*` + delay
  credits `credit_issued LATE_PROMISE_MEMO` + `cash_change_to_wallet` + merchant deals `promo_funded deal:*`)
  into the customer's account since 1 Jan Baghdad. Test in customer-wallet.test.
- [ ] Account header card: name, «{points} نقطة», «وفّرت {amount} دينار هالسنة» (hidden at 0) → wallet. Commit.

### Task 12 — l7 chat header
- [ ] Test `chatStatus(track)` → «بالطريق · 4 دقايق» / «عند بابك» / null and `orderQuickReplies(keys, phase)`.
- [ ] `ChatThread` gains optional `status` (subtitle; tap → back to the map) and the app passes ordered
  quick replies. Commit.

### Task 13 — l8 share sheet + page
- [ ] `SharePanel`: preview card of what family sees (first name, car, plate, live map pin icon), primary
  «دز على واتساب» (`wa.me/?text=`), secondary «شارك بطريقة ثانية», no raw URL.
- [ ] API `SharedTrip.arrivedAt` (also on an expired link whose trip arrived); page shows «المشوار خلص
  بالسلامة الساعة 6:12 المسا» instead of «انتهت المشاركة». Test in share-links.test. Commit.

### Finish
- [ ] `git fetch && git rebase origin/main`; `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] Screenshots 390 and 360 (before/after) to the scratchpad `j5d/`; look critically; fix.
