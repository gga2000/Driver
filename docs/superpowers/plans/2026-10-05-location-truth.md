# Location Truth (SP4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Driver positions are real and honest end to end: the Partner app sends each fix with its own timestamp, accuracy, device speed/heading and the fake-GPS flag, buffers fixes while offline, never invents a position in production; the API refuses fake, inaccurate or out-of-order fixes, keeps late replays out of live tracking, flags fake GPS and impossible jumps to support (never penalising), and deletes trails after 30 days.

**Architecture:** Shared rules (`POSITION_RULES`) and the device-fix schema live in `@driver/contracts`. A pure `assessFix` decides accept / trail-only / reject per fix; `TripsService.reportDevicePositions` applies it only on the device path (`trips.reportPosition` and the new batch `trips.reportPositions`) — the simulator and demo seeds keep calling the trusted internal `reportPosition`. Suspicion is counted per driver per day and emitted once as `driver.position_suspect`; support opens an incident. A new `retention` module purges trail points older than 30 days hourly, keeping trails of trips with an open incident. Partner gets a pure `FixBuffer` + report builder and honest `currentFix`.

**Tech Stack:** TypeScript, zod, tRPC, NestJS, Prisma raw SQL (PostGIS), Expo (expo-location), vitest.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.4 (f5, f8, o8), decision D6. Road routing and one ETA are SP4b (separate plan).

---

## Decisions made while planning (logged here, reflected in the spec)

1. **Jumps are flagged, not refused.** An implied speed above 160 km/h over more than 300 m is counted (5 in a day → support incident). Refusing them would freeze tracking after one GPS glitch and breaks the scripted e2e run, which moves the courier instantly.
2. **Refused:** Android mock-location fixes (`mocked`), accuracy worse than 75 m, and fixes not newer than the driver's last stored fix. **Clamped:** a device time more than 5 s ahead of the server becomes server time. **Trail only:** fixes older than 2 min (offline replays) are stored but never arm geofences, schedule auto-complete or reach the live map.
3. **Presence:** the app never sends the town-centre fallback in production. Going online needs a real fix (else "نحتاج موقعك…"); heartbeats re-send the last real fix. The demo position stays for `DEV_TOOLS` web builds only.
4. **Retention:** trail points older than 30 days are deleted (hourly batches); the trip row itself is the summary. Trails of trips with an unresolved incident are kept.

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/trip.ts` | `POSITION_RULES`, `DeviceFix`, `mocked` on `ReportPositionInput`, `ReportPositionsInput`, `PositionRejectReason`, `rejected` on the output, `reportPositions` on `TripsPort`. |
| `packages/contracts/src/routers/trips.ts` | `trips.reportPositions` (driving roles). |
| `apps/api/src/modules/trips/position-guard.ts` (+test) | Pure `assessFix(fix, last, now)` → accept / trail_only / reject, plus jump detection. |
| `apps/api/src/modules/trips/position-suspicion.ts` (+test) | Per driver/day/reason counter that says when to raise a flag. |
| `apps/api/src/modules/trips/trips.service.ts`, `trips.rpc.ts` | `reportDevicePositions`, live vs trail-only path, suspicion events. |
| `apps/api/src/modules/trips/trips.repository.ts` | `purgeTrail(cutoff, keepTripIds, batch)` (Prisma + memory). |
| `apps/api/src/modules/support/support.service.ts` | Incident on `driver.position_suspect`; `openIncidentTripIds(cityId)`. |
| `apps/api/src/modules/retention/*` (new) | Hourly trail purge (30 days). |
| `apps/partner/src/lib/location.ts`, `location.native.ts` | Honest `currentFix` (timestamp, accuracy, speed, heading, mocked), last real fix memory, `DEMO_FIX` for dev web only. |
| `apps/partner/src/features/work/position-report.ts` (+test) | Pure `toDeviceFix`, `usableForTrail`, `FixBuffer`. |
| `apps/partner/src/features/work/useJobPositions.ts`, `usePresence.ts` | Batch reporting with an offline buffer; online/heartbeat without invented positions. |
| `packages/db/prisma/schema.prisma`, `docs/specs/2026-10-02-domain-and-events.md` | Retention wording (30 days). |

---

### Task 1: Contracts — rules, device fix, batch procedure

- [ ] **Step 1:** In `packages/contracts/src/trip.ts` add before `ReportPositionInput`:

```ts
/**
 * What the API accepts from a driver's phone (maps program SP4a). Shared by the Partner app (it filters
 * before sending) and the API (it decides). Jumps are flagged, never refused: one GPS glitch must not
 * freeze tracking.
 */
export const POSITION_RULES = {
  /** Worse than this (metres) is noise: refused. */
  maxAccuracyM: 75,
  /** A device clock ahead of the server by more than this is clamped to server time. */
  maxAheadMs: 5_000,
  /** Older fixes (offline replays) are stored in the trail but never drive live tracking or geofences. */
  liveMaxAgeMs: 120_000,
  /** Implied speed above this between two fixes, over more than `jumpMinM`, counts as a jump. */
  jumpKmh: 160,
  jumpMinM: 300,
  /** Jumps in one day before support is asked to look (a fake-GPS fix flags at once). */
  jumpsBeforeFlag: 5,
  /** Fixes per `trips.reportPositions` call. */
  batchMax: 60,
  /** Fixes the app keeps while offline (20 min at one every 5 s). */
  clientBufferMax: 240,
} as const;

/** Why a fix was refused. */
export const PositionRejectReason = z.enum(['mocked', 'inaccurate', 'out_of_order']);
export type PositionRejectReason = z.infer<typeof PositionRejectReason>;

/** One fix as the phone measured it: its own timestamp, accuracy and (when known) speed and heading. */
export const DeviceFix = z.object({
  pin: LatLng,
  at: z.coerce.date(),
  speedKmh: z.number().min(0).optional(),
  bearing: z.number().min(0).max(360).optional(),
  accuracyM: z.number().min(0).optional(),
  /** Android: the OS says a mock-location app produced this fix. */
  mocked: z.boolean().optional(),
});
export type DeviceFix = z.infer<typeof DeviceFix>;
```

Change `ReportPositionInput` to `DeviceFix.extend({ tripId: z.string().optional() })` (same fields plus `mocked`), add

```ts
export const ReportPositionsInput = z.object({ fixes: z.array(DeviceFix).min(1).max(POSITION_RULES.batchMax) });
export type ReportPositionsInput = z.infer<typeof ReportPositionsInput>;
```

and extend `ReportPositionOutput` with `rejected: z.array(z.object({ index: z.number().int(), reason: PositionRejectReason })).optional()`. `TripsPort` gains `reportPositions(actor: Actor, input: ReportPositionsInput): Promise<ReportPositionOutput>;`.

- [ ] **Step 2:** `routers/trips.ts`: `reportPositions: protectedProcedure(DRIVING_ROLES).input(ReportPositionsInput).output(ReportPositionOutput).mutation(({ ctx, input }) => ctx.trips.reportPositions(ctx.actor, input)),`
- [ ] **Step 3:** Contracts typecheck + tests; commit.

### Task 2: Pure position guard (API)

`apps/api/src/modules/trips/position-guard.ts`:

```ts
import { POSITION_RULES, type DeviceFix, type LatLng, type PositionRejectReason } from '@driver/contracts';
import { haversineMeters } from './geofence.js';

export type FixVerdict =
  | { kind: 'reject'; reason: PositionRejectReason }
  /** Store it; `live` = also geofences, auto-complete and the live map. `at` may be clamped. `jump` = implausibly far from the last fix. */
  | { kind: 'accept'; at: Date; live: boolean; jump: boolean };

/**
 * The API's judgement on one fix from a driver's phone, given his last stored fix. Pure: the caller
 * stores, fans out and counts suspicion.
 */
export function assessFix(fix: DeviceFix, last: { at: Date; pin: LatLng } | null, now: Date, rules = POSITION_RULES): FixVerdict {
  if (fix.mocked) return { kind: 'reject', reason: 'mocked' };
  if (fix.accuracyM !== undefined && fix.accuracyM > rules.maxAccuracyM) return { kind: 'reject', reason: 'inaccurate' };
  const at = fix.at.getTime() > now.getTime() + rules.maxAheadMs ? now : fix.at;
  if (last && at.getTime() <= last.at.getTime()) return { kind: 'reject', reason: 'out_of_order' };
  const live = now.getTime() - at.getTime() <= rules.liveMaxAgeMs;
  let jump = false;
  if (last) {
    const metres = haversineMeters(last.pin, fix.pin);
    const hours = (at.getTime() - last.at.getTime()) / 3_600_000;
    jump = metres > rules.jumpMinM && metres / 1000 / hours > rules.jumpKmh;
  }
  return { kind: 'accept', at, live, jump };
}
```

Tests (`position-guard.test.ts`): mocked → reject; accuracy 80 → reject, 75 → accept; ahead by 60 s → `at` = now; same or older `at` than last → out_of_order; 3 min old → accept with `live: false`; 1 km in 10 s → `jump: true`; 250 m in 1 s → `jump: false` (under `jumpMinM`); 1 km in 60 s (60 km/h) → no jump; first fix (no last) → live accept.

### Task 3: Suspicion counter (API)

`position-suspicion.ts`: `class SuspicionCounter { constructor(rules = POSITION_RULES) ; note(driverId, reason: 'mocked' | 'jump', day: string): boolean }` — returns true exactly once per (driver, day, reason) when the count reaches the threshold (`mocked`: 1, `jump`: `jumpsBeforeFlag`). Keeps only today's and yesterday's keys. Tests: mocked flags first time only; jump flags at the 5th only; a new day starts over; other drivers independent.

### Task 4: Device path in TripsService

- `reportDevicePositions(driverId, fixes: DeviceFix[], tripId?)`: sort by `at`; for each fix, `last` = the previous accepted fix in this batch, else `repo.lastTrailPoint({ driverId })`; `assessFix`; collect `rejected[]`; accepted live fixes go through the existing `reportPositionTx` + listeners; trail-only fixes go through a new `storeTrailOnly` (trail rows for his trips in progress, else an idle row; no geofence, no auto-complete, no fan-out). `armed` = the last live fix's `armed`.
- Suspicion: `mocked` rejects and `jump` accepts call `counter.note(driverId, reason, localDay(now))`; when it returns true, emit `driver.position_suspect` (aggregate `driver:<id>`, payload `{ reason, day, pin }`).
- `trips.rpc.ts`: `reportPosition` → `reportDevicePositions(actor.personId, [input], input.tripId)`; `reportPositions` → `reportDevicePositions(actor.personId, input.fixes)`.
- Tests in `trips.service.test.ts` style with the in-memory repo: a batch with one mocked, one inaccurate, one old and two live fixes → 2 rejected (indexes), trail has 3 rows, only the live ones reach a position listener; an internal `reportPosition` call is not guarded (simulator path).

### Task 5: Support incident and kept trips

- `SupportService.onModuleInit` subscribes `support:position_suspect` to `driver.position_suspect` → `create({ kind: 'incident', channel: 'system', subject: 'موقع السايق مشكوك بيه', note: mocked ? 'التلفون يگول الموقع جاي من برنامج تزوير موقع. راجع قبل أي إجراء.' : 'الموقع قفز مسافات مستحيلة أكثر من 5 مرات اليوم. ممكن خلل GPS أو تزوير. راجع قبل أي إجراء.', tripId: null, orderId: null, customerId: null, openedById: driverId, sourceKey: 'position_suspect:<driver>:<day>:<reason>' })`, idempotent by source key.
- `openIncidentTripIds(cityId)`: unresolved `incident` tickets with a trip id (`repo.list`, limit 1000).
- Test: emitting the event twice opens one incident.

### Task 6: Trail retention (30 days)

- `TRAIL_RETENTION_DAYS = 30` in contracts `trip.ts` (documented as decision D6).
- Repository `purgeTrail(cutoff: Date, keepTripIds: readonly string[], batch: number): Promise<number>` — Prisma:

```sql
WITH doomed AS (
  SELECT "id", "at" FROM "public"."trail_points"
  WHERE "at" < ${cutoff} AND ("trip_id" IS NULL OR NOT ("trip_id" = ANY(${keep}::text[])))
  LIMIT ${batch}
)
DELETE FROM "public"."trail_points" t USING doomed d WHERE t."id" = d."id" AND t."at" = d."at"
```
  memory: filter the array. Test with the memory repo.
- `apps/api/src/modules/retention/{retention.module.ts,trail-retention.ts,index.ts}`: `TrailRetention` (`@Injectable`, `OnModuleInit`/`OnModuleDestroy`), hourly `setInterval` (unref'd, `running` guard like `RoutesScheduler`), `tick()` = cutoff `now − 30 d`, keep = `support.openIncidentTripIds('aziziyah')`, purge in batches of 5,000 until a batch comes back short, log the count. Test `tick()` with memory repos and a fake clock.
- Register `RetentionModule` in `app.module.ts` (next to the other feature modules).
- Docs: TrailPoint comment in `schema.prisma`, domain spec §13 and platform-core §9 say "30 days, then the trip row only; kept while an incident is open".

### Task 7: Partner — honest fixes and buffered reporting

- `src/lib/location.ts` (web) and `location.native.ts`: `Fix` gains `at: number` (fix time, ms), `accuracyM?`, `speedKmh?` (from m/s, ≥ 0), `bearing?` (0–360, only when moving), `mocked?` (native `mocked`). Both remember the last real fix (`lastRealFix()`). `FALLBACK_FIX` → `DEMO_FIX`, documented as dev/demo web only.
- `src/features/work/position-report.ts` (+test): `usableForTrail(fix)` (accuracy ≤ 75 m, not mocked), `toDeviceFix(fix, prev)` (device speed/heading, else computed from the previous fix using fix timestamps), `class FixBuffer` (push drops the oldest past `clientBufferMax`; `peek(n)`; `drop(n)`; skips a fix not newer than the last one held).
- `useJobPositions`: every 5 s take a fix → if usable, push; send `peek(batchMax)` with `trips.reportPositions`; on success drop them; on a network error keep them (next tick retries); on a 4xx drop them (never retry a refused batch forever).
- `usePresence`: `bestFix(status)` → `currentFix() ?? lastRealFix() ?? (DEV_TOOLS ? DEMO_FIX : null)`; no fix when going online → warning toast `partner.location_needed`, stay offline; heartbeat with no fix at all → skip.

### Task 8: Verify and ship

`pnpm typecheck && pnpm lint && pnpm test`; studio: courier `0770 111 0001` goes online on web (dev demo fix), a job's positions reach the customer map; run the e2e three-apps script if the studio supports it; commit per task; push; CI green.

---

## Self-review

- Spec §5.4 coverage: honest GPS client ✓ (Task 7), intake guards ✓ (Tasks 2, 4), fake GPS → review queue ✓ (Tasks 3–5; support incident instead of a new `driver_flags` table — the support desk is where ops already triage), retention ✓ (Task 6), "location unknown" presence → replaced by "no invented positions; last real fix" (decision 3). `trips.trail` read API moves to SP8 (replay), where it is first used.
- Names: `POSITION_RULES`, `DeviceFix`, `assessFix`, `FixVerdict`, `SuspicionCounter.note`, `reportDevicePositions`, `purgeTrail`, `TrailRetention.tick`, `FixBuffer`.
