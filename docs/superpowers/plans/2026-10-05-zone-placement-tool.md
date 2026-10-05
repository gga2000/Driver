# Zone Placement Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Console page (النظام › المناطق) where Ali and field ops draw the real outline of each of the 34 Aziziyah zones on a map and save it, replacing the AI-drafted hexagons, without changing any fee yet.

**Architecture:** Pure outline geometry and validation live in `@driver/contracts` (shared by API and Console). A new API module `zones` owns the `zones` table's placement columns behind a repository port (Prisma on Postgres; a JSON-file-backed in-memory store for the studio demo so Ali's work survives restarts; plain in-memory for tests). `ops.zones.list` / `ops.zones.place` tRPC procedures follow the control-room pattern (audit row + domain event in one unit of work). The Console page edits outlines with MapLibre markers driven by a pure reducer. Pricing and dispatch keep using the seed centroids; switching them to the drawn outlines is SP3b and needs Ali's approval because tiers decide fees.

**Tech Stack:** TypeScript, zod, tRPC v11, NestJS, Prisma + PostGIS, Next.js 15 + React 19, maplibre-gl 5.24, Tailwind, vitest.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.3 (SP3, item f4).

---

## File map

| File | Responsibility |
|---|---|
| `packages/contracts/src/zone-geometry.ts` (new) | Pure outline maths: area, centroid, point-in-ring, self-crossing, overlap estimate, service bounds, draft hexagon, `zoneShapeProblem`. |
| `packages/contracts/src/zone-geometry.test.ts` (new) | Unit tests for the above. |
| `packages/contracts/src/zones-io.ts` (new) | zod IO (`ZonePlacementView`, `PlaceZoneInput`), roles, `ZonesPort`, `zoneProblemText`. |
| `packages/contracts/src/routers/zones.ts` (new) | `ops.zones` router. |
| `packages/contracts/src/routers/zones.test.ts` (new) | Role matrix + input defaults. |
| `packages/contracts/src/{index.ts,trpc.ts,routers/ops.ts,errors.ts}` | Export, `AppContext.zones`, mount router, 3 error codes. |
| `packages/i18n/src/locales/{ar-IQ,en}.json` | `zone_shape.*` problem texts, `console.zones_*` page copy, `console.nav_zones`. |
| `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20261005130000_zone_placement/migration.sql` | `centre`, `placement`, `placed_at`, `placed_by_id` on `zones`. |
| `packages/db/prisma/seed-data.ts`, `packages/db/prisma/seed.ts` | Hexagon from `draftRing`; seed never overwrites a non-draft outline. |
| `apps/api/src/modules/zones/{zones.repository.ts,zones.service.ts,zones.module.ts,index.ts}` (new) | Repository port + 3 implementations, service, Nest module. |
| `apps/api/src/modules/zones/{zones.repository.test.ts,zones.service.test.ts,zones.integration.test.ts}` (new) | Tests (integration skipped without `DATABASE_URL`). |
| `apps/api/src/trpc/trpc.module.ts` | Provide `zones` in the tRPC context. |
| `apps/api/src/modules/places/zones.ts` | Use the shared `pointInRing`. |
| `apps/console/scripts/demo-api.mjs` | `ZONES_STORE_FILE` → `.studio/zones-placements.json`. |
| `packages/map/src/colors.ts` | `danger` colour in both map palettes. |
| `apps/console/src/lib/zone-editor.ts` + test (new) | Pure editor reducer (move/insert/remove corner, move shape, undo, reset). |
| `apps/console/src/lib/nav.ts`, `components/shell/sidebar.tsx`, `components/ui/icons.tsx` | Nav item `/zones` (jump `z`), `IconZones`. |
| `apps/console/src/app/zones/page.tsx`, `components/zones-page.tsx`, `components/zones-map-canvas.tsx` (new) | The page and its map. |
| `apps/console/src/components/zones-page.smoke.test.tsx` (new) | Server-render smoke test of the board. |

---

### Task 1: Outline geometry in contracts

**Files:**
- Create: `packages/contracts/src/zone-geometry.ts`
- Test: `packages/contracts/src/zone-geometry.test.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from './zone-geometry.js';`)

- [ ] **Step 1: Write the failing tests** — `packages/contracts/src/zone-geometry.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from './aziziyah-zones.js';
import type { LatLng } from './common.js';
import {
  draftRing,
  fromLocalM,
  openRing,
  overlapAreaM2,
  pointInRing,
  ringAreaM2,
  ringCentroid,
  ringSelfIntersects,
  ZONE_OVERLAP_TOLERANCE_M2,
  zoneServiceBounds,
  zoneShapeProblem,
} from './zone-geometry.js';

const ORIGIN: LatLng = { lat: 32.905, lng: 45.06 };
/** Axis-aligned square, `side` metres, south-west corner `dx`/`dy` metres from ORIGIN. */
const square = (side: number, dx = 0, dy = 0): LatLng[] =>
  [
    { x: dx, y: dy },
    { x: dx + side, y: dy },
    { x: dx + side, y: dy + side },
    { x: dx, y: dy + side },
  ].map((q) => fromLocalM(q, ORIGIN));
const bounds = zoneServiceBounds('aziziyah')!;

describe('zone geometry', () => {
  it('area of a 100 m square is 10,000 m²; a closing point changes nothing', () => {
    const s = square(100);
    expect(ringAreaM2(s)).toBeCloseTo(10_000, -1);
    expect(ringAreaM2([...s, s[0]!])).toBeCloseTo(10_000, -1);
    expect(openRing([...s, s[0]!])).toHaveLength(4);
  });

  it('centroid of a square is its middle', () => {
    const c = ringCentroid(square(100));
    const mid = fromLocalM({ x: 50, y: 50 }, ORIGIN);
    expect(c.lat).toBeCloseTo(mid.lat, 6);
    expect(c.lng).toBeCloseTo(mid.lng, 6);
  });

  it('point in ring', () => {
    expect(pointInRing(fromLocalM({ x: 50, y: 50 }, ORIGIN), square(100))).toBe(true);
    expect(pointInRing(fromLocalM({ x: 150, y: 50 }, ORIGIN), square(100))).toBe(false);
  });

  it('a bow-tie crosses itself; a square and an L-shape do not', () => {
    const [a, b, c, d] = square(100) as [LatLng, LatLng, LatLng, LatLng];
    expect(ringSelfIntersects([a, c, b, d])).toBe(true);
    expect(ringSelfIntersects(square(100))).toBe(false);
    const l = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ].map((q) => fromLocalM(q, ORIGIN));
    expect(ringSelfIntersects(l)).toBe(false);
  });

  it('overlap: half-shifted squares share half; touching or apart share nothing; inside shares all', () => {
    expect(overlapAreaM2(square(200), square(200, 100))).toBeCloseTo(20_000, -2);
    expect(overlapAreaM2(square(200), square(200, 200))).toBeLessThan(ZONE_OVERLAP_TOLERANCE_M2);
    expect(overlapAreaM2(square(200), square(200, 500))).toBe(0);
    expect(overlapAreaM2(square(300), square(100, 100, 100))).toBeCloseTo(10_000, -2);
  });

  it('shape problems, in order', () => {
    const ok = square(300);
    const mid = fromLocalM({ x: 150, y: 150 }, ORIGIN);
    expect(zoneShapeProblem(ok, mid, bounds, [])).toBeNull();
    expect(zoneShapeProblem(ok.slice(0, 2), mid, bounds, [])).toEqual({ kind: 'too_few_points' });
    const [a, b, c, d] = ok as [LatLng, LatLng, LatLng, LatLng];
    expect(zoneShapeProblem([a, c, b, d], mid, bounds, [])).toEqual({ kind: 'self_crossing' });
    expect(zoneShapeProblem(square(50), fromLocalM({ x: 25, y: 25 }, ORIGIN), bounds, [])).toMatchObject({ kind: 'too_small' });
    expect(zoneShapeProblem(ok, fromLocalM({ x: 900, y: 900 }, ORIGIN), bounds, [])).toEqual({ kind: 'centre_outside' });
    expect(zoneShapeProblem([{ lat: 10, lng: 10 }, ...ok.slice(1)], mid, bounds, [])).toEqual({ kind: 'outside_service_area' });
    expect(zoneShapeProblem(ok, mid, bounds, [{ key: 'street_30', ring: square(300, 150) }])).toMatchObject({ kind: 'overlap', withKey: 'street_30' });
    expect(zoneShapeProblem(ok, mid, bounds, [{ key: 'street_30', ring: square(300, 300) }])).toBeNull();
  });

  it('draft ring is the seed hexagon: 6 corners around the seed centre, centre inside', () => {
    const z = AZIZIYAH_ZONES[0]!;
    const ring = draftRing(z);
    expect(ring).toHaveLength(6);
    expect(ring[0]!.lat).toBeCloseTo(z.lat, 6);
    expect(pointInRing({ lat: z.lat, lng: z.lng }, ring)).toBe(true);
  });

  it('service bounds cover every seed zone and nothing for unknown cities', () => {
    for (const z of AZIZIYAH_ZONES) {
      expect(z.lat).toBeGreaterThan(bounds.minLat);
      expect(z.lng).toBeLessThan(bounds.maxLng);
    }
    expect(zoneServiceBounds('atlantis')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @driver/contracts exec vitest run src/zone-geometry.test.ts`
Expected: FAIL — `Cannot find module './zone-geometry.js'`.

- [ ] **Step 3: Implement** — `packages/contracts/src/zone-geometry.ts`

```ts
import { AZIZIYAH_ZONES, type AziziyahZoneSeed } from './aziziyah-zones.js';
import type { LatLng } from './common.js';

/** Fewest corners a zone outline may have. */
export const ZONE_MIN_POINTS = 3;
/** Most corners a zone outline may have; hand-drawn neighbourhoods stay far below it. */
export const ZONE_MAX_POINTS = 80;
/** Smallest zone (about 70 m × 70 m): anything smaller is a slip of the mouse, not a neighbourhood. */
export const ZONE_MIN_AREA_M2 = 5_000;
/** Largest zone (50 km²): the far villages are big, but never this big. */
export const ZONE_MAX_AREA_M2 = 50_000_000;
/**
 * Overlap two neighbouring outlines may share and still count as one border (about 45 m × 45 m):
 * hand-drawn borders never meet exactly, and a sliver must not block saving.
 */
export const ZONE_OVERLAP_TOLERANCE_M2 = 2_000;
/** How far past the seed zones an outline may reach, in degrees (about 11 km). */
export const ZONE_SERVICE_MARGIN_DEG = 0.1;

/** Overlap estimate: a grid of ~20 m cells over the shared bounding box, 10–300 cells per side. */
const OVERLAP_CELL_M = 20;
const OVERLAP_GRID_MIN = 10;
const OVERLAP_GRID_MAX = 300;
/** Metres per degree of latitude (WGS84 mean); city-sized shapes need nothing finer. */
const M_PER_DEG_LAT = 110_574;
/** Metres per degree of longitude at the equator, scaled by cos(latitude). */
const M_PER_DEG_LNG_EQUATOR = 111_320;
/** The seed hexagons use one degree length on both axes; drafts must match them exactly. */
const DRAFT_M_PER_DEG = 111_320;

export interface ZoneBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Another zone's saved outline, for the overlap check. */
export interface PlacedOutline {
  key: string;
  ring: readonly LatLng[];
}

/** Why an outline can't be saved; the Console shows it live and the API refuses with it. */
export type ZoneShapeProblem =
  | { kind: 'too_few_points' }
  | { kind: 'too_many_points' }
  | { kind: 'outside_service_area' }
  | { kind: 'self_crossing' }
  | { kind: 'too_small'; areaM2: number }
  | { kind: 'too_large'; areaM2: number }
  | { kind: 'centre_outside' }
  | { kind: 'overlap'; withKey: string; areaM2: number };

const rad = (deg: number): number => (deg * Math.PI) / 180;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const clampInt = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Flat metres around `origin` (x east, y north). At city scale the error is far below a metre. */
export function toLocalM(p: LatLng, origin: LatLng): { x: number; y: number } {
  return { x: (p.lng - origin.lng) * M_PER_DEG_LNG_EQUATOR * Math.cos(rad(origin.lat)), y: (p.lat - origin.lat) * M_PER_DEG_LAT };
}

/** Inverse of `toLocalM`. */
export function fromLocalM(q: { x: number; y: number }, origin: LatLng): LatLng {
  return { lat: origin.lat + q.y / M_PER_DEG_LAT, lng: origin.lng + q.x / (M_PER_DEG_LNG_EQUATOR * Math.cos(rad(origin.lat))) };
}

/** The ring without a closing point, so callers may pass open or closed rings (GeoJSON closes them). */
export function openRing(ring: readonly LatLng[]): LatLng[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first && last && first.lat === last.lat && first.lng === last.lng) return ring.slice(0, -1);
  return [...ring];
}

/** Area in m² (shoelace in local metres). */
export function ringAreaM2(ring: readonly LatLng[]): number {
  const r = openRing(ring);
  if (r.length < 3) return 0;
  const o = r[0]!;
  let twice = 0;
  for (let i = 0; i < r.length; i++) {
    const p = toLocalM(r[i]!, o);
    const q = toLocalM(r[(i + 1) % r.length]!, o);
    twice += p.x * q.y - q.x * p.y;
  }
  return Math.abs(twice) / 2;
}

/** Area-weighted centre; the corner average when the ring has no area. */
export function ringCentroid(ring: readonly LatLng[]): LatLng {
  const r = openRing(ring);
  if (r.length === 0) throw new RangeError('ringCentroid needs at least one point');
  const o = r[0]!;
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < r.length; i++) {
    const p = toLocalM(r[i]!, o);
    const q = toLocalM(r[(i + 1) % r.length]!, o);
    const cross = p.x * q.y - q.x * p.y;
    twice += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(twice) < 1e-6) {
    return { lat: r.reduce((s, p) => s + p.lat, 0) / r.length, lng: r.reduce((s, p) => s + p.lng, 0) / r.length };
  }
  return fromLocalM({ x: cx / (3 * twice), y: cy / (3 * twice) }, o);
}

/** Ray casting; the ring may be open or closed. */
export function pointInRing(p: LatLng, ring: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects = a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Signed turn of p→q→r; the sign survives the per-axis scaling between degrees and metres. */
function orient(p: LatLng, q: LatLng, r: LatLng): number {
  return (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
}

/** Proper crossing only: segments that merely touch or run along each other don't count. */
function segmentsCross(a1: LatLng, a2: LatLng, b1: LatLng, b2: LatLng): boolean {
  const d1 = orient(b1, b2, a1);
  const d2 = orient(b1, b2, a2);
  const d3 = orient(a1, a2, b1);
  const d4 = orient(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when two non-neighbouring edges cross (a bow-tie): such an outline has no clear inside. */
export function ringSelfIntersects(ring: readonly LatLng[]): boolean {
  const r = openRing(ring);
  const n = r.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(r[i]!, r[(i + 1) % n]!, r[j]!, r[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

function boundsOfRing(ring: readonly LatLng[]): ZoneBounds {
  return {
    minLat: Math.min(...ring.map((p) => p.lat)),
    maxLat: Math.max(...ring.map((p) => p.lat)),
    minLng: Math.min(...ring.map((p) => p.lng)),
    maxLng: Math.max(...ring.map((p) => p.lng)),
  };
}

/**
 * Shared area of two outlines in m², estimated on a grid over their common bounding box. Exact for
 * boxes, within a few percent otherwise; bounded work (at most 300 × 300 samples).
 */
export function overlapAreaM2(a: readonly LatLng[], b: readonly LatLng[]): number {
  const ra = openRing(a);
  const rb = openRing(b);
  if (ra.length < 3 || rb.length < 3) return 0;
  const ba = boundsOfRing(ra);
  const bb = boundsOfRing(rb);
  const box: ZoneBounds = {
    minLat: Math.max(ba.minLat, bb.minLat),
    maxLat: Math.min(ba.maxLat, bb.maxLat),
    minLng: Math.max(ba.minLng, bb.minLng),
    maxLng: Math.min(ba.maxLng, bb.maxLng),
  };
  if (box.minLat >= box.maxLat || box.minLng >= box.maxLng) return 0;
  const corner = { lat: box.minLat, lng: box.minLng };
  const far = toLocalM({ lat: box.maxLat, lng: box.maxLng }, corner);
  const nx = clampInt(Math.ceil(far.x / OVERLAP_CELL_M), OVERLAP_GRID_MIN, OVERLAP_GRID_MAX);
  const ny = clampInt(Math.ceil(far.y / OVERLAP_CELL_M), OVERLAP_GRID_MIN, OVERLAP_GRID_MAX);
  const dLat = (box.maxLat - box.minLat) / ny;
  const dLng = (box.maxLng - box.minLng) / nx;
  let inside = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const p = { lat: box.minLat + (j + 0.5) * dLat, lng: box.minLng + (i + 0.5) * dLng };
      if (pointInRing(p, ra) && pointInRing(p, rb)) inside += 1;
    }
  }
  return inside * (far.x / nx) * (far.y / ny);
}

/** Box around points, widened by `marginDeg` on every side. */
export function zoneBoundsOf(points: readonly LatLng[], marginDeg = ZONE_SERVICE_MARGIN_DEG): ZoneBounds {
  const b = boundsOfRing(points);
  return { minLat: b.minLat - marginDeg, maxLat: b.maxLat + marginDeg, minLng: b.minLng - marginDeg, maxLng: b.maxLng + marginDeg };
}

const SERVICE_BOUNDS = new Map<string, ZoneBounds>([['aziziyah', zoneBoundsOf(AZIZIYAH_ZONES)]]);

/** Where a city's outlines may be drawn; null for a city with no zones. */
export function zoneServiceBounds(cityId: string): ZoneBounds | null {
  return SERVICE_BOUNDS.get(cityId) ?? null;
}

function insideBounds(p: LatLng, b: ZoneBounds): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

/**
 * The first reason an outline can't be saved, or null. `others` are the other zones' saved
 * (non-draft) outlines: the AI hexagons overlap freely and are not checked.
 */
export function zoneShapeProblem(ring: readonly LatLng[], centre: LatLng, bounds: ZoneBounds, others: readonly PlacedOutline[]): ZoneShapeProblem | null {
  const r = openRing(ring);
  if (r.length < ZONE_MIN_POINTS) return { kind: 'too_few_points' };
  if (r.length > ZONE_MAX_POINTS) return { kind: 'too_many_points' };
  if (!r.every((p) => insideBounds(p, bounds))) return { kind: 'outside_service_area' };
  if (ringSelfIntersects(r)) return { kind: 'self_crossing' };
  const areaM2 = Math.round(ringAreaM2(r));
  if (areaM2 < ZONE_MIN_AREA_M2) return { kind: 'too_small', areaM2 };
  if (areaM2 > ZONE_MAX_AREA_M2) return { kind: 'too_large', areaM2 };
  if (!pointInRing(centre, r)) return { kind: 'centre_outside' };
  for (const o of others) {
    const shared = overlapAreaM2(r, o.ring);
    if (shared > ZONE_OVERLAP_TOLERANCE_M2) return { kind: 'overlap', withKey: o.key, areaM2: Math.round(shared) };
  }
  return null;
}

/** The AI-drafted outline: a hexagon of `radiusM` around the seed centre (same as the database seed). */
export function draftRing(z: Pick<AziziyahZoneSeed, 'lat' | 'lng' | 'radiusM'>): LatLng[] {
  const dLat = z.radiusM / DRAFT_M_PER_DEG;
  const dLng = z.radiusM / (DRAFT_M_PER_DEG * Math.cos(rad(z.lat)));
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return { lat: round6(z.lat + dLat * Math.sin(a)), lng: round6(z.lng + dLng * Math.cos(a)) };
  });
}
```

Add to `packages/contracts/src/index.ts` next to the other module exports:

```ts
export * from './zone-geometry.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @driver/contracts exec vitest run src/zone-geometry.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit** — `git add packages/contracts/src/zone-geometry.ts packages/contracts/src/zone-geometry.test.ts packages/contracts/src/index.ts && git commit -m "Contracts: zone outline geometry and validation"`

### Task 2: Zones IO, roles, errors, problem texts

**Files:**
- Create: `packages/contracts/src/zones-io.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/errors.ts` (after `control_invalid`), `packages/i18n/src/locales/ar-IQ.json`, `packages/i18n/src/locales/en.json`

- [ ] **Step 1: Add the i18n keys** (both files, same keys; the i18n test enforces parity)

ar-IQ.json:
```json
  "zone_shape.too_few_points": "لازم 3 نقاط على الأقل",
  "zone_shape.too_many_points": "النقاط هواية: خليها 80 أو أقل",
  "zone_shape.outside_service_area": "نقطة طالعة برّا منطقة الخدمة",
  "zone_shape.self_crossing": "الحدود متقاطعة ويا نفسها",
  "zone_shape.too_small": "المنطقة صغيرة هواية ({area} كم²)",
  "zone_shape.too_large": "المنطقة كبيرة هواية ({area} كم²)",
  "zone_shape.centre_outside": "الدائرة الوسطية لازم تكون داخل الحدود",
  "zone_shape.overlap": "تتداخل ويا {name} ({area} كم²)",
```
en.json:
```json
  "zone_shape.too_few_points": "At least 3 corners",
  "zone_shape.too_many_points": "Too many corners: keep it to 80 or fewer",
  "zone_shape.outside_service_area": "A corner is outside the service area",
  "zone_shape.self_crossing": "The outline crosses itself",
  "zone_shape.too_small": "Too small ({area} km²)",
  "zone_shape.too_large": "Too large ({area} km²)",
  "zone_shape.centre_outside": "The centre circle must be inside the outline",
  "zone_shape.overlap": "Overlaps {name} ({area} km²)",
```

- [ ] **Step 2: Error codes** — in `ERROR_TABLE` (`packages/contracts/src/errors.ts`) after `control_invalid`:

```ts
  zone_unknown: { message_ar: 'ما لگينا المنطقة', message_en: 'Zone not found', retryHint: 'never', status: 'NOT_FOUND' },
  zone_shape_invalid: { message_ar: 'حدود المنطقة مو صحيحة', message_en: 'The zone outline is not valid', retryHint: 'never', status: 'BAD_REQUEST' },
  zone_overlap: { message_ar: 'المنطقة تتداخل ويا منطقة ثانية', message_en: 'The zone overlaps another zone', retryHint: 'never', status: 'CONFLICT' },
```

- [ ] **Step 3: IO module** — `packages/contracts/src/zones-io.ts`

```ts
import { z } from 'zod';
import { t, type Locale } from '@driver/i18n';
import type { RoleKind } from './auth.js';
import { ZoneTier } from './city-config.js';
import { CityId, LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import { ZONE_MAX_POINTS, ZONE_MIN_POINTS, type ZoneShapeProblem } from './zone-geometry.js';

/** Who sees the zone map: Console readers plus field ops (they fix outlines on the ground). */
export const ZONE_READ_ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'finance', 'admin', 'field_ops'];
/** Who draws outlines: Ali (admin) and field ops. Outlines don't move fees until the switch-over (SP3b). */
export const ZONE_EDIT_ROLES: readonly RoleKind[] = ['admin', 'field_ops'];

/** draft = the AI guess; placed = drawn on a real map in the Console; confirmed = drivers agreed on the ground. */
export const ZonePlacement = z.enum(['draft', 'placed', 'confirmed']);
export type ZonePlacement = z.infer<typeof ZonePlacement>;

export const ZonePlacementView = z.object({
  key: z.string(),
  name_ar: z.string(),
  name_en: z.string(),
  tier: ZoneTier,
  group: z.string(),
  placement: ZonePlacement,
  /** Open ring (no closing point). */
  ring: z.array(LatLng),
  centre: LatLng,
  areaM2: z.number().nonnegative(),
  placedBy: z.string().nullable(),
  placedAt: z.coerce.date().nullable(),
});
export type ZonePlacementView = z.infer<typeof ZonePlacementView>;

export const ZonesInput = z.object({ cityId: CityId.default('aziziyah') });

export const PlaceZoneInput = z.object({
  cityId: CityId.default('aziziyah'),
  key: z.string().trim().min(1).max(60),
  /** Open or closed ring (+1 allows the closing point). */
  ring: z.array(LatLng).min(ZONE_MIN_POINTS).max(ZONE_MAX_POINTS + 1),
  centre: LatLng,
});
export type PlaceZoneInput = z.input<typeof PlaceZoneInput>;

/** `ctx.zones`: zone outlines (`modules/zones`). */
export interface ZonesPort {
  list(cityId: string): Promise<ZonePlacementView[]>;
  place(actor: Actor, input: z.output<typeof PlaceZoneInput>): Promise<ZonePlacementView>;
}

/** km² for people: two decimals under 1 km², one above. Western digits. */
export function formatAreaKm2(areaM2: number): string {
  const km2 = areaM2 / 1_000_000;
  return km2.toFixed(km2 < 1 ? 2 : 1);
}

/** The words for a shape problem; `nameOf` turns a zone key into its Arabic (or English) name. */
export function zoneProblemText(p: ZoneShapeProblem, nameOf: (key: string) => string, locale: Locale = 'ar-IQ'): string {
  switch (p.kind) {
    case 'too_small':
    case 'too_large':
      return t(`zone_shape.${p.kind}`, { area: formatAreaKm2(p.areaM2) }, locale);
    case 'overlap':
      return t('zone_shape.overlap', { name: nameOf(p.withKey), area: formatAreaKm2(p.areaM2) }, locale);
    default:
      return t(`zone_shape.${p.kind}`, undefined, locale);
  }
}
```

(If `Locale` is not exported from `@driver/i18n`, use the type of `t`'s third parameter: `Parameters<typeof t>[2]`.)

Add to `packages/contracts/src/index.ts`: `export * from './zones-io.js';`

- [ ] **Step 4: Typecheck** — `pnpm --filter @driver/contracts typecheck` → no errors.
- [ ] **Step 5: Commit** — `git commit -am "Contracts: zones IO, roles, errors and problem texts"` (add the new file first).

### Task 3: `ops.zones` router and context

**Files:**
- Create: `packages/contracts/src/routers/zones.ts`, `packages/contracts/src/routers/zones.test.ts`
- Modify: `packages/contracts/src/routers/ops.ts` (mount), `packages/contracts/src/trpc.ts` (`AppContext.zones`)

- [ ] **Step 1: Failing test** — `packages/contracts/src/routers/zones.test.ts`

```ts
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleKind } from '../auth.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';
import type { ZonePlacementView, ZonesPort } from '../zones-io.js';

const VIEW: ZonePlacementView = {
  key: 'centre', name_ar: 'العزيزية (مركز)', name_en: 'Aziziyah centre', tier: 'centre', group: 'centre', placement: 'placed',
  ring: [{ lat: 32.9, lng: 45.05 }, { lat: 32.9, lng: 45.07 }, { lat: 32.91, lng: 45.06 }], centre: { lat: 32.903, lng: 45.06 },
  areaM2: 1_000_000, placedBy: 'علي', placedAt: new Date('2026-10-05T10:00:00Z'),
};
const RING = VIEW.ring;

function caller(roles: readonly RoleKind[] | null) {
  const zones: ZonesPort = { list: vi.fn(async () => [VIEW]), place: vi.fn(async () => VIEW) };
  const ctx = {
    auth: roles ? { sub: 'p_staff', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind) },
    zones,
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), zones };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => 'ok', (e: unknown) => e);
  if (err === 'ok') return 'ok';
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

type Call = ReturnType<typeof caller>['call'];
const ALL: readonly RoleKind[] = ['customer', 'courier', 'driver', 'merchant_owner', 'fleet_owner', 'field_ops', 'dispatcher', 'support', 'finance', 'admin'];
const MATRIX: Array<[string, readonly RoleKind[], (c: Call) => Promise<unknown>]> = [
  ['ops.zones.list', ['dispatcher', 'support', 'finance', 'admin', 'field_ops'], (c) => c.ops.zones.list({})],
  ['ops.zones.place', ['admin', 'field_ops'], (c) => c.ops.zones.place({ key: 'centre', ring: RING, centre: VIEW.centre })],
];

describe('ops.zones: role gates', () => {
  for (const [name, allowed, run] of MATRIX) {
    it(`${name}: ${allowed.join(', ')} only`, async () => {
      expect(await codeOf(run(caller(null).call))).toBe('UNAUTHORIZED');
      for (const role of ALL) expect([role, await codeOf(run(caller([role]).call))]).toEqual([role, allowed.includes(role) ? 'ok' : 'FORBIDDEN']);
    });
  }
});

describe('ops.zones: input', () => {
  it('defaults the city and passes the outline through', async () => {
    const c = caller(['admin']);
    await c.call.ops.zones.place({ key: 'centre', ring: RING, centre: VIEW.centre });
    expect(vi.mocked(c.zones.place).mock.calls[0]![1]).toEqual({ cityId: 'aziziyah', key: 'centre', ring: RING, centre: VIEW.centre });
  });
  it('refuses fewer than 3 corners before reaching the port', async () => {
    const c = caller(['admin']);
    expect(await codeOf(c.call.ops.zones.place({ key: 'centre', ring: RING.slice(0, 2), centre: VIEW.centre }))).toBe('BAD_REQUEST');
    expect(c.zones.place).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @driver/contracts exec vitest run src/routers/zones.test.ts` → FAIL (`ops.zones` undefined).

- [ ] **Step 3: Router** — `packages/contracts/src/routers/zones.ts`

```ts
import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';
import { PlaceZoneInput, ZONE_EDIT_ROLES, ZONE_READ_ROLES, ZonePlacementView, ZonesInput } from '../zones-io.js';

/** `ops.zones.*` — the zone outlines (maps program SP3). Saving an outline does not move any fee. */
export const opsZonesRouter = router({
  list: protectedProcedure(ZONE_READ_ROLES)
    .input(ZonesInput)
    .output(z.array(ZonePlacementView))
    .query(({ ctx, input }) => ctx.zones.list(input.cityId)),
  place: protectedProcedure(ZONE_EDIT_ROLES)
    .input(PlaceZoneInput)
    .output(ZonePlacementView)
    .mutation(({ ctx, input }) => ctx.zones.place(ctx.actor, input)),
});
```

`packages/contracts/src/routers/ops.ts`: `import { opsZonesRouter } from './zones.js';` and inside `opsRouter` after `controls: opsControlsRouter,`:
```ts
  /** Zone outlines drawn on a real map (Console › المناطق; admin / field ops to change). */
  zones: opsZonesRouter,
```

`packages/contracts/src/trpc.ts`: `import type { ZonesPort } from './zones-io.js';` and in `AppContext` after `support: SupportPort;`:
```ts
  /** Zone outlines drawn in the Console (`modules/zones`). */
  zones: ZonesPort;
```

- [ ] **Step 4: Run** — same command → PASS (4 tests). Then `pnpm --filter @driver/contracts test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "Contracts: ops.zones router (list, place)"`

### Task 4: Database columns and seed

**Files:**
- Create: `packages/db/prisma/migrations/20261005130000_zone_placement/migration.sql`
- Modify: `packages/db/prisma/schema.prisma` (model `Zone`), `packages/db/prisma/seed-data.ts` (`hexagonWkt`), `packages/db/prisma/seed.ts` (`seedZones` conflict clause)

- [ ] **Step 1: Migration**

```sql
-- Zone placement tool (maps program SP3, approved by Ali 2026-10-05): outlines drawn on a real map in
-- the Console replace the AI-drafted hexagons. `placement` is draft | placed | confirmed; the seed never
-- overwrites an outline that is not a draft. Additive: existing rows stay drafts.
ALTER TABLE "public"."zones"
  ADD COLUMN "centre" geography(Point, 4326),
  ADD COLUMN "placement" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "placed_at" TIMESTAMP(3),
  ADD COLUMN "placed_by_id" TEXT;
```

- [ ] **Step 2: Schema** — in `model Zone` after `verifiedAt`:

```prisma
  /// Centre handle of a drawn outline (the label and pin anchor). NULL for AI drafts (seed centre).
  centre     Unsupported("geography(Point, 4326)")?
  /// draft (AI hexagon) | placed (drawn in the Console) | confirmed (drivers agreed on the ground).
  placement  String                                  @default("draft")
  placedAt   DateTime?                               @map("placed_at")
  placedById String?                                 @map("placed_by_id")
```
Also update the model's doc comment: `/// Pricing/dispatch zone. Outlines start as AI-drafted hexagons; Ali / field ops draw the real ones in the Console.`

- [ ] **Step 3: Seed** — `seed-data.ts`:

```ts
import { AZIZIYAH_ZONES, draftRing, type AziziyahZoneSeed } from '@driver/contracts';
…
/** Draft polygon: the AI hexagon (`draftRing`, shared with the API's demo store) as WKT (lng lat order). */
export function hexagonWkt(z: Pick<AziziyahZoneSeed, 'lat' | 'lng' | 'radiusM'>): string {
  const ring = draftRing(z);
  const pts = [...ring, ring[0]!].map((p) => `${p.lng.toFixed(6)} ${p.lat.toFixed(6)}`);
  return `POLYGON((${pts.join(', ')}))`;
}
```
`seed.ts` conflict clause:
```sql
        -- never overwrite an outline someone drew or drivers verified
        "polygon" = CASE WHEN "zones"."verified_at" IS NULL AND "zones"."placement" = 'draft' THEN EXCLUDED."polygon" ELSE "zones"."polygon" END
```

- [ ] **Step 4: Verify** — `pnpm --filter @driver/db exec prisma validate` → valid; `pnpm --filter @driver/db test` → pass (schema and Supabase rules: ALTER-only migrations need no `driver_harden`).
- [ ] **Step 5: Commit** — `git commit -m "DB: zone placement columns; seed keeps drawn outlines"`

### Task 5: API repository (Prisma, file-backed, in-memory)

**Files:**
- Create: `apps/api/src/modules/zones/zones.repository.ts`, `apps/api/src/modules/zones/zones.repository.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { FileZonesRepository, InMemoryZonesRepository } from './zones.repository.js';

const RING = [{ lat: 32.9, lng: 45.05 }, { lat: 32.9, lng: 45.07 }, { lat: 32.91, lng: 45.06 }];
const SAVE = { cityId: 'aziziyah', key: 'centre', ring: RING, centre: { lat: 32.903, lng: 45.06 }, placedById: 'p_ali', placedAt: new Date('2026-10-05T10:00:00Z') };

describe('InMemoryZonesRepository', () => {
  it('starts with every seed zone as a draft hexagon', async () => {
    const rows = await new InMemoryZonesRepository().list('aziziyah');
    expect(rows).toHaveLength(AZIZIYAH_ZONES.length);
    expect(rows.every((r) => r.placement === 'draft' && r.ring.length === 6 && r.centre === null)).toBe(true);
  });
  it('saves a placement and refuses unknown zones', async () => {
    const repo = new InMemoryZonesRepository();
    expect(await repo.savePlacement(SAVE)).toMatchObject({ key: 'centre', placement: 'placed', ring: RING, placedById: 'p_ali' });
    expect(await repo.savePlacement({ ...SAVE, key: 'atlantis' })).toBeNull();
    expect((await repo.list('aziziyah')).find((r) => r.key === 'centre')?.placement).toBe('placed');
  });
});

describe('FileZonesRepository', () => {
  it('keeps placements across restarts', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zones-')), 'zones.json');
    await new FileZonesRepository(file).savePlacement(SAVE);
    const again = await new FileZonesRepository(file).list('aziziyah');
    expect(again.find((r) => r.key === 'centre')).toMatchObject({ placement: 'placed', ring: RING, placedAt: SAVE.placedAt });
    expect(again).toHaveLength(AZIZIYAH_ZONES.length);
  });
  it('refuses a file that is not a zone snapshot', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zones-')), 'zones.json');
    writeFileSync(file, '{"nope":true}');
    expect(() => new FileZonesRepository(file)).toThrow(/not a zone snapshot/);
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @driver/api exec vitest run src/modules/zones/zones.repository.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `apps/api/src/modules/zones/zones.repository.ts`

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { Prisma } from '@driver/db';
import { AZIZIYAH_ZONES, draftRing, LatLng, openRing, ZonePlacement, type AziziyahZoneSeed } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** One zone's outline as stored. */
export interface ZoneRecord {
  cityId: string;
  key: string;
  /** Open ring. */
  ring: LatLng[];
  /** Centre handle; null for AI drafts (the seed centre stands in). */
  centre: LatLng | null;
  placement: ZonePlacement;
  placedAt: Date | null;
  placedById: string | null;
}

export interface SavePlacement {
  cityId: string;
  key: string;
  ring: LatLng[];
  centre: LatLng;
  placedById: string;
  placedAt: Date;
}

export interface ZonesRepository {
  list(cityId: string, tx?: Tx): Promise<ZoneRecord[]>;
  /** Null when the city has no such zone. */
  savePlacement(input: SavePlacement, tx?: Tx): Promise<ZoneRecord | null>;
}

export const ZONES_REPOSITORY = Symbol('ZONES_REPOSITORY');

const DRAFT_SEEDS = new Map<string, readonly AziziyahZoneSeed[]>([['aziziyah', AZIZIYAH_ZONES]]);
const rowKey = (cityId: string, key: string): string => `${cityId}|${key}`;
const copy = (r: ZoneRecord): ZoneRecord => ({ ...r, ring: r.ring.map((p) => ({ ...p })), centre: r.centre ? { ...r.centre } : null });

/** Tests and the plain in-memory API: seed drafts, placements forgotten on restart. */
export class InMemoryZonesRepository implements ZonesRepository {
  protected readonly rows = new Map<string, ZoneRecord>();
  private readonly seeded = new Set<string>();

  private ensure(cityId: string): void {
    if (this.seeded.has(cityId)) return;
    this.seeded.add(cityId);
    for (const z of DRAFT_SEEDS.get(cityId) ?? []) {
      const k = rowKey(cityId, z.id);
      if (!this.rows.has(k)) this.rows.set(k, { cityId, key: z.id, ring: draftRing(z), centre: null, placement: 'draft', placedAt: null, placedById: null });
    }
  }

  async list(cityId: string): Promise<ZoneRecord[]> {
    this.ensure(cityId);
    return [...this.rows.values()].filter((r) => r.cityId === cityId).map(copy);
  }

  async savePlacement(input: SavePlacement): Promise<ZoneRecord | null> {
    this.ensure(input.cityId);
    const k = rowKey(input.cityId, input.key);
    if (!this.rows.has(k)) return null;
    const row: ZoneRecord = { cityId: input.cityId, key: input.key, ring: input.ring.map((p) => ({ ...p })), centre: { ...input.centre }, placement: 'placed', placedAt: input.placedAt, placedById: input.placedById };
    this.rows.set(k, row);
    this.afterWrite();
    return copy(row);
  }

  /** Hook for the file-backed store. */
  protected afterWrite(): void {}
}

const ZoneSnapshot = z.object({
  version: z.literal(1),
  zones: z.array(
    z.object({
      cityId: z.string(),
      key: z.string(),
      ring: z.array(LatLng),
      centre: LatLng.nullable(),
      placement: ZonePlacement,
      placedAt: z.coerce.date().nullable(),
      placedById: z.string().nullable(),
    }),
  ),
});

/**
 * Studio / demo API (`ZONES_STORE_FILE`): the in-memory store, written to a JSON file after every save
 * so outlines drawn in the demo Console survive restarts. Only placed zones are written.
 */
export class FileZonesRepository extends InMemoryZonesRepository {
  constructor(private readonly file: string) {
    super();
    if (!existsSync(file)) return;
    let snapshot: z.infer<typeof ZoneSnapshot>;
    try {
      snapshot = ZoneSnapshot.parse(JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      throw new Error(`ZONES_STORE_FILE ${file} is not a zone snapshot: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const r of snapshot.zones) this.rows.set(rowKey(r.cityId, r.key), r);
  }

  protected override afterWrite(): void {
    const zones = [...this.rows.values()].filter((r) => r.placement !== 'draft');
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, zones }, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}

interface ZoneRow {
  key: string;
  polygon: string;
  lat: number | null;
  lng: number | null;
  placement: string;
  placed_at: Date | null;
  placed_by_id: string | null;
}

const COLUMNS = Prisma.sql`"key", ST_AsGeoJSON("polygon"::geometry) AS polygon, ST_Y("centre"::geometry) AS lat, ST_X("centre"::geometry) AS lng, "placement", "placed_at", "placed_by_id"`;
const GeoJsonPolygon = z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1) });

function fromRow(cityId: string, r: ZoneRow): ZoneRecord {
  const outer = GeoJsonPolygon.parse(JSON.parse(r.polygon)).coordinates[0]!;
  return {
    cityId,
    key: r.key,
    ring: openRing(outer.map(([lng, lat]) => ({ lat, lng }))),
    centre: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
    placement: ZonePlacement.parse(r.placement),
    placedAt: r.placed_at,
    placedById: r.placed_by_id,
  };
}

function ringWkt(ring: readonly LatLng[]): string {
  const r = openRing(ring);
  return `POLYGON((${[...r, r[0]!].map((p) => `${p.lng} ${p.lat}`).join(', ')}))`;
}

/** Postgres: `zones.polygon` / `centre` are PostGIS geography, written and read with raw SQL. */
export class PrismaZonesRepository implements ZonesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async list(cityId: string, tx?: Tx): Promise<ZoneRecord[]> {
    const rows = await this.db(tx).$queryRaw<ZoneRow[]>`SELECT ${COLUMNS} FROM "public"."zones" WHERE "city_id" = ${cityId} ORDER BY "key"`;
    return rows.map((r) => fromRow(cityId, r));
  }

  async savePlacement(input: SavePlacement, tx?: Tx): Promise<ZoneRecord | null> {
    const rows = await this.db(tx).$queryRaw<ZoneRow[]>`
      UPDATE "public"."zones" SET
        "polygon" = ST_GeogFromText(${ringWkt(input.ring)}),
        "centre" = ST_SetSRID(ST_MakePoint(${input.centre.lng}, ${input.centre.lat}), 4326)::geography,
        "placement" = 'placed', "placed_at" = ${input.placedAt}, "placed_by_id" = ${input.placedById}, "updated_at" = ${input.placedAt}
      WHERE "city_id" = ${input.cityId} AND "key" = ${input.key}
      RETURNING ${COLUMNS}`;
    return rows[0] ? fromRow(input.cityId, rows[0]) : null;
  }
}
```

- [ ] **Step 4: Run** — same command → PASS (4 tests).
- [ ] **Step 5: Commit** — `git commit -m "API: zones repository (Postgres, file-backed demo, in-memory)"`

### Task 6: Zones service

**Files:**
- Create: `apps/api/src/modules/zones/zones.service.ts`, `apps/api/src/modules/zones/zones.service.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { fromLocalM, type Actor, type LatLng } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import { InMemoryZonesRepository } from './zones.repository.js';
import { ZonesService } from './zones.service.js';

const ALI: Actor = { personId: 'p_ali', sessionId: 's1' };
const ORIGIN: LatLng = { lat: 32.905, lng: 45.06 };
const square = (side: number, dx = 0, dy = 0): LatLng[] =>
  [{ x: dx, y: dy }, { x: dx + side, y: dy }, { x: dx + side, y: dy + side }, { x: dx, y: dy + side }].map((q) => fromLocalM(q, ORIGIN));
const middle = (side: number, dx = 0, dy = 0): LatLng => fromLocalM({ x: dx + side / 2, y: dy + side / 2 }, ORIGIN);

function harness() {
  const clock = new FakeClock('2026-10-05T10:00:00Z');
  const ev = createInMemoryEvents({ clock });
  const audit = new InMemoryControlsRepository();
  const identity = { firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, id === 'p_ali' ? 'علي' : null])) } as unknown as IdentityService;
  const names = new StaffNames(identity, clock);
  const svc = new ZonesService(new InMemoryZonesRepository(), ev.events, new AuditLogService(audit, names, clock), names, ev.uow, clock);
  return { svc, ev, audit };
}

describe('ZonesService', () => {
  it('lists the 34 zones as AI drafts with Western-digit names', async () => {
    const zones = await harness().svc.list('aziziyah');
    expect(zones).toHaveLength(34);
    expect(zones.find((z) => z.key === 'street_30')).toMatchObject({ name_ar: 'شارع 30', placement: 'draft', placedBy: null });
  });

  it('saves an outline: placed, by whom, audited, evented', async () => {
    const h = harness();
    const v = await h.svc.place(ALI, { cityId: 'aziziyah', key: 'centre', ring: square(600), centre: middle(600) });
    expect(v).toMatchObject({ key: 'centre', placement: 'placed', placedBy: 'علي', placedAt: new Date('2026-10-05T10:00:00Z') });
    expect(v.areaM2).toBeGreaterThan(355_000);
    expect(h.audit.auditRows.map((a) => a.action)).toEqual(['zone.placed']);
    expect((await h.ev.events.forAggregate('zone', 'aziziyah:centre')).map((e) => e.type)).toEqual(['zone.placed']);
  });

  it('refuses unknown zones and broken outlines', async () => {
    const { svc } = harness();
    await expect(svc.place(ALI, { cityId: 'aziziyah', key: 'atlantis', ring: square(600), centre: middle(600) })).rejects.toMatchObject({ code: 'zone_unknown' });
    const [a, b, c, d] = square(600) as [LatLng, LatLng, LatLng, LatLng];
    await expect(svc.place(ALI, { cityId: 'aziziyah', key: 'centre', ring: [a, c, b, d], centre: middle(600) })).rejects.toMatchObject({ code: 'zone_shape_invalid' });
  });

  it('refuses overlapping a placed neighbour, not an AI draft, and ignores its own old outline', async () => {
    const { svc } = harness();
    await svc.place(ALI, { cityId: 'aziziyah', key: 'centre', ring: square(600), centre: middle(600) });
    await expect(svc.place(ALI, { cityId: 'aziziyah', key: 'street_30', ring: square(600, 300), centre: middle(600, 300) })).rejects.toMatchObject({ code: 'zone_overlap' });
    await expect(svc.place(ALI, { cityId: 'aziziyah', key: 'street_30', ring: square(600, 600), centre: middle(600, 600) })).resolves.toMatchObject({ placement: 'placed' });
    await expect(svc.place(ALI, { cityId: 'aziziyah', key: 'centre', ring: square(590), centre: middle(590) })).resolves.toMatchObject({ placement: 'placed' });
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @driver/api exec vitest run src/modules/zones/zones.service.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `apps/api/src/modules/zones/zones.service.ts`

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  AZIZIYAH_ZONES,
  DriverError,
  openRing,
  ringAreaM2,
  westernDigits,
  zoneProblemText,
  zoneServiceBounds,
  zoneShapeProblem,
  type Actor,
  type AziziyahZoneSeed,
  type PlaceZoneInput,
  type ZonePlacementView,
  type ZonesPort,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { EventsService } from '../events/index.js';
import { ZONES_REPOSITORY, type ZoneRecord, type ZonesRepository } from './zones.repository.js';

const SEEDS = new Map<string, readonly AziziyahZoneSeed[]>([['aziziyah', AZIZIYAH_ZONES]]);

function view(seed: AziziyahZoneSeed, row: ZoneRecord, names: Record<string, string | null>): ZonePlacementView {
  return {
    key: seed.id,
    name_ar: westernDigits(seed.name_ar),
    name_en: seed.name_en,
    tier: seed.tier,
    group: seed.group,
    placement: row.placement,
    ring: row.ring,
    centre: row.centre ?? { lat: seed.lat, lng: seed.lng },
    areaM2: Math.round(ringAreaM2(row.ring)),
    placedBy: row.placedById ? (names[row.placedById] ?? null) : null,
    placedAt: row.placedAt,
  };
}

/**
 * Zone outlines (maps program SP3). Ali and field ops draw them in the Console; each save is
 * validated (shape, service area, overlap with other drawn zones), audited and evented. Pricing and
 * dispatch still use the seed centroids until the switch-over (SP3b), so a save never moves a fee.
 */
@Injectable()
export class ZonesService implements ZonesPort {
  constructor(
    @Inject(ZONES_REPOSITORY) private readonly repo: ZonesRepository,
    private readonly events: EventsService,
    private readonly audits: AuditLogService,
    private readonly names: StaffNames,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(cityId: string): Promise<ZonePlacementView[]> {
    const rows = new Map((await this.repo.list(cityId)).map((r) => [r.key, r]));
    const names = await this.names.of([...rows.values()].flatMap((r) => (r.placedById ? [r.placedById] : [])));
    return (SEEDS.get(cityId) ?? []).flatMap((seed) => {
      const row = rows.get(seed.id);
      return row ? [view(seed, row, names)] : [];
    });
  }

  async place(actor: Actor, input: z.output<typeof PlaceZoneInput>): Promise<ZonePlacementView> {
    const seeds = SEEDS.get(input.cityId) ?? [];
    const seed = seeds.find((s) => s.id === input.key);
    const bounds = zoneServiceBounds(input.cityId);
    if (!seed || !bounds) throw new DriverError('zone_unknown');
    const ring = openRing(input.ring);
    const others = (await this.repo.list(input.cityId)).filter((r) => r.key !== input.key && r.placement !== 'draft').map((r) => ({ key: r.key, ring: r.ring }));
    const problem = zoneShapeProblem(ring, input.centre, bounds, others);
    if (problem) {
      const nameOf = (key: string): string => westernDigits(seeds.find((s) => s.id === key)?.name_ar ?? key);
      throw new DriverError(problem.kind === 'overlap' ? 'zone_overlap' : 'zone_shape_invalid', { messageAr: zoneProblemText(problem, nameOf) });
    }
    const now = this.clock.now();
    const areaM2 = Math.round(ringAreaM2(ring));
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.savePlacement({ cityId: input.cityId, key: input.key, ring, centre: input.centre, placedById: actor.personId, placedAt: now }, tx);
      if (!saved) throw new DriverError('zone_unknown');
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'zone.placed', occurredAt: now, payload: { cityId: input.cityId, key: input.key, points: ring.length, areaM2 } },
        { name: 'zone', id: `${input.cityId}:${input.key}` },
      );
      await this.audits.record(
        { cityId: input.cityId, actorId: actor.personId, action: 'zone.placed', subjectKind: 'zone', subjectId: input.key, summaryAr: `حط حدود ${westernDigits(seed.name_ar)} على الخريطة`, detail: { points: ring.length, areaM2 } },
        tx,
      );
      return saved;
    });
    return view(seed, row, await this.names.of([actor.personId]));
  }
}
```

- [ ] **Step 4: Run** — PASS (4 tests).
- [ ] **Step 5: Commit** — `git commit -m "API: zones service (validate, save, audit, event)"`

### Task 7: Nest module, tRPC wiring, shared point-in-ring

**Files:**
- Create: `apps/api/src/modules/zones/zones.module.ts`, `apps/api/src/modules/zones/index.ts`
- Modify: `apps/api/src/trpc/trpc.module.ts`, `apps/api/src/modules/places/zones.ts`

- [ ] **Step 1: Module**

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ControlsModule } from '../controls/index.js';
import { EventsModule } from '../events/index.js';
import { FileZonesRepository, InMemoryZonesRepository, PrismaZonesRepository, ZONES_REPOSITORY, type ZonesRepository } from './zones.repository.js';
import { ZonesService } from './zones.service.js';

/**
 * Zone outlines: Postgres with DATABASE_URL; otherwise a JSON file when ZONES_STORE_FILE is set (the
 * studio's demo API, so outlines drawn there survive restarts), else memory only.
 */
@Module({
  imports: [EventsModule, ControlsModule],
  providers: [
    {
      provide: ZONES_REPOSITORY,
      useFactory: (prisma: PrismaService): ZonesRepository => {
        if (prisma.configured) return new PrismaZonesRepository(prisma);
        const file = process.env['ZONES_STORE_FILE'];
        return file ? new FileZonesRepository(file) : new InMemoryZonesRepository();
      },
      inject: [PrismaService],
    },
    ZonesService,
  ],
  exports: [ZonesService],
})
export class ZonesModule {}
```

`index.ts`:
```ts
export { ZonesModule } from './zones.module.js';
export { ZonesService } from './zones.service.js';
export { FileZonesRepository, InMemoryZonesRepository, PrismaZonesRepository, ZONES_REPOSITORY } from './zones.repository.js';
export type { ZoneRecord, ZonesRepository, SavePlacement } from './zones.repository.js';
```

- [ ] **Step 2: tRPC context** — `trpc.module.ts`: `import { ZonesModule, ZonesService } from '../modules/zones/index.js';`, constructor `private readonly zones: ZonesService,` after `support`, context `zones: this.zones,` after `support: this.support,`, and add `ZonesModule` to the `@Module` imports array.

- [ ] **Step 3: Shared point-in-ring** — in `apps/api/src/modules/places/zones.ts` delete the local `pointInRing` function and add `export { pointInRing } from '@driver/contracts';` plus `import { pointInRing } from '@driver/contracts';` for its own use (keeps `places.service.ts` and `places/index.ts` unchanged).

- [ ] **Step 4: Verify** — `pnpm --filter @driver/api typecheck && pnpm --filter @driver/api lint && pnpm --filter @driver/api test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "API: zones module in the tRPC context"`

### Task 8: Postgres integration test

**Files:** Create `apps/api/src/modules/zones/zones.integration.test.ts`

- [ ] **Step 1: Test** (skipped without `DATABASE_URL`; CI runs it)

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaZonesRepository } from './zones.repository.js';

const url = process.env['DATABASE_URL'];
const CITY = 'zt_zone_city';

describe.skipIf(!url)('zones on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaZonesRepository(prisma);

  beforeAll(async () => {
    await prisma.onModuleInit?.();
    await prisma.prisma.$executeRaw`INSERT INTO "public"."cities" ("id", "name_ar", "name_en", "updated_at") VALUES (${CITY}, 'تجربة', 'Test', now()) ON CONFLICT ("id") DO NOTHING`;
    await prisma.prisma.$executeRaw`
      INSERT INTO "public"."zones" ("id", "city_id", "key", "name_ar", "name_en", "tier", "polygon", "updated_at")
      VALUES ('zt_zone_1', ${CITY}, 'centre', 'مركز', 'Centre', 'centre'::"public"."ZoneTier",
              ST_GeogFromText('POLYGON((45.05 32.90, 45.07 32.90, 45.06 32.91, 45.05 32.90))'), now())
      ON CONFLICT ("city_id", "key") DO NOTHING`;
  });
  afterAll(async () => {
    await prisma.prisma.$executeRaw`DELETE FROM "public"."zones" WHERE "city_id" = ${CITY}`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."cities" WHERE "id" = ${CITY}`;
    await prisma.onModuleDestroy?.();
  });

  it('reads the draft and writes a placement', async () => {
    expect((await repo.list(CITY))[0]).toMatchObject({ key: 'centre', placement: 'draft', centre: null });
    const ring = [{ lat: 32.9, lng: 45.05 }, { lat: 32.9, lng: 45.08 }, { lat: 32.92, lng: 45.065 }];
    const saved = await repo.savePlacement({ cityId: CITY, key: 'centre', ring, centre: { lat: 32.907, lng: 45.065 }, placedById: 'p_ali', placedAt: new Date('2026-10-05T10:00:00Z') });
    expect(saved).toMatchObject({ placement: 'placed', placedById: 'p_ali', centre: { lat: 32.907, lng: 45.065 } });
    expect(saved!.ring).toHaveLength(3);
    expect(await repo.savePlacement({ cityId: CITY, key: 'nope', ring, centre: { lat: 32.907, lng: 45.065 }, placedById: 'p_ali', placedAt: new Date() })).toBeNull();
  });
});
```
(Match `PrismaService` lifecycle calls to `routes.integration.test.ts`; use the same connect/disconnect lines it uses.)

- [ ] **Step 2: Run locally** → skipped. **Step 3: Commit** — `git commit -m "API: zones Postgres integration test"`

### Task 9: Studio demo keeps outlines

**Files:** Modify `apps/console/scripts/demo-api.mjs` (before `createApp()`)

- [ ] **Step 1:**
```js
// Outlines drawn in the demo Console (Zones page) are written here so they survive restarts.
process.env.ZONES_STORE_FILE ??= fileURLToPath(new URL('../../../.studio/zones-placements.json', import.meta.url));
```
(`.studio/` is git-ignored.)
- [ ] **Step 2: Commit** — `git commit -m "Console demo: keep drawn zone outlines in .studio"`

### Task 10: Editor reducer (Console)

**Files:** Create `apps/console/src/lib/zone-editor.ts`, `apps/console/src/lib/zone-editor.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import type { LatLng } from '@driver/contracts';
import { closedEditor, editorReducer, isDirty, midpoints } from './zone-editor';

const RING: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 2, lng: 2 }, { lat: 2, lng: 0 }];
const open = editorReducer(closedEditor, { type: 'open', key: 'centre', ring: RING, centre: { lat: 1, lng: 1 } });

describe('zone editor', () => {
  it('opens clean', () => {
    expect(open).toMatchObject({ key: 'centre', ring: RING, selected: null });
    expect(isDirty(open)).toBe(false);
  });
  it('drag a corner: begin, move; undo restores; reset returns to saved', () => {
    let s = editorReducer(open, { type: 'begin' });
    s = editorReducer(s, { type: 'moveVertex', index: 2, to: { lat: 3, lng: 3 } });
    s = editorReducer(s, { type: 'moveVertex', index: 2, to: { lat: 2.5, lng: 2.5 } });
    expect(s.ring[2]).toEqual({ lat: 2.5, lng: 2.5 });
    expect(isDirty(s)).toBe(true);
    expect(editorReducer(s, { type: 'undo' }).ring).toEqual(RING);
    expect(editorReducer(s, { type: 'reset' }).ring).toEqual(RING);
  });
  it('insert after a corner and remove; never below 3 corners', () => {
    const ins = editorReducer(open, { type: 'insertVertex', after: 0, at: { lat: -1, lng: 1 } });
    expect(ins.ring).toHaveLength(5);
    expect(ins.ring[1]).toEqual({ lat: -1, lng: 1 });
    expect(ins.selected).toBe(1);
    let tri = editorReducer(open, { type: 'removeVertex', index: 0 });
    expect(tri.ring).toHaveLength(3);
    tri = editorReducer(tri, { type: 'removeVertex', index: 0 });
    expect(tri.ring).toHaveLength(3);
  });
  it('moving the centre moves the whole shape', () => {
    let s = editorReducer(open, { type: 'begin' });
    s = editorReducer(s, { type: 'moveShape', to: { lat: 2, lng: 3 } });
    expect(s.centre).toEqual({ lat: 2, lng: 3 });
    expect(s.ring[0]).toEqual({ lat: 1, lng: 2 });
  });
  it('a corner edit that leaves the centre outside pulls the centre back in', () => {
    const nearCorner = editorReducer(closedEditor, { type: 'open', key: 'centre', ring: RING, centre: { lat: 1.8, lng: 1.8 } });
    const s = editorReducer(nearCorner, { type: 'removeVertex', index: 2 });
    expect(s.centre).not.toEqual({ lat: 1.8, lng: 1.8 });
    expect(s.centre.lat + s.centre.lng).toBeLessThan(2);
  });
  it('midpoints sit between each corner and the next', () => {
    expect(midpoints(RING)[0]).toEqual({ lat: 0, lng: 1 });
    expect(midpoints(RING)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @driver/console exec vitest run src/lib/zone-editor.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `apps/console/src/lib/zone-editor.ts`

```ts
import { pointInRing, ringCentroid, ZONE_MIN_POINTS, type LatLng } from '@driver/contracts';

/** How many steps "تراجع" remembers. */
export const UNDO_LIMIT = 50;

export interface EditorState {
  key: string | null;
  saved: { ring: LatLng[]; centre: LatLng } | null;
  ring: LatLng[];
  centre: LatLng;
  selected: number | null;
  undo: Array<{ ring: LatLng[]; centre: LatLng }>;
}

export type EditorAction =
  | { type: 'open'; key: string; ring: LatLng[]; centre: LatLng }
  | { type: 'close' }
  /** A drag starts: remember the shape once, so one drag is one undo step. */
  | { type: 'begin' }
  | { type: 'moveVertex'; index: number; to: LatLng }
  | { type: 'moveShape'; to: LatLng }
  | { type: 'insertVertex'; after: number; at: LatLng }
  | { type: 'removeVertex'; index: number }
  | { type: 'select'; index: number | null }
  | { type: 'undo' }
  | { type: 'reset' };

export const closedEditor: EditorState = { key: null, saved: null, ring: [], centre: { lat: 0, lng: 0 }, selected: null, undo: [] };

const snapshot = (s: EditorState) => ({ ring: s.ring, centre: s.centre });
const pushUndo = (s: EditorState) => [...s.undo, snapshot(s)].slice(-UNDO_LIMIT);
/** After a corner edit the centre must stay inside; if it fell out, move it to the middle. */
const keepCentre = (ring: LatLng[], centre: LatLng): LatLng => (ring.length >= ZONE_MIN_POINTS && !pointInRing(centre, ring) ? ringCentroid(ring) : centre);

/** Pure outline editor behind the Zones page; the map only dispatches actions. */
export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'open':
      return { key: a.key, saved: { ring: a.ring, centre: a.centre }, ring: a.ring, centre: a.centre, selected: null, undo: [] };
    case 'close':
      return closedEditor;
    case 'begin':
      return { ...s, undo: pushUndo(s) };
    case 'moveVertex': {
      if (!s.ring[a.index]) return s;
      const ring = s.ring.map((p, i) => (i === a.index ? a.to : p));
      return { ...s, ring, centre: keepCentre(ring, s.centre), selected: a.index };
    }
    case 'moveShape': {
      const dLat = a.to.lat - s.centre.lat;
      const dLng = a.to.lng - s.centre.lng;
      return { ...s, centre: a.to, ring: s.ring.map((p) => ({ lat: p.lat + dLat, lng: p.lng + dLng })) };
    }
    case 'insertVertex': {
      const ring = [...s.ring.slice(0, a.after + 1), a.at, ...s.ring.slice(a.after + 1)];
      return { ...s, undo: pushUndo(s), ring, centre: keepCentre(ring, s.centre), selected: a.after + 1 };
    }
    case 'removeVertex': {
      if (s.ring.length <= ZONE_MIN_POINTS || !s.ring[a.index]) return s;
      const ring = s.ring.filter((_, i) => i !== a.index);
      return { ...s, undo: pushUndo(s), ring, centre: keepCentre(ring, s.centre), selected: null };
    }
    case 'select':
      return { ...s, selected: a.index };
    case 'undo': {
      const last = s.undo[s.undo.length - 1];
      return last ? { ...s, ...last, undo: s.undo.slice(0, -1), selected: null } : s;
    }
    case 'reset':
      return s.saved ? { ...s, ring: s.saved.ring, centre: s.saved.centre, undo: [], selected: null } : s;
  }
}

export function isDirty(s: EditorState): boolean {
  return s.saved !== null && (s.ring !== s.saved.ring || s.centre !== s.saved.centre) && JSON.stringify(snapshot(s)) !== JSON.stringify(s.saved);
}

/** The "+" handles: the middle of each edge (corner i → corner i+1). */
export function midpoints(ring: readonly LatLng[]): LatLng[] {
  return ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return { lat: (p.lat + q.lat) / 2, lng: (p.lng + q.lng) / 2 };
  });
}
```

- [ ] **Step 4: Run** — PASS (6 tests).
- [ ] **Step 5: Commit** — `git commit -m "Console: zone outline editor reducer"`

### Task 11: Copy, nav item, icon, map danger colour

**Files:** `packages/i18n/src/locales/{ar-IQ,en}.json`, `apps/console/src/lib/nav.ts`, `apps/console/src/components/shell/sidebar.tsx`, `apps/console/src/components/ui/icons.tsx`, `packages/map/src/colors.ts`

- [ ] **Step 1: Copy** (ar-IQ / en)

| key | ar-IQ | en |
|---|---|---|
| `console.nav_zones` | المناطق | Zones |
| `console.zones_title` | المناطق | Zones |
| `console.zones_subtitle` | ارسم حدود كل منطقة على الخريطة. الأسعار ما تتغير لحد ما توافق على التحويل. | Draw each zone's outline on the map. Fees don't change until you approve the switch-over. |
| `console.zones_progress` | {n} من {total} محطوطة | {n} of {total} placed |
| `console.zones_state_draft` | تخمين | AI guess |
| `console.zones_state_placed` | محطوطة | Placed |
| `console.zones_state_confirmed` | مأكّدة | Confirmed |
| `console.zones_pick` | اختار منطقة من القائمة أو من الخريطة حتى تعدّل حدودها | Pick a zone from the list or the map to edit its outline |
| `console.zones_help` | اسحب النقاط حتى تعدّل الحدود، دوس + حتى تضيف نقطة، واسحب الدائرة الوسطية حتى تحرّك المنطقة كلها. | Drag the corners to adjust, click + to add a corner, drag the centre circle to move the whole zone. |
| `console.zones_remove_point` | شيل النقطة | Remove corner |
| `console.zones_undo` | تراجع | Undo |
| `console.zones_reset` | رجّع | Reset |
| `console.zones_save` | احفظ الحدود | Save outline |
| `console.zones_saved_toast` | انحفظت حدود {name} | {name} outline saved |
| `console.zones_unsaved` | فيه تعديلات ما انحفظت | Unsaved changes |
| `console.zones_discard` | عندك تعديلات ما انحفظت على {name}. تتركها؟ | You have unsaved changes to {name}. Discard them? |
| `console.zones_read_only` | للقراءة بس | Read only |
| `console.zones_area` | {area} كم² | {area} km² |
| `console.zones_placed_by` | حطّها {name} | Placed by {name} |

- [ ] **Step 2: Nav** — `nav.ts`: add `| 'zones'` to `IconName`; `import { ZONE_READ_ROLES } from '@driver/contracts';`; in the `console.navg_system` group, before `/system`:
```ts
      { href: '/zones', key: 'console.nav_zones', icon: 'zones', roles: ZONE_READ_ROLES, jump: 'z' },
```
`sidebar.tsx`: `zones: IconZones,` in `NAV_ICONS` (import it from `../ui`). `icons.tsx`:
```tsx
export const IconZones = make(
  <>
    <path d="M4 6.5 9 3l6.5 2.5L17 11l-4 5.5-7-1L3 11z" />
    <circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
  </>,
);
```

- [ ] **Step 3: Map colour** — `packages/map/src/colors.ts`: `danger: '#e07a66',` in `MAP_COLORS` and `danger: '#c2412d',` in `MAP_COLORS_LIGHT` (brand Danger token).

- [ ] **Step 4: Verify** — `pnpm --filter @driver/i18n test && pnpm --filter @driver/console exec vitest run src/lib/hotkeys.test.ts && pnpm --filter @driver/map test` → pass.
- [ ] **Step 5: Commit** — `git commit -m "Console: Zones nav item, icon and copy"`

### Task 12: The page and its map

**Files:** Create `apps/console/src/app/zones/page.tsx`, `apps/console/src/components/zones-page.tsx`, `apps/console/src/components/zones-map-canvas.tsx`

- [ ] **Step 1: Route** — `apps/console/src/app/zones/page.tsx`
```tsx
import { ZonesPage } from '@/components/zones-page';

export default function Page() {
  return <ZonesPage />;
}
```

- [ ] **Step 2: Page** — `zones-page.tsx`: `ZonesPage` (session, roles, query, mutation, reducer, unsaved guard) renders `ZonesBoard` (pure props → list grouped by tier with state chips and progress, toolbar with help / problem / unsaved status, Undo, Reset, Remove corner, Save) and the dynamically imported `ZonesMapCanvas` (`ssr: false`). Validation: `zoneShapeProblem(editor.ring, editor.centre, zoneServiceBounds(CITY_ID)!, othersPlaced)` with `zoneProblemText`. Save → `trpc.ops.zones.place` → invalidate `ops.zones.list`, toast `console.zones_saved_toast`, re-open the editor on the saved outline. Read-only roles see the outlines and a `console.zones_read_only` chip; no handles, no buttons. Full code in the commit.

- [ ] **Step 3: Map** — `zones-map-canvas.tsx` (`'use client'`): MapLibre with `buildMapStyle({ theme, zoneShading: 'sequential' })`, the style's seed zone layers hidden; sources `zone-edit-others` (all other zones; draft dashed, drawn solid; click picks a zone) and `zone-edit-current` (accent fill/line, `danger` when invalid); HTML name labels; when editable: draggable corner markers (`begin` on dragstart, `moveVertex` on drag, `select` on click), "+" midpoint markers (`insertVertex`), draggable centre marker (`begin`, `moveShape`). Markers rebuild only when the zone, corner count or edit rights change; positions follow `setLngLat`. Camera fits the zone when it opens.

- [ ] **Step 4: Smoke test** — `zones-page.smoke.test.tsx` renders `ZonesBoard` with two sample zones (one draft, one placed) and asserts the progress text "1 من 2 محطوطة", both names, and the state chips.

- [ ] **Step 5: Verify and look** — `pnpm typecheck && pnpm lint && pnpm test`; rebuild the API, restart the studio, sign in as 0770 000 0001, open `/zones`, drag a corner, save, restart the studio and confirm the outline is still there; screenshots at 1440×900 in light and dark.
- [ ] **Step 6: Commit** — `git commit -m "Console: Zones page — draw and save zone outlines"`

---

## Self-review

- Spec §5.3 f4 coverage: tool page ✓, statuses draft/placed/confirmed ✓ (confirmed is set by SP3b driver confirmations), audit ✓, overlap check ✓ (tolerant of shared borders), roles admin + field ops ✓, tier edits deliberately excluded (money rule; SP3b) ✓, seed never overwrites drawn outlines ✓, demo persistence so Ali's work survives ✓. Runtime resolver switch and driver confirmations are SP3b (separate plan).
- Names used consistently: `ZonePlacementView`, `PlaceZoneInput`, `ZonesPort.place/list`, `ZONES_REPOSITORY`, `savePlacement`, `editorReducer`, `closedEditor`, `zoneShapeProblem`, `zoneProblemText`.
- Task 12 page/map code is written during execution (UI glue over the tested reducer and procedures); behaviour is fully specified above and checked by the smoke test and screenshots.
