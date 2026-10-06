# Quiet Days (J1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ops set mourning days in the Console; on those days the customer app plays no celebrations (delivered burst, success buzz) and no moment sounds, and the server sends no promotional pushes. Must be live before ~13 Nov 2026.

**Architecture:** Quiet periods live next to the status banner in the controls module (same shape: a DB table, a public read every app polls, admin-only set/clear, audit log). The public read is `system.season` and returns what an app may do today (`celebrations`, `sounds`, `promos`), so the J6 season system can grow it without breaking clients. The notify engine asks `ControlsService.isQuietDay()` before any `marketing` delivery. The customer app keeps the last season in a tiny store that `playCue` and the arrival screen read.

**Tech Stack:** Zod + tRPC contracts (`packages/contracts`), NestJS API (`apps/api`), Prisma (`packages/db`), Expo customer app (`apps/customer`), Next.js Console (`apps/console`), vitest everywhere.

Spec: `docs/specs/2026-10-05-customer-joy.md` §4 "Season state" and §5.1 (f8). Days are Baghdad calendar dates (`YYYY-MM-DD`, inclusive), compared as strings; the day turns at Baghdad midnight (`localDateKey` in `apps/api/src/shared/local-time.ts`).

**Before you start:** another session works in this repo. `git fetch && git rebase origin/main` before the first commit and before every push. Stage only the files each task names (never `git add -A`; the tree has other people's uncommitted work).

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `packages/contracts/src/control-room-io.ts` | modify | Quiet-day and season schemas, `ControlsPort` methods |
| `packages/contracts/src/routers/control-room.ts` | modify | `seasonProcedures` (public `season`, admin quiet days) |
| `packages/contracts/src/router.ts` | modify | Spread `seasonProcedures` into `system` |
| `packages/contracts/src/errors.ts` | modify | `quiet_invalid`, `quiet_not_found` |
| `packages/i18n/src/locales/ar-IQ.json`, `en.json` | modify | Error copy, Console copy |
| `packages/contracts/src/routers/control-room.test.ts` | modify | Role matrix, public read, validation |
| `packages/db/prisma/schema.prisma` | modify | `QuietPeriod` model |
| `packages/db/prisma/migrations/<ts>_quiet_periods/migration.sql` | create | Table + `driver_harden` |
| `apps/api/src/modules/controls/controls.repository.ts` | modify | `QuietRecord`, repo methods (memory + Prisma) |
| `apps/api/src/modules/controls/controls.service.ts` | modify | `season`, `isQuietDay`, `quietDays`, `setQuietDays`, `clearQuietDays` |
| `apps/api/src/modules/controls/index.ts` | modify | Export `QuietRecord` type, `daysBetween` |
| `apps/api/src/modules/controls/controls.service.test.ts` | modify | Quiet-day behaviour |
| `apps/api/src/modules/notify/notify.engine.ts` | modify | Suppress `marketing` on quiet days (dispatch and send) |
| `apps/api/src/modules/notify/notify.module.ts` | modify | Wire `ControlsService.isQuietDay` |
| `apps/api/src/modules/notify/test-harness.ts` | modify | `quietDay` option |
| `apps/api/src/modules/notify/notify.engine.test.ts` | modify | Quiet-day offer test |
| `apps/customer/src/lib/season.ts` | create | Season store + `cueAllowed` (pure) |
| `apps/customer/src/lib/season.test.ts` | create | Store tests |
| `apps/customer/src/lib/use-season.ts` | create | `useSeason()` hook |
| `apps/customer/src/components/SeasonWatcher.tsx` | create | Polls `system.season` into the store |
| `apps/customer/app/_layout.tsx` | modify | Mount `SeasonWatcher` |
| `apps/customer/src/lib/sound.ts` | modify | Gate cues on the season |
| `apps/customer/src/features/track/Arrival.tsx` | modify | No burst / success buzz on quiet days |
| `apps/customer/scripts/demo-api.mjs` | modify | `POST /demo/quiet?on=1\|0` |
| `apps/console/src/lib/quiet.ts` + `quiet.test.ts` | create | `baghdadToday`, `quietRange` |
| `apps/console/src/components/quiet-days-card.tsx` | create | The Console card |
| `apps/console/src/components/controls-page.tsx` | modify | Render the card |
| `docs/api/quiet-days.md` | create | Procedure doc |

---

### Task 1: Contracts — schemas, port, errors, router

**Files:**
- Modify: `packages/contracts/src/control-room-io.ts` (after the `ClearBannerInput` line in the "status banner" section; and the `ControlsPort` interface near the end)
- Modify: `packages/contracts/src/routers/control-room.ts`
- Modify: `packages/contracts/src/router.ts:71`
- Modify: `packages/contracts/src/errors.ts:97`
- Modify: `packages/i18n/src/locales/ar-IQ.json`, `packages/i18n/src/locales/en.json` (next to `error.banner_not_found`, line ~1152)
- Test: `packages/contracts/src/routers/control-room.test.ts`

- [ ] **Step 1: Write the failing contract tests**

In `control-room.test.ts`, next to the existing `bannerView` constant, add:

```ts
const quietView = { id: 'qd_1', cityId: 'aziziyah', startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'يوم عزاء', active: false, setBy: 'p_staff', setByName: null, setAt: AT, clearedAt: null };
```

In the `controls: ControlsPort` fake (around line 56), add four members after `clearBanner`:

```ts
    season: vi.fn(async () => ({ quiet: false, celebrations: true, sounds: true, promos: true, quietUntil: null })),
    quietDays: vi.fn(async () => [quietView]),
    setQuietDays: vi.fn(async () => quietView),
    clearQuietDays: vi.fn(async () => quietView),
```

In `MATRIX`, after the `system.clearBanner` row (line ~130):

```ts
  ['system.quietDays', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.system.quietDays()],
  ['system.setQuietDays', ['admin'], (c) => c.system.setQuietDays({ startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'يوم عزاء' })],
  ['system.clearQuietDays', ['admin'], (c) => c.system.clearQuietDays({ quietId: 'qd_1' })],
```

After the `'system.banner is public and validated'` test:

```ts
  it('system.season is public; quiet days are validated before the port', async () => {
    const anon = caller(null);
    expect(await anon.call.system.season({ cityId: 'aziziyah' })).toMatchObject({ quiet: false, celebrations: true, sounds: true, promos: true });
    expect(anon.controls.season).toHaveBeenCalledWith({ cityId: 'aziziyah' });
    const admin = caller(['admin']);
    expect(await codeOf(admin.call.system.setQuietDays({ startsOn: '2026-11-14', endsOn: '2026-11-13', label_ar: 'يوم عزاء' }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.system.setQuietDays({ startsOn: '13-11-2026', endsOn: '2026-11-13', label_ar: 'يوم عزاء' }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.system.setQuietDays({ startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'يو' }))).toBe('BAD_REQUEST');
    expect(admin.controls.setQuietDays).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @driver/contracts exec vitest run src/routers/control-room.test.ts`
Expected: FAIL (TypeScript/vitest: `system.season` / `quietDays` do not exist on the router; the fake has unknown members).

- [ ] **Step 3: Add the schemas and port methods**

In `control-room-io.ts`, directly after `export const ClearBannerInput = z.object({ bannerId: z.string().min(1) });` add:

```ts
// ───────────────────────── quiet days and the season (customer joy J1a) ─────────────────────────

/** A Baghdad calendar day, `YYYY-MM-DD`. */
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The longest quiet stretch set in one go (Muharram 1–13 is 13 days). */
export const QUIET_MAX_DAYS = 15;

/**
 * What an open app may do today (public read, every app polls it). On a quiet day (mourning, set by
 * ops in the Console) there are no celebrations, no moment sounds and no offers. The J6 season system
 * adds fields here; clients ignore what they don't know.
 */
export const PublicSeason = z.object({
  quiet: z.boolean(),
  celebrations: z.boolean(),
  sounds: z.boolean(),
  promos: z.boolean(),
  /** The last quiet day (inclusive) while quiet, else null. */
  quietUntil: LocalDate.nullable(),
});
export type PublicSeason = z.infer<typeof PublicSeason>;

export const SeasonInput = z.object({ cityId: CityId.optional() });
export type SeasonInput = z.infer<typeof SeasonInput>;

export const QuietDaysView = z.object({
  id: z.string(),
  cityId: z.string().nullable(),
  startsOn: LocalDate,
  endsOn: LocalDate,
  label_ar: z.string(),
  active: z.boolean(),
  setBy: z.string(),
  setByName: z.string().nullable(),
  setAt: z.coerce.date(),
  clearedAt: z.coerce.date().nullable(),
});
export type QuietDaysView = z.infer<typeof QuietDaysView>;

export const SetQuietDaysInput = z
  .object({
    /** null/absent = every city. */
    cityId: CityId.nullable().optional(),
    startsOn: LocalDate,
    endsOn: LocalDate,
    label_ar: z.string().trim().min(3).max(80),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'endsOn is before startsOn', path: ['endsOn'] });
export type SetQuietDaysInput = z.input<typeof SetQuietDaysInput>;

export const ClearQuietDaysInput = z.object({ quietId: z.string().min(1) });
```

In the `ControlsPort` interface, after `clearBanner(...)`:

```ts
  season(input: SeasonInput): Promise<PublicSeason>;
  quietDays(): Promise<QuietDaysView[]>;
  setQuietDays(actor: Actor, input: z.output<typeof SetQuietDaysInput>): Promise<QuietDaysView>;
  clearQuietDays(actor: Actor, input: { quietId: string }): Promise<QuietDaysView>;
```

- [ ] **Step 4: Add the procedures**

In `routers/control-room.ts`, add `ClearQuietDaysInput, PublicSeason, QuietDaysView, SeasonInput, SetQuietDaysInput` to the import from `'../control-room-io.js'` (keep it alphabetical), then after `bannerProcedures`:

```ts
/** `system.season` (public: what an open app may do today) and the quiet days ops set. Spread into `system`. */
export const seasonProcedures = {
  season: publicProcedure
    .input(SeasonInput)
    .output(PublicSeason)
    .query(({ ctx, input }) => ctx.controls.season(input)),
  quietDays: protectedProcedure(CONSOLE_READ_ROLES)
    .output(z.array(QuietDaysView))
    .query(({ ctx }) => ctx.controls.quietDays()),
  setQuietDays: protectedProcedure(BANNER_ROLES)
    .input(SetQuietDaysInput)
    .output(QuietDaysView)
    .mutation(({ ctx, input }) => ctx.controls.setQuietDays(ctx.actor, input)),
  clearQuietDays: protectedProcedure(BANNER_ROLES)
    .input(ClearQuietDaysInput)
    .output(QuietDaysView)
    .mutation(({ ctx, input }) => ctx.controls.clearQuietDays(ctx.actor, input)),
};
```

In `router.ts`, import `seasonProcedures` from the same module as `bannerProcedures` and change line 71 to:

```ts
  system: t.mergeRouters(systemRouter, router({ ...bannerProcedures, ...seasonProcedures })),
```

- [ ] **Step 5: Add the error codes and copy**

`errors.ts`, after `banner_not_found`:

```ts
  quiet_invalid: { retryHint: 'never', status: 'BAD_REQUEST' },
  quiet_not_found: { retryHint: 'never', status: 'NOT_FOUND' },
```

`ar-IQ.json`, after `"error.banner_not_found"`:

```json
  "error.quiet_invalid": "أيام الهدوء مو صحيحة: لازم تبدي اليوم أو بعده، وما تزيد على 15 يوم",
  "error.quiet_not_found": "ما لگينا أيام الهدوء",
```

`en.json`, after `"error.banner_not_found"`:

```json
  "error.quiet_invalid": "Quiet days must start today or later and last at most 15 days",
  "error.quiet_not_found": "Quiet days not found",
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @driver/contracts exec vitest run src/routers/control-room.test.ts && pnpm --filter @driver/i18n test`
Expected: PASS (both; the i18n run checks ar/en parity and the voice glossary).

- [ ] **Step 7: Build and commit**

```bash
pnpm --filter @driver/i18n --filter @driver/contracts build
git add packages/contracts/src/control-room-io.ts packages/contracts/src/routers/control-room.ts packages/contracts/src/router.ts packages/contracts/src/errors.ts packages/contracts/src/routers/control-room.test.ts packages/i18n/src/locales/ar-IQ.json packages/i18n/src/locales/en.json
git commit -m "Contracts: system.season and quiet days (public read, admin set/clear)"
```

---

### Task 2: Database — `quiet_periods`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (directly after `model SystemBanner { … }`, line ~2711)
- Create: `packages/db/prisma/migrations/<YYYYMMDDHHMMSS>_quiet_periods/migration.sql`

- [ ] **Step 1: Add the model**

```prisma
/// Quiet days (customer joy J1a): mourning days ops set in the Console. While one is on, the apps play
/// no celebrations or moment sounds and the notify engine sends no offers.
model QuietPeriod {
  id          String    @id @default(cuid())
  /// NULL = every city.
  cityId      String?   @map("city_id")
  /// Baghdad calendar days, inclusive, as YYYY-MM-DD.
  startsOn    String    @map("starts_on")
  endsOn      String    @map("ends_on")
  labelAr     String    @map("label_ar")
  setById     String    @map("set_by_id")
  clearedAt   DateTime? @map("cleared_at")
  clearedById String?   @map("cleared_by_id")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([endsOn])
  @@map("quiet_periods")
  @@schema("public")
}
```

- [ ] **Step 2: Add the migration**

Name the folder with a timestamp later than the newest folder in `packages/db/prisma/migrations` (check with `ls packages/db/prisma/migrations | tail -2`; at plan time the newest is `20261005160000_stop_courier_near`, so `20261006090000_quiet_periods` works unless the other session added a later one).

```sql
-- Quiet days (customer joy J1a, docs/specs/2026-10-05-customer-joy.md): mourning days ops set in the
-- Console. While one is on, the apps play no celebrations or moment sounds and the notify engine sends
-- no offers. Days are Baghdad calendar dates (YYYY-MM-DD, inclusive). Additive only.

CREATE TABLE "public"."quiet_periods" (
    "id" TEXT NOT NULL,
    "city_id" TEXT,
    "starts_on" TEXT NOT NULL,
    "ends_on" TEXT NOT NULL,
    "label_ar" TEXT NOT NULL,
    "set_by_id" TEXT NOT NULL,
    "cleared_at" TIMESTAMP(3),
    "cleared_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiet_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quiet_periods_ends_on_idx" ON "public"."quiet_periods"("ends_on");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
```

- [ ] **Step 3: Validate, generate and check drift**

Run: `pnpm --filter @driver/db validate && pnpm --filter @driver/db build && pnpm --filter @driver/db test`
Expected: PASS (`supabase-compat.test.ts` checks the `driver_harden` line).

If Docker is available: `pnpm db:up && pnpm db:drift` → Expected: exit 0 (no drift). Otherwise CI's drift check covers it; do not skip it there.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/*_quiet_periods/migration.sql
git commit -m "DB: quiet_periods (mourning days set in the Console)"
```

---

### Task 3: API repository — quiet records

**Files:**
- Modify: `apps/api/src/modules/controls/controls.repository.ts`
- Modify: `apps/api/src/modules/controls/index.ts`

- [ ] **Step 1: Add the record and port methods**

After the `BannerRecord` interface:

```ts
/** `quiet_periods` */
export interface QuietRecord {
  id: string;
  cityId: string | null;
  /** Baghdad calendar days, inclusive, YYYY-MM-DD. */
  startsOn: string;
  endsOn: string;
  labelAr: string;
  setById: string;
  setAt: Date;
  clearedAt: Date | null;
  clearedById: string | null;
}
```

In `interface ControlsRepository`, after `clearBanner(...)`:

```ts
  /** Quiet periods not cleared that end on or after `today` (YYYY-MM-DD): today's and coming ones. */
  liveQuiet(today: string, tx?: Tx): Promise<QuietRecord[]>;
  /** The most recent quiet periods (any state), newest first. */
  recentQuiet(limit: number, tx?: Tx): Promise<QuietRecord[]>;
  quiet(id: string, tx?: Tx): Promise<QuietRecord | null>;
  createQuiet(input: Omit<QuietRecord, 'id'>, tx?: Tx): Promise<QuietRecord>;
  clearQuiet(id: string, by: string, at: Date, tx?: Tx): Promise<QuietRecord>;
```

- [ ] **Step 2: Implement in memory**

In `InMemoryControlsRepository`, add the field next to `bannerRows`:

```ts
  readonly quietRows = new Map<string, QuietRecord>();
```

and the methods after `clearBanner`:

```ts
  async liveQuiet(today: string): Promise<QuietRecord[]> {
    return [...this.quietRows.values()].filter((q) => !q.clearedAt && q.endsOn >= today).map((q) => ({ ...q }));
  }

  async recentQuiet(limit: number): Promise<QuietRecord[]> {
    return [...this.quietRows.values()]
      .sort((a, b) => b.setAt.getTime() - a.setAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((q) => ({ ...q }));
  }

  async quiet(id: string): Promise<QuietRecord | null> {
    const q = this.quietRows.get(id);
    return q ? { ...q } : null;
  }

  async createQuiet(input: Omit<QuietRecord, 'id'>): Promise<QuietRecord> {
    const row = { ...input, id: this.id('qd') };
    this.quietRows.set(row.id, row);
    return { ...row };
  }

  async clearQuiet(id: string, by: string, at: Date): Promise<QuietRecord> {
    const q = this.quietRows.get(id);
    if (!q) throw new Error(`quiet ${id} not found`);
    q.clearedAt = at;
    q.clearedById = by;
    return { ...q };
  }
```

- [ ] **Step 3: Implement with Prisma**

Inside the `/* eslint-disable … */` mapping block, after `bannerFrom`:

```ts
const quietFrom = (r: any): QuietRecord => ({
  id: r.id,
  cityId: r.cityId,
  startsOn: r.startsOn,
  endsOn: r.endsOn,
  labelAr: r.labelAr,
  setById: r.setById,
  setAt: r.createdAt,
  clearedAt: r.clearedAt,
  clearedById: r.clearedById,
});
```

In `PrismaControlsRepository`, after `clearBanner`:

```ts
  async liveQuiet(today: string, tx?: Tx): Promise<QuietRecord[]> {
    return (await this.db(tx).quietPeriod.findMany({ where: { clearedAt: null, endsOn: { gte: today } }, orderBy: { startsOn: 'asc' } })).map(quietFrom);
  }

  async recentQuiet(limit: number, tx?: Tx): Promise<QuietRecord[]> {
    return (await this.db(tx).quietPeriod.findMany({ orderBy: { createdAt: 'desc' }, take: limit })).map(quietFrom);
  }

  async quiet(id: string, tx?: Tx): Promise<QuietRecord | null> {
    const r = await this.db(tx).quietPeriod.findUnique({ where: { id } });
    return r ? quietFrom(r) : null;
  }

  async createQuiet(input: Omit<QuietRecord, 'id'>, tx?: Tx): Promise<QuietRecord> {
    const { setAt, ...rest } = input;
    return quietFrom(await this.db(tx).quietPeriod.create({ data: { ...rest, createdAt: setAt } }));
  }

  async clearQuiet(id: string, by: string, at: Date, tx?: Tx): Promise<QuietRecord> {
    return quietFrom(await this.db(tx).quietPeriod.update({ where: { id }, data: { clearedAt: at, clearedById: by } }));
  }
```

In `index.ts`, add `QuietRecord` to the `export type { … } from './controls.repository.js'` line.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @driver/api typecheck`
Expected: errors only in `controls.service.ts` ("Class 'ControlsService' incorrectly implements interface 'ControlsPort'… missing season, quietDays…"). Task 4 fixes them; the repository itself compiles.

---

### Task 4: API service — season and quiet days

**Files:**
- Modify: `apps/api/src/modules/controls/controls.service.ts`
- Modify: `apps/api/src/modules/controls/index.ts`
- Test: `apps/api/src/modules/controls/controls.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add `daysBetween` to the import from `'./controls.service.js'`, then inside `describe('launch controls', …)` after the banners test:

```ts
  it('daysBetween counts calendar days between two YYYY-MM-DD dates', () => {
    expect(daysBetween('2026-11-13', '2026-11-13')).toBe(0);
    expect(daysBetween('2026-11-13', '2026-11-27')).toBe(14);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('quiet days: by Baghdad date, every city or one city; cleared ones go; never in the past, at most 15 days', async () => {
    const h = await harness('2026-11-12T20:30:00Z'); // 23:30 Baghdad, 12 Nov
    expect(await h.svc.season({ cityId: 'aziziyah' })).toEqual({ quiet: false, celebrations: true, sounds: true, promos: true, quietUntil: null });
    const q = await h.svc.setQuietDays(ALI, { cityId: null, startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'يوم عزاء' });
    expect(q).toMatchObject({ active: false, setByName: 'علي', startsOn: '2026-11-13' });
    expect((await h.svc.season({ cityId: 'aziziyah' })).quiet).toBe(false);
    h.clock.advanceMinutes(31); // 00:01 Baghdad, 13 Nov
    expect(await h.svc.season({ cityId: 'aziziyah' })).toEqual({ quiet: true, celebrations: false, sounds: false, promos: false, quietUntil: '2026-11-13' });
    expect(await h.svc.isQuietDay(h.clock.now())).toBe(true);
    expect((await h.svc.quietDays())[0]).toMatchObject({ id: q.id, active: true });
    h.clock.set('2026-11-13T21:00:00Z'); // 00:00 Baghdad, 14 Nov
    expect((await h.svc.season({})).quiet).toBe(false);
    const kut = await h.svc.setQuietDays(ALI, { cityId: 'kut', startsOn: '2026-11-14', endsOn: '2026-11-15', label_ar: 'الكوت فقط' });
    expect((await h.svc.season({ cityId: 'aziziyah' })).quiet).toBe(false);
    expect((await h.svc.season({ cityId: 'kut' })).quietUntil).toBe('2026-11-15');
    await h.svc.clearQuietDays(ALI, { quietId: kut.id });
    expect((await h.svc.season({ cityId: 'kut' })).quiet).toBe(false);
    await expect(h.svc.setQuietDays(ALI, { startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'أمس' })).rejects.toMatchObject({ code: 'quiet_invalid' });
    await expect(h.svc.setQuietDays(ALI, { startsOn: '2026-11-14', endsOn: '2026-11-29', label_ar: 'طويل' })).rejects.toMatchObject({ code: 'quiet_invalid' });
    await expect(h.svc.clearQuietDays(ALI, { quietId: 'qd_none' })).rejects.toMatchObject({ code: 'quiet_not_found' });
    expect((await h.svc.audit({ cityId: 'kut', subjectKind: 'quiet', limit: 10 })).map((a) => a.action)).toEqual(['quiet.clear', 'quiet.set', 'quiet.set']);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @driver/api exec vitest run --project unit src/modules/controls/controls.service.test.ts`
Expected: FAIL (`daysBetween` is not exported; `h.svc.season is not a function`).

- [ ] **Step 3: Implement**

Imports in `controls.service.ts`: add `QUIET_MAX_DAYS`, `type PublicSeason`, `type QuietDaysView`, `type SeasonInput`, `type SetQuietDaysInput` to the `@driver/contracts` import; add `type QuietRecord` to the `./controls.repository.js` import; add:

```ts
import { localDateKey } from '../../shared/local-time.js';
```

After the `SEVERITY_AR` constant:

```ts
/** `system.season` is polled by every open app, and the notify engine asks before each offer. */
const QUIET_CACHE_MS = 5_000;
/** An ordinary day: everything on. */
const LOUD: PublicSeason = { quiet: false, celebrations: true, sounds: true, promos: true, quietUntil: null };

/** Whole calendar days from one YYYY-MM-DD to another (date arithmetic in UTC; no time zone involved). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
```

In the class, next to `private bannerCache…`:

```ts
  private quietCache: { at: number; rows: QuietRecord[] } | null = null;
```

After `clearBanner(…)`:

```ts
  // ───────────────────────── quiet days and the season ─────────────────────────

  private async liveQuiet(): Promise<QuietRecord[]> {
    const now = this.clock.now();
    if (this.quietCache && now.getTime() - this.quietCache.at < QUIET_CACHE_MS) return this.quietCache.rows;
    const rows = await this.repo.liveQuiet(localDateKey(now));
    this.quietCache = { at: now.getTime(), rows };
    return rows;
  }

  /** The quiet period covering `at`'s Baghdad date for this city (any-city periods count), longest-running first. */
  private quietOn(at: Date, rows: QuietRecord[], cityId?: string): QuietRecord | null {
    const day = localDateKey(at);
    return (
      rows
        .filter((q) => !q.clearedAt && q.startsOn <= day && day <= q.endsOn && (q.cityId === null || !cityId || q.cityId === cityId))
        .sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0] ?? null
    );
  }

  /** What an open app may do today: on a quiet day no celebrations, no moment sounds and no offers. */
  async season(input: SeasonInput): Promise<PublicSeason> {
    const on = this.quietOn(this.clock.now(), await this.liveQuiet(), input.cityId);
    return on ? { quiet: true, celebrations: false, sounds: false, promos: false, quietUntil: on.endsOn } : LOUD;
  }

  /** The notify engine's gate for offers (the `marketing` category). */
  async isQuietDay(at: Date, cityId?: string): Promise<boolean> {
    return this.quietOn(at, await this.liveQuiet(), cityId) !== null;
  }

  private quietView(q: QuietRecord, names: Record<string, string | null>, now: Date): QuietDaysView {
    const day = localDateKey(now);
    return {
      id: q.id,
      cityId: q.cityId,
      startsOn: q.startsOn,
      endsOn: q.endsOn,
      label_ar: q.labelAr,
      active: !q.clearedAt && q.startsOn <= day && day <= q.endsOn,
      setBy: q.setById,
      setByName: names[q.setById] ?? null,
      setAt: q.setAt,
      clearedAt: q.clearedAt,
    };
  }

  async quietDays(): Promise<QuietDaysView[]> {
    const now = this.clock.now();
    const rows = await this.repo.recentQuiet(30);
    const names = await this.names.of(rows.map((r) => r.setById));
    return rows.map((q) => this.quietView(q, names, now));
  }

  async setQuietDays(actor: Actor, input: z.output<typeof SetQuietDaysInput>): Promise<QuietDaysView> {
    const now = this.clock.now();
    const today = localDateKey(now);
    if (input.startsOn < today || input.endsOn < input.startsOn || daysBetween(input.startsOn, input.endsOn) + 1 > QUIET_MAX_DAYS) throw new DriverError('quiet_invalid');
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.createQuiet(
        { cityId: input.cityId ?? null, startsOn: input.startsOn, endsOn: input.endsOn, labelAr: input.label_ar, setById: actor.personId, setAt: now, clearedAt: null, clearedById: null },
        tx,
      );
      await this.audits.record(
        { cityId: saved.cityId, actorId: actor.personId, action: 'quiet.set', subjectKind: 'quiet', subjectId: saved.id, summaryAr: `أيام هدوء: ${saved.labelAr} (${saved.startsOn} – ${saved.endsOn})`, detail: { startsOn: saved.startsOn, endsOn: saved.endsOn } },
        tx,
      );
      return saved;
    });
    this.quietCache = null;
    return this.quietView(row, await this.names.of([row.setById]), now);
  }

  async clearQuietDays(actor: Actor, input: { quietId: string }): Promise<QuietDaysView> {
    const now = this.clock.now();
    const existing = await this.repo.quiet(input.quietId);
    if (!existing) throw new DriverError('quiet_not_found');
    if (existing.clearedAt) return this.quietView(existing, await this.names.of([existing.setById]), now);
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.clearQuiet(existing.id, actor.personId, now, tx);
      await this.audits.record({ cityId: saved.cityId, actorId: actor.personId, action: 'quiet.clear', subjectKind: 'quiet', subjectId: saved.id, summaryAr: `شال أيام الهدوء: ${saved.labelAr}` }, tx);
      return saved;
    });
    this.quietCache = null;
    return this.quietView(row, await this.names.of([row.setById]), now);
  }
```

In `index.ts`, add `daysBetween` to the `export { ControlsService, … } from './controls.service.js'` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @driver/api exec vitest run --project unit src/modules/controls && pnpm --filter @driver/api typecheck`
Expected: PASS, and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/controls/controls.repository.ts apps/api/src/modules/controls/controls.service.ts apps/api/src/modules/controls/controls.service.test.ts apps/api/src/modules/controls/index.ts
git commit -m "API: quiet days and system.season in the controls module (audited, cached 5 s)"
```

---

### Task 5: Notify — no offers on a quiet day

**Files:**
- Modify: `apps/api/src/modules/notify/notify.engine.ts` (constructor ~line 104; `dispatch` ~line 124; `send` ~line 180)
- Modify: `apps/api/src/modules/notify/test-harness.ts:67-81`
- Modify: `apps/api/src/modules/notify/notify.module.ts`
- Test: `apps/api/src/modules/notify/notify.engine.test.ts`

- [ ] **Step 1: Write the failing test**

In `test-harness.ts`, add `quietDay?: (at: Date) => Promise<boolean>` to the `notifyHarness` options type, and pass it as the last constructor argument:

```ts
  const engine = new NotifyEngine(repo, { push: { expo: push, fcm: push }, sms, whatsapp }, contacts, queue, clock, { retryBaseMs: 1000, maxAttempts: 3, receiptDelaySec: 60 }, opts.quietDay);
```

In `notify.engine.test.ts`, after the `'caps marketing at 2 per rolling week'` test:

```ts
  it('sends no offers on a quiet day, whether new or deferred from the night before; order updates still go', async () => {
    let quiet = false;
    const h = notifyHarness({ start: '2026-11-12T20:30:00Z', quietDay: async () => quiet }); // 23:30 local, 12 Nov
    await h.register('cust');
    await h.service.setPreferences(h.actor('cust'), { marketing: true });
    await h.service.dispatch({ eventId: 'm1', template: 'marketing_offer', to: 'cust', params: { title: 'عرض', body: 'خصم' } });
    quiet = true; // the mourning day starts at midnight
    h.clock.set('2026-11-13T05:00:00Z'); // 08:00 local: quiet hours over
    await h.run();
    await h.service.dispatch({ eventId: 'm2', template: 'marketing_offer', to: 'cust', params: { title: 'عرض', body: 'خصم' } });
    await h.service.dispatch({ eventId: 'o1', template: 'order_accepted', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'o1' } });
    await h.run();
    expect((await h.rows({ personId: 'cust' })).map((r) => [r.template, r.status, r.reason])).toEqual([
      ['marketing_offer', 'suppressed', 'quiet_day'],
      ['marketing_offer', 'suppressed', 'quiet_day'],
      ['order_accepted', 'sent', null],
    ]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @driver/api exec vitest run --project unit src/modules/notify/notify.engine.test.ts`
Expected: FAIL (TypeScript: `NotifyEngine` takes at most 6 arguments; then the deferred offer is `sent`).

- [ ] **Step 3: Implement the gate**

Constructor — add a last parameter:

```ts
    private readonly opts: NotifyEngineOptions = DEFAULT_ENGINE_OPTIONS,
    /** Mourning days set in the Console (`ControlsService.isQuietDay`): no offers then. */
    private readonly isQuietDay: (at: Date) => Promise<boolean> = async () => false,
  ) {}
```

In `dispatch`, after the `capped` line:

```ts
    const quietDay = def.category === 'marketing' && (await this.isQuietDay(now));
```

and in the channel loop, between the preference and `capped` branches:

```ts
      else if (quietDay) [status, reason] = ['suppressed', 'quiet_day'];
```

In `send`, right after the closing brace of `if (row.status === 'deferred') { … }` and before `try {`:

```ts
    if (def.category === 'marketing' && (await this.isQuietDay(now))) {
      await this.repo.updateDelivery(row.id, { status: 'suppressed', reason: 'quiet_day' }, now);
      return;
    }
```

- [ ] **Step 4: Wire the real gate**

In `notify.module.ts`, add the import next to the other module imports:

```ts
import { ControlsModule, ControlsService } from '../controls/index.js';
```

Add `ControlsModule` to the `@Module({ imports: [...] })` array (no cycle: controls is a leaf that imports only config, events, identity and orgs). Then replace the `NOTIFY_ENGINE` provider's `useFactory` signature, its `NotifyEngine` construction and its `inject` array:

```ts
      useFactory: (repo: NotifyRepository, queue: Queue<NotifyJob>, clock: Clock, identity: IdentityService, controls: ControlsService) => {
        const contacts: NotifyContacts = {
          contact: async (to, opts) => {
            // SOS: `ec:<personId>` is that person's emergency contact — a number, not an account
            // (logged vault read against the person, accessor system:notify).
            const owner = emergencyContactOwner(to);
            if (!owner) return identity.notifyContact(to, opts);
            if (!opts.phone) return { locale: 'ar-IQ', phoneE164: null };
            const ec = await identity.emergencyContactOf(owner, 'system:notify', opts.purpose);
            return ec ? { locale: 'ar-IQ', phoneE164: ec.phoneE164 } : null;
          },
        };
        return new NotifyEngine(
          repo,
          { push: pushPortsFromEnv(), sms: smsPortFromEnv(), whatsapp: whatsAppPortFromEnv() },
          contacts,
          queue,
          clock,
          {
            retryBaseMs: envInt('NOTIFY_RETRY_BASE_MS', DEFAULT_ENGINE_OPTIONS.retryBaseMs),
            maxAttempts: envInt('NOTIFY_MAX_ATTEMPTS', DEFAULT_ENGINE_OPTIONS.maxAttempts),
            receiptDelaySec: envInt('NOTIFY_RECEIPT_DELAY_SEC', DEFAULT_ENGINE_OPTIONS.receiptDelaySec),
          },
          // Mourning days set in the Console: no offers then (customer joy J1a).
          (at) => controls.isQuietDay(at),
        );
      },
      inject: [NOTIFY_REPOSITORY, NOTIFY_QUEUE, CLOCK, IdentityService, ControlsService],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @driver/api exec vitest run --project unit src/modules/notify && pnpm --filter @driver/api typecheck`
Expected: PASS; the earlier marketing tests are unchanged (the default gate says "not quiet").

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/notify/notify.engine.ts apps/api/src/modules/notify/notify.module.ts apps/api/src/modules/notify/test-harness.ts apps/api/src/modules/notify/notify.engine.test.ts
git commit -m "Notify: no offers on quiet days, including ones deferred from the night before"
```

---

### Task 6: Customer app — season store and gates

**Files:**
- Create: `apps/customer/src/lib/season.ts`, `apps/customer/src/lib/season.test.ts`, `apps/customer/src/lib/use-season.ts`, `apps/customer/src/components/SeasonWatcher.tsx`
- Modify: `apps/customer/app/_layout.tsx` (next to `<SystemBanner />`)
- Modify: `apps/customer/src/lib/sound.ts:25-26`
- Modify: `apps/customer/src/features/track/Arrival.tsx:25-52` and `PointsEarned` (~line 330)

- [ ] **Step 1: Write the failing test**

`apps/customer/src/lib/season.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PublicSeason } from '@driver/contracts';
import { cueAllowed, LOUD_SEASON, SeasonState } from './season';

const QUIET: PublicSeason = { quiet: true, celebrations: false, sounds: false, promos: false, quietUntil: '2026-11-13' };

describe('season', () => {
  it('starts as an ordinary day and tells listeners only when something changes', () => {
    const s = new SeasonState();
    expect(s.current).toEqual(LOUD_SEASON);
    let calls = 0;
    const off = s.subscribe(() => {
      calls += 1;
    });
    s.set({ ...LOUD_SEASON });
    expect(calls).toBe(0);
    s.set(QUIET);
    expect(s.current.quiet).toBe(true);
    expect(calls).toBe(1);
    off();
    s.set(LOUD_SEASON);
    expect(calls).toBe(1);
  });

  it('a moment sound needs the in-app switch on and a day that is not quiet', () => {
    expect(cueAllowed(true, LOUD_SEASON)).toBe(true);
    expect(cueAllowed(false, LOUD_SEASON)).toBe(false);
    expect(cueAllowed(true, QUIET)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @driver/customer exec vitest run src/lib/season.test.ts`
Expected: FAIL ("Failed to resolve import ./season").

- [ ] **Step 3: Write the store**

`apps/customer/src/lib/season.ts`:

```ts
import type { PublicSeason } from '@driver/contracts';

/** Before the first read, or when the read fails: an ordinary day, everything on. */
export const LOUD_SEASON: PublicSeason = { quiet: false, celebrations: true, sounds: true, promos: true, quietUntil: null };

/**
 * Today's season as the API last said it (`system.season`, polled by `SeasonWatcher`). Sounds and
 * celebrations read it synchronously; screens subscribe through `useSeason`. On a quiet day (mourning,
 * set in the Console) the app plays no celebration and no moment sound.
 */
export class SeasonState {
  private value: PublicSeason = LOUD_SEASON;
  private readonly listeners = new Set<() => void>();

  get current(): PublicSeason {
    return this.value;
  }

  set(next: PublicSeason): void {
    const v = this.value;
    if (v.quiet === next.quiet && v.celebrations === next.celebrations && v.sounds === next.sounds && v.promos === next.promos && v.quietUntil === next.quietUntil) return;
    this.value = next;
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const season = new SeasonState();

/** A moment's sound plays only when the person has sounds on and today is not a quiet day. */
export function cueAllowed(soundsOn: boolean, today: PublicSeason): boolean {
  return soundsOn && today.sounds;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @driver/customer exec vitest run src/lib/season.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Hook, watcher and mount**

`apps/customer/src/lib/use-season.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { PublicSeason } from '@driver/contracts';
import { season } from './season';

/** Today's season, live: re-renders when the Console turns a quiet day on or off. */
export function useSeason(): PublicSeason {
  return useSyncExternalStore(
    (fn) => season.subscribe(fn),
    () => season.current,
    () => season.current,
  );
}
```

`apps/customer/src/components/SeasonWatcher.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApi } from '@/lib/api';
import { season } from '@/lib/season';

/** How often an open app re-reads today's season (public `system.season`). */
export const SEASON_POLL_MS = 5 * 60_000;

/**
 * Keeps `season` in step with the Console's quiet days. Public read, so guests get it too. A failed
 * read keeps the last answer (an ordinary day before the first one). Renders nothing.
 */
export function SeasonWatcher() {
  const api = useApi();
  const q = useQuery(api.system.season.queryOptions({ cityId: 'aziziyah' }, { refetchInterval: SEASON_POLL_MS, staleTime: SEASON_POLL_MS / 2, retry: false }));
  useEffect(() => {
    if (q.data) season.set(q.data);
  }, [q.data]);
  return null;
}
```

In `app/_layout.tsx`, import `{ SeasonWatcher } from '@/components/SeasonWatcher'` and render it right after `<SystemBanner />`:

```tsx
              {/* Quiet days from the Console (system.season): no celebrations or moment sounds. */}
              <SeasonWatcher />
```

- [ ] **Step 6: Gate the sounds**

In `src/lib/sound.ts`, add `import { cueAllowed, season } from './season';` and change the first line of `playCue`:

```ts
  if (!cueAllowed(soundPref.enabled, season.current)) return;
```

Update the doc comment above `playCue` to end with: "On a quiet day (Console) no cue plays."

- [ ] **Step 7: Gate the arrival celebration**

In `src/features/track/Arrival.tsx`, add `import { useSeason } from '@/lib/use-season';`. In `ArrivalOverlay`, after `const pay = cashAtDoor(view.order);`:

```ts
  const today = useSeason();
  // On a quiet day (mourning, set in the Console) the moment is calm: no burst, no bounce, no success buzz.
  const celebrate = today.celebrations && !theme.reduceMotion;
```

Replace the effect:

```ts
  useEffect(() => {
    if (today.celebrations) theme.haptic('success');
    // Once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Replace `{theme.reduceMotion ? null : <Burst />}` with `{celebrate ? <Burst /> : null}`, and the check's `entering={theme.reduceMotion ? undefined : ZoomIn.springify().damping(11)}` with:

```tsx
            entering={celebrate ? ZoomIn.springify().damping(11) : theme.reduceMotion ? undefined : FadeIn.duration(220)}
```

In `PointsEarned`, add `const today = useSeason();` after `const t = useT();`, change `theme.haptic('success');` to `if (today.celebrations) theme.haptic('success');`, and add `today.celebrations` to that effect's dependency array.

- [ ] **Step 8: Typecheck, lint, test**

Run: `pnpm --filter @driver/customer typecheck && pnpm --filter @driver/customer lint && pnpm --filter @driver/customer test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/customer/src/lib/season.ts apps/customer/src/lib/season.test.ts apps/customer/src/lib/use-season.ts apps/customer/src/components/SeasonWatcher.tsx apps/customer/app/_layout.tsx apps/customer/src/lib/sound.ts apps/customer/src/features/track/Arrival.tsx
git commit -m "Customer: quiet days switch off the delivered burst, success buzz and moment sounds"
```

---

### Task 7: Customer demo hook

**Files:**
- Modify: `apps/customer/scripts/demo-api.mjs` (load `ControlsService` with the other `load(...)` lines ~33; hook next to `/demo/kitchen`)
- Modify: `apps/customer/README.md` (the demo hooks paragraph)

- [ ] **Step 1: Add the hook**

With the other service loads:

```js
const { ControlsService } = await load('modules/controls/index.js');
const controls = app.get(ControlsService);
```

After the `/demo/kitchen` hook:

```js
// Quiet day on or off for today (Baghdad date): no delivered burst, buzz or sounds in the app.
app.use('/demo/quiet', async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method !== 'POST') return json(res, 400, { error: 'POST /demo/quiet?on=1|0' });
    const demoOps = { personId: 'demo-ops', sessionId: 'demo' };
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    for (const q of await controls.quietDays()) if (q.active) await controls.clearQuietDays(demoOps, { quietId: q.id });
    if (url.searchParams.get('on') === '1') await controls.setQuietDays(demoOps, { cityId: null, startsOn: today, endsOn: today, label_ar: 'يوم هادئ (تجربة)' });
    json(res, 200, await controls.season({ cityId: 'aziziyah' }));
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});
```

In `README.md`, add to the demo hooks list: "`POST /demo/quiet?on=1|0` turns a quiet day on or off for today (no delivered burst, success buzz or moment sounds)."

- [ ] **Step 2: Smoke it**

Run (two terminals): `pnpm build && PORT=3200 node apps/customer/scripts/demo-api.mjs`, then `curl -s -X POST 'http://127.0.0.1:3200/demo/quiet?on=1'`
Expected: `{"quiet":true,"celebrations":false,"sounds":false,"promos":false,"quietUntil":"<today>"}`; `?on=0` returns `"quiet":false`.

- [ ] **Step 3: Commit**

```bash
git add apps/customer/scripts/demo-api.mjs apps/customer/README.md
git commit -m "Customer demo: /demo/quiet toggles today's quiet day"
```

---

### Task 8: Console — the quiet days card

**Files:**
- Create: `apps/console/src/lib/quiet.ts`, `apps/console/src/lib/quiet.test.ts`, `apps/console/src/components/quiet-days-card.tsx`
- Modify: `apps/console/src/components/controls-page.tsx` (the `ControlsPage` return, after `{view.data && (<ControlsBoard … />)}`)
- Modify: `packages/i18n/src/locales/ar-IQ.json`, `en.json` (next to `console.banner_*` keys, line ~1494)

- [ ] **Step 1: Write the failing test**

`apps/console/src/lib/quiet.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { baghdadToday, quietRange } from './quiet';

describe('quiet days helpers', () => {
  it('today follows Baghdad midnight, not UTC', () => {
    expect(baghdadToday(new Date('2026-11-12T20:59:00Z'))).toBe('2026-11-12');
    expect(baghdadToday(new Date('2026-11-12T21:00:00Z'))).toBe('2026-11-13');
  });

  it('a range reads as day/month, one date when it is one day', () => {
    expect(quietRange('2026-11-13', '2026-11-13')).toBe('13/11');
    expect(quietRange('2027-06-06', '2027-06-18')).toBe('6/6 – 18/6');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @driver/console exec vitest run src/lib/quiet.test.ts`
Expected: FAIL ("Failed to resolve import ./quiet").

- [ ] **Step 3: Write the helpers**

`apps/console/src/lib/quiet.ts`:

```ts
/** Baghdad is UTC+3 all year (no DST); quiet days turn at Baghdad midnight. */
const BAGHDAD_MS = 3 * 3_600_000;

/** Today in Baghdad as YYYY-MM-DD (the date the API compares quiet days with). */
export function baghdadToday(now: Date = new Date()): string {
  return new Date(now.getTime() + BAGHDAD_MS).toISOString().slice(0, 10);
}

/** "13/11", or "6/6 – 18/6" for a stretch (Western digits, day first, as the Console writes dates). */
export function quietRange(startsOn: string, endsOn: string): string {
  const d = (s: string) => `${Number(s.slice(8, 10))}/${Number(s.slice(5, 7))}`;
  return startsOn === endsOn ? d(startsOn) : `${d(startsOn)} – ${d(endsOn)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @driver/console exec vitest run src/lib/quiet.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the copy**

`ar-IQ.json`, after the `console.banner_*` block:

```json
  "console.quiet_title": "أيام الهدوء",
  "console.quiet_hint": "بأيام الحزن والعزاء التطبيقات ما تحتفل ولا تشغّل أصوات، وما نبعث عروض. يبدي من نص الليل بتوقيت بغداد.",
  "console.quiet_now": "هسة",
  "console.quiet_coming": "جاي",
  "console.quiet_clear": "شيله",
  "console.quiet_from": "من يوم",
  "console.quiet_to": "لحد يوم",
  "console.quiet_label": "شنو المناسبة؟",
  "console.quiet_placeholder": "مثلاً: يوم عزاء",
  "console.quiet_save": "ثبّت أيام الهدوء",
  "console.quiet_saved": "انحفظت أيام الهدوء",
  "console.quiet_cleared_toast": "انشالت أيام الهدوء",
```

`en.json`, same place:

```json
  "console.quiet_title": "Quiet days",
  "console.quiet_hint": "On days of mourning the apps play no celebrations or sounds and we send no offers. Starts at midnight Baghdad time.",
  "console.quiet_now": "Now",
  "console.quiet_coming": "Coming",
  "console.quiet_clear": "Remove",
  "console.quiet_from": "From",
  "console.quiet_to": "To",
  "console.quiet_label": "Occasion",
  "console.quiet_placeholder": "e.g. a day of mourning",
  "console.quiet_save": "Save quiet days",
  "console.quiet_saved": "Quiet days saved",
  "console.quiet_cleared_toast": "Quiet days removed",
```

- [ ] **Step 6: Write the card**

`apps/console/src/components/quiet-days-card.tsx`:

```tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { useId, useState, type FormEvent } from 'react';
import { queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { baghdadToday, quietRange } from '@/lib/quiet';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, Field, Input, useToast } from './ui';

/**
 * Quiet days (customer joy J1a): mourning days on which every app plays no celebrations or moment
 * sounds and the server sends no offers. Admins set and remove them; everyone on the Console sees them.
 */
export function QuietDaysCard({ signedIn, canEdit }: { signedIn: boolean; canEdit: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ids = { from: useId(), to: useId(), label: useId() };
  const today = baghdadToday();
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [label, setLabel] = useState('');
  const list = useQuery(trpc.system.quietDays.queryOptions(undefined, { enabled: signedIn, refetchInterval: 60_000, retry: queryRetry }));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.system.quietDays.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
  };
  const set = useMutation(
    trpc.system.setQuietDays.mutationOptions({
      onSuccess: () => {
        setLabel('');
        refresh();
        toast({ title: t('console.quiet_saved'), tone: 'ok' });
      },
    }),
  );
  const clear = useMutation(
    trpc.system.clearQuietDays.mutationOptions({
      onSuccess: () => {
        refresh();
        toast({ title: t('console.quiet_cleared_toast'), tone: 'ok' });
      },
    }),
  );
  const trimmed = label.trim();
  const valid = trimmed.length >= 3 && startsOn >= today && endsOn >= startsOn;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    set.mutate({ cityId: null, startsOn, endsOn, label_ar: trimmed });
  };
  const rows = (list.data ?? []).filter((q) => !q.clearedAt && q.endsOn >= today);
  return (
    <Card title={t('console.quiet_title')} hint={t('console.quiet_hint')} actions={!canEdit ? <Chip>{t('console.banner_admin_only')}</Chip> : undefined}>
      {rows.length > 0 && (
        <ul className="mb-5 space-y-2">
          {rows.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <Chip tone={q.active ? 'warn' : 'neutral'} dot size="sm">
                    {q.active ? t('console.quiet_now') : t('console.quiet_coming')}
                  </Chip>
                  <span className="min-w-0">{q.label_ar}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {quietRange(q.startsOn, q.endsOn)} · {q.setByName ?? t('console.someone')}
                </p>
              </div>
              {canEdit && (
                <Button variant="danger-soft" size="sm" loading={clear.isPending && clear.variables?.quietId === q.id} onClick={() => clear.mutate({ quietId: q.id })}>
                  {t('console.quiet_clear')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={!canEdit} className="flex flex-wrap items-end gap-3 disabled:opacity-60">
          <Field label={t('console.quiet_from')} htmlFor={ids.from} className="w-40">
            <Input
              id={ids.from}
              type="date"
              min={today}
              value={startsOn}
              onChange={(e) => {
                setStartsOn(e.target.value);
                if (endsOn < e.target.value) setEndsOn(e.target.value);
              }}
            />
          </Field>
          <Field label={t('console.quiet_to')} htmlFor={ids.to} className="w-40">
            <Input id={ids.to} type="date" min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
          <Field label={t('console.quiet_label')} htmlFor={ids.label} className="min-w-[14rem] flex-1">
            <Input id={ids.label} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('console.quiet_placeholder')} />
          </Field>
          <Button type="submit" variant="primary" disabled={!valid} loading={set.isPending}>
            {t('console.quiet_save')}
          </Button>
        </fieldset>
        {set.error && <p className="mt-2 text-sm text-bad">{errorText(set.error)}</p>}
      </form>
    </Card>
  );
}
```

- [ ] **Step 7: Render it**

In `controls-page.tsx`, import `{ QuietDaysCard } from './quiet-days-card'` and add, directly after the `{view.data && ( <ControlsBoard … /> )}` block:

```tsx
      {view.data && (
        <div className="mt-6">
          <QuietDaysCard signedIn={signedIn} canEdit={roles.has('admin')} />
        </div>
      )}
```

- [ ] **Step 8: Typecheck, lint, test**

Run: `pnpm --filter @driver/console typecheck && pnpm --filter @driver/console lint && pnpm --filter @driver/console test && pnpm --filter @driver/i18n test`
Expected: PASS (including `control-room.smoke.test.tsx` and ar/en parity).

- [ ] **Step 9: Commit**

```bash
git add apps/console/src/lib/quiet.ts apps/console/src/lib/quiet.test.ts apps/console/src/components/quiet-days-card.tsx apps/console/src/components/controls-page.tsx packages/i18n/src/locales/ar-IQ.json packages/i18n/src/locales/en.json
git commit -m "Console: quiet days card on the controls page (admins set and remove mourning days)"
```

---

### Task 9: API doc, full gate, screenshots

**Files:**
- Create: `docs/api/quiet-days.md`

- [ ] **Step 1: Write the procedure doc**

```markdown
# Quiet days and `system.season`

Mourning days ops set in the Console (customer joy J1a). Days are Baghdad calendar dates
(`YYYY-MM-DD`, inclusive); a day turns at Baghdad midnight.

| Procedure | Who | What |
|---|---|---|
| `system.season({ cityId? })` | public | `{ quiet, celebrations, sounds, promos, quietUntil }` for today. Cached 5 s per API instance. Apps poll every 5 min. |
| `system.quietDays()` | dispatcher, support, finance, admin | The 30 most recent periods with `active`. |
| `system.setQuietDays({ cityId?, startsOn, endsOn, label_ar })` | admin | Starts today or later, at most 15 days. `quiet_invalid` otherwise. Audited (`quiet.set`). |
| `system.clearQuietDays({ quietId })` | admin | Idempotent. `quiet_not_found` for an unknown id. Audited (`quiet.clear`). |

Effects on a quiet day: the customer app plays no delivered burst, no success buzz and no moment sounds;
the notify engine suppresses every `marketing` delivery (`reason: quiet_day`), including offers deferred
from the night before. Transactional messages are unchanged.
```

- [ ] **Step 2: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS across the monorepo.

- [ ] **Step 3: Screenshots for Ali**

With the studio running (`pnpm studio console customer`):
1. Console → controls page (`http://localhost:3100/controls`, sign in `0770 000 0001`): the "أيام الهدوء" card; set today with "يوم عزاء (تجربة)", screenshot, then remove it.
2. Customer: `curl -X POST 'http://localhost:3200/demo/quiet?on=1'`, open a delivered order (`POST /demo/track?personId=…&scenario=arrived`), screenshot the calm arrival (no burst); then `?on=0` and screenshot the normal one.

Save the images under the session scratchpad and show them to Ali.

- [ ] **Step 4: Commit and push**

```bash
git add docs/api/quiet-days.md
git commit -m "Docs: quiet days and system.season"
git fetch && git rebase origin/main && git push
```

---

## After J1a: the rest of J1

J1 is split into separate plans, one per area, each producing working software on its own. Write each with this skill when the previous one ships:

| Plan | Board ids | Notes |
|---|---|---|
| J1b Tracking | f1, f2, f3, f18 (client + the +2 min rule), f19, f21 (live regions, route redraw) | f3 builds on SP5b `courier_near`; f19 coordinates with maps SP4b-2 |
| J1c Rides | f4, f5, f6 (3-minute offer), f9 | `customerFreeCancelAfterSec = 180` is the offer moment |
| J1d Food and checkout | f10, f11, small-order fee 500, f12, b3 | Fee: `smallOrderFeeIqd` exists in pricing/postings |
| J1e Money and points | f13 (redemption delivery first, `postings.ts` `redemption()`), f14 | Update the decisions doc with J-D10 |
| J1f System, copy and bugs | f7, f15, f16 (J-D9 minute forms + voice spec), f17, h6, force light mode | — |
