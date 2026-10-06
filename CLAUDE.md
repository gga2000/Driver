# Driver (درايفر) — guide for Claude Code

## Status (read this first)
As of commit `b702d90` on `main`: Phase 1 (launch blockers), Phase 2 (system polish) and Phase 3
(signature moments — "الخردة علينا" cash hand-off, driver money moments, الرجعة garage mode, merchant/
Console moments, the honest-delay promise) of `docs/research/ui-ux-audit/README.md` are built and
pushed. Verified on 2026-10-06 at `b66c9c5` from a fresh install: build, typecheck, lint, the full
test suite and `pnpm sim --orders 2000 --seed 1 --ci` (18/18 invariants, change-to-wallet exercised)
all pass. The Phase 3 merge had broken `apps/customer/scripts/demo-api.mjs` (fixed in `70c128e`).
Phase 3 follow-ups (Ali's 2026-10-06 decisions: two-step honest delay, free-delivery credit, the G-91
shift guarantee, the خطوط sweep alert and 3-second look, plus screenshot fixes) are merged; the sim now has
20 invariants (`late_credit_once_per_delivery`, `shift_guarantee_once_and_exact`).
**Shift guarantee (G-91): built, switched off by Ali on 2026-10-06** ("hold it, switch it off") — the
money rule `MoneyRules.guarantee.enabled` is `false`: the server pays no top-up, the partner app shows no
guarantee line, the sim asserts nothing is paid. Don't turn it on or show progress toward it until Ali
decides — see `docs/api/shift-guarantee.md`.

Open product decisions Ali has not yet made (ask before building further on these):
tips after a 5-star rating; the real WhatsApp support number; public driver photos; who is on duty
for SOS and the escalation target; a masked-call provider;
the shift guarantee (G-91: built but switched off — pay it at all? and if so peak shifts 12–16 and 19–23,
couriers only, a minimum online time?).

Decided by Ali on 2026-10-06 (see the dated section at the end of
`docs/specs/2026-10-03-edge-case-decisions.md`): change-to-wallet limits approved (25,000 cap, 50,000
tender limit) and extra cash must be named; honest delay in two steps (10 min apology + new time, 20
min delivery fee back; free delivery → 1,000 دينار); the G-91 shift guarantee was built to be paid by
the server, then switched off by Ali the same day (open decision); خطوط sweep alert to ops after 5 min, seat PIN stays on the lock screen
(every PIN typed is logged; cross-use and 3 wrong PINs on a seat alert ops on the Console safety strip), 3-second pause before the sweep.
All 23 Phase 3 review problems are fixed (review board: Ali's artifact, see memory). Open: guardian messages (`khat.guardian_*`, `push.khat_dropped.body`, WhatsApp `wa.khat_dropped`) still say «صعد/وصل» for every child; child records have no gender (the partner app uses neutral copy); changing the WhatsApp template needs re-approval — ask Ali.

A separate session may be working on `packages/map/**`, map feature folders, the zones/places API,
and the Console zones/map pages — check recent commits (`git log --oneline -20`) before touching those.

## Who you're working with
Ali is the founder (Aziziyah, Wasit, Iraq). He is **not a coder**: he reviews outcomes by looking at
the running apps and screenshots, and decides product questions. Talk in plain language, show him
the result (open it in the studio or send a screenshot), and keep code talk out unless he asks.
Ask before anything hard to undo (deleting data, changing money rules, renaming app IDs). Current
focus: **UI and UX polish** of the three apps and the Console.

## What this is
A super-app for Aziziyah: food delivery (first), taxi/tuktuk (تكتك), intercity الرجعة
(Aziziyah⇄Baghdad/Kut seats from garages), خطوط (school/work subscription routes), later grocery and
parcels. Cash-first, Iraqi Arabic, RTL.

| App | Who | Path | Studio URL |
|---|---|---|---|
| Driver | customers | `apps/customer` (Expo) | http://localhost:8081 |
| Driver Partner | couriers, taxi/tuktuk, الرجعة and خطوط drivers, fleet owners, field ops | `apps/partner` (Expo) | http://localhost:8082 |
| Driver Merchant | restaurants (tablet + phone) | `apps/merchant` (Expo) | http://localhost:8083 |
| Console | dispatch, support, approvals, cash, control room | `apps/console` (Next.js) | http://localhost:3100 |
| API | everything server-side | `apps/api` (NestJS + tRPC) | — |

## Run it
```sh
pnpm install          # first time, and after pulling changes that touch package.json
pnpm studio           # everything, live reload, demo data → open http://localhost:4000
pnpm studio customer  # just one or a few apps (customer | partner | merchant | console)
```
No database, Docker or accounts needed: each app uses its demo API (the real API running in memory
with realistic Aziziyah data, `apps/<app>/scripts/demo-api.mjs`). Edit a screen and it reloads by
itself. Logs: `.studio/logs/<service>.log`. Ctrl+C stops everything. If a port is busy, an old studio
is still running: stop it (find the process, kill it by PID — never `pkill -f`).

Demo sign-in (the OTP fills itself on the code screen in demo mode):
- Customer: any number, e.g. `0770 222 3344`
- Partner: courier `0770 111 0001`, tuktuk `…0002`, الرجعة `…0003`, خطوط `…0004`, fleet owner `…0005`, field ops `…0006`
- Merchant: owner of مطعم خالد `0770 123 4567`, staff at two stores `0770 999 0000`
- Console: `0770 000 0001` (everything), `…0002` field ops, `…0003` support

Each app's README lists the demo hooks (e.g. put an order on the way, open a chat, seed الرجعة
departures). The UI component gallery (every shared component in all its states): `pnpm --filter @driver/ui gallery:dev`.

## UI/UX rules (non-negotiable)
- **Iraqi Arabic first, RTL by default.** All copy lives in `packages/i18n/src/locales/ar-IQ.json` (+ `en.json`
  parity, tests enforce it) for customer/partner, `apps/merchant/locales/*.json` for merchant. Never
  hard-code strings. Voice: `docs/specs/2026-10-02-voice-and-microcopy.md` — amounts say **"دينار"**,
  **Western digits 0–9**, natural Iraqi phrasing (دليفري for food couriers, السايق for drivers).
- **Brand** (`docs/specs/2026-10-03-brand.md`): warm light cream. Colours, spacing, radii and type only
  from `packages/design-tokens`; components from `packages/ui` (add new shared ones there). Accent
  `#E08A1E` with dark text on it (white fails contrast). Font: IBM Plex Sans Arabic (it has no ✓
  glyph — use the check icon).
- Tap targets ≥ 44 px; every screen needs loading, empty, error and offline states.
- Look at your work: after a UI change, open it in the studio or take a screenshot (each app has
  `scripts/web-shots.mjs` / `scripts/shots/*.mjs`; see its README) and check RTL alignment, clipped
  Arabic, numbers, and spacing before calling it done.

## Engineering rules
- Before committing: `pnpm typecheck && pnpm lint && pnpm test` must pass. Commit small, clear
  messages; push to `main` (GitHub Actions CI runs Postgres integration tests, the simulator and the
  migration drift check).
- Money, prices and fees are **always computed on the server** (never trust a client total). Ledger
  is append-only. Don't change money rules without asking Ali.
- API modules only import each other through their `index.ts` (ESLint enforces). Personal data (names,
  phones, children's names) lives only in the `identity_vault` schema.
- New database tables: add a Prisma migration; any migration that creates a table must end with
  `SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');`
  (Supabase lock-down; a test enforces it).

## Where things are
- Specs: `docs/specs/` (customer app, partner & merchant apps, console, money & ops, dispatch &
  pricing, edge-case decisions, brand, voice). Architecture: `docs/architecture.md`.
- API procedure docs: `docs/api/`. Reviews and open items: `docs/research/2026-10-04-*-review.md`.
- Going live (Supabase Frankfurt + Fly.io + Cloudflare Pages + EAS): `docs/deploy/`. App IDs:
  `iq.driver.customer`, `iq.driver.partner`, `iq.driver.merchant` (confirmed by Ali 2026-10-05 — never change).
- Phones: the apps are Expo SDK 52. The App Store / Play "Expo Go" app only runs the newest Expo SDK,
  so seeing them on a real phone needs a development build (`expo run:ios` with Xcode, or an EAS
  build — `docs/deploy/mobile.md`). Until then, review on the web studio at phone/tablet sizes.
