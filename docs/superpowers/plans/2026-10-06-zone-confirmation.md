# Drivers Confirm Zones (SP3 §5.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ali draws each zone's outline in the Console (`placed`); drivers on the ground confirm it. At the end of a delivery, rarely, the done screen asks «انت بمنطقة {zone}؟» with «إي» / «لا» and a quiet «ما أعرف». Three "إي" from two or more drivers make the zone `confirmed`; a "لا" flags it in the Console zone tool («سايق قال لا»), which also shows the count («2/3 تأكيد»).

**Architecture:** Trips adds `finalDrop { cityId, lat, lng, accuracyM }` to the `stop.completed` payload, only on the drop-off that ends the trip and only when the arrival fix is known. The zones module subscribes (`zones:driver-checks`, through the outbox) and, when the rules allow, writes one `zone_checks` row (`zc_<stopId>`). The Partner app reads `partner.zoneCheck` on the done screen and answers with `partner.answerZoneCheck`; both go to `ctx.zoneChecks` (`ZoneChecksService`, zones module), so the partner module gains no new dependency. A "yes" that completes the count calls `ZonesService.confirmByDrivers` (repository `confirm`, `zone.confirmed` event, audit as `system:zone-checks`); a "no" calls `ZonesService.flagByDriver` (`zone.flagged` event, audit with the driver as actor). `ops.zones.list` rows carry `checks { yes, no, drivers, flaggedAt }`.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.3 ("Driver confirmation"), decision D4.

## Constants (`ZONE_CHECK_RULES`, packages/contracts zones-io.ts)

| Rule | Value | Why |
|---|---|---|
| `perDriverPerDay` | 1 | One tap after a delivery, never a survey. Baghdad local day (`startOfLocalDay`). |
| `yesToConfirm` | 3 | Spec. |
| `distinctDrivers` | 2 | Three yeses from one driver is one opinion. |
| `maxAccuracyM` | 30 | Same bar as the door learning (`DOOR_RULES`): worse can't tell which side of a border he stood. |
| `answerWithinMin` | 30 | After that he has driven on; the question is not shown and an answer is refused (`zone_check_expired`). |

`ZONE_CHECK_VERTICALS`: food, grocery, errand, parcel, taxi, tuktuk. الرجعة and خطوط have their own end screens (and children on board) and are never asked.

## Decisions (and where they differ from the brief)

1. **Which zone is asked about:** the *placed* outline that contains the courier's arrival fix (point-in-polygon), not the stop's `zoneKey`. The stop's zone comes from the customer's pin and the seed centroids (pricing still uses them until SP3b); the question is meant to test the drawn outline, so the driver's own position decides. A fix outside every placed outline asks nothing.
2. **Drafts are never asked.** An AI hexagon has nothing drawn to confirm, and the lifecycle is draft → placed → confirmed. Confirmed zones are never asked (spec).
3. **Only the drop-off that ends the trip.** The card shows on the job's done screen; asking about the first drop of a batch while he stands at the second would ask about the wrong place.
4. **Answers belong to an outline version.** `zone_checks.outline_at` = the zone's `placed_at` when asked. Redrawing the outline starts the count again, clears the flag, hides any open question about the old outline, and `confirm` only succeeds if the outline is still the one asked about.
5. **A "no" holds confirmation** until the field team fixes and saves the outline (which starts a new count). Later yeses don't outvote it. Ali (2026-10-06): kept, and the team can also clear it with «تم الفحص» (see the dated section at the end).
6. **"ما أعرف" is recorded** (`answer = 'unsure'`, counted neither way) so the same question does not come back on his next job. The brief had only yes/no.
7. **Zone names come from the server** in the prompt (`name_ar` with Western digits, `name_en`): zones added or renamed in the Console have no seed for the app's `zoneName`.
8. **Late events:** a quarantined (late-replay) event, or one delivered after the question would already have expired, asks nothing.
9. **Done screen:** the 4 s auto-return home is held while the first read after the job is pending, and while the card waits for a tap; a failed read lets go. Tapping hides the card at once; the answer is sent, «تسلم، وصل جوابك» on success, the standard error toast on failure. Offline-saved jobs never read or show it.
10. No money rule changes. Pseudonymous table (person ids only), no positions stored.

## Data

`zone_checks` (migration `20261006181000_zone_checks`, ends with `driver_harden`): id (`zc_<stopId>`), city_id, zone_key, outline_at, driver_id, trip_id, stop_id (unique), asked_at, answer (yes | no | unsure, null while open), answered_at, created_at. Indices (driver_id, asked_at) for the per-day rule and the open question, (city_id, zone_key) for the tally. `zones.verified_at` is set when drivers confirm.

## API

- `partner.zoneCheck` (driving roles) → `ZoneCheckPrompt { checkId, zoneKey, name_ar, name_en, expiresAt } | null`.
- `partner.answerZoneCheck` (driving roles) `{ checkId, answer: 'yes' | 'no' | 'unsure' }` → void. Someone else's or unknown check: `zone_check_not_found`; past 30 min: `zone_check_expired`; a second answer is ignored (first wins).
- `ops.zones.list` / `ops.zones.map`: `checks` on placed and confirmed zones.

## Tasks

- [x] Contracts: `ZONE_CHECK_RULES`, `ZONE_CHECK_VERTICALS`, `ZoneCheckAnswer`, `ZoneCheckPrompt`, `AnswerZoneCheckInput`, `ZoneCheckTally`, `ZonePlacementView.checks`, `ZoneChecksPort` (`ctx.zoneChecks`), partner procedures, `StopCompletedPayload.finalDrop`, two error codes (+ router role/input tests).
- [x] DB: `ZoneCheck` model + migration.
- [x] API: trips `finalDrop` (+ batch test); zones `ZoneChecksRepository` (memory + Prisma), `zone-checks.logic.ts`, `ZoneChecksService` (subscriber, `open`, `answer`), `ZonesRepository.confirm`, `ZonesService.confirmByDrivers` / `flagByDriver` / `namesOf` / tallies in `list`; module + tRPC context wiring. Tests: asking rules, once a day (Baghdad midnight), confirmed never asked, quarantined/late ignored, 3-yes/2-driver rule, a no flags and holds, redraw resets, unsure, expiry, someone else's check; Postgres round trip in the integration suite.
- [x] Partner: `ZoneCheckCard`, `useZoneCheck` / `useAnswerZoneCheck`, `zoneCheckMoment` (+ tests), `DonePanel` `ask` / `hold`.
- [x] Console: «{yes}/3 تأكيد» on the open placed zone, «سايق قال لا» on the list row and the open zone (+ smoke test).
- [x] Copy: ar-IQ + en (partner, console, errors), voice glossary.

## Ali's decisions 2026-10-06

1. **One «لا» keeps holding the zone until the team checks it** (decision 5 above, kept). Later yeses still don't outvote it.
2. **NEW: «تم الفحص» in the Console zone tool clears the flag without redrawing.** Built:
   - `ops.zones.clearCheckFlag({ cityId?, key })` (`ZONE_EDIT_ROLES`: admin, field ops) → the zone's `ZonePlacementView`.
   - Storage: `zone_checks.cleared_at` / `cleared_by_id` (migration `20261006190000_zone_check_cleared`, additive, no new table). The clear marks the outline's unchecked "no" answers; the tally ignores marked ones, so a «لا» given later flags and holds again.
   - The "إي" answers about the same outline still count (the team vouched for that outline): if they already make 3 from 2+ drivers, the zone is confirmed at the clear, through the same path as a driver confirmation (`zone.confirmed` event + audit), with the Console user as actor.
   - The clear itself is audited (`zone.flag_cleared`, Console user, number of answers checked) and evented (`zone.flag_cleared`). A zone with no open flag (or a draft) is a no-op: nothing written, audited or evented, so a second tap is harmless. An unknown zone: `zone_unknown`.
   - Console: on the open flagged zone, editors get «تم الفحص» (44 px), behind a short confirm like «احذف المنطقة»; the flag chip goes and the «n/3 تأكيد» count shows.
3. **Both delivery and taxi/tuktuk drivers are asked** (`ZONE_CHECK_VERTICALS`, kept as is).
