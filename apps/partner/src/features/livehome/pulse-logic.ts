import { AZIZIYAH_ZONES } from '@driver/contracts';
import type { PartnerMyDay, PartnerTownPulse } from '@driver/contracts/town-pulse';
import type { LngLat } from '@/features/map/geo';

/**
 * «المدينة حيّة» (live map home): what changed between two pictures of the town, kept pure so it
 * runs in plain Node tests. Nothing here invents activity: a ripple only rises where the server's
 * area count went up, a kitchen only "pops" when it turned ready.
 */

/** A ripple: one area got new orders. `key` is unique per rise so the same area can ripple again. */
export interface Ripple {
  key: string;
  zoneId: string;
  at: LngLat;
}

/** The first picture after he opens home ripples at most this many areas (the busiest), so it isn't a fireworks show. */
export const FIRST_RIPPLES = 3;
/** A ripple shows this long, then fades (the picture is 20 s, so one rise per area per picture). */
export const RIPPLE_MS = 4_000;
/** Ripples in one area sit up to this far from the area's middle, so the same area doesn't stack on one spot. */
const RIPPLE_SPREAD_DEG = 0.0012;

const CENTRES = new Map(AZIZIYAH_ZONES.map((z) => [z.id, { lat: z.lat, lng: z.lng }]));

/** FNV-1a: the same string always gives the same number (no Math.random, so screenshots and tests repeat). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Where a ripple of `zoneId` rises the `seq`-th time: the area's middle, nudged by a fixed amount. Never a house. */
export function rippleSpot(zoneId: string, seq: number): LngLat | null {
  const c = CENTRES.get(zoneId);
  if (!c) return null;
  const h = hash(`${zoneId}:${seq}`);
  const angle = ((h & 0xffff) / 0xffff) * Math.PI * 2;
  const r = (((h >>> 16) & 0xff) / 0xff) * RIPPLE_SPREAD_DEG;
  return { lat: c.lat + Math.sin(angle) * r, lng: c.lng + Math.cos(angle) * r };
}

/**
 * The ripples a new picture brings: every area whose count rose (or that newly lit). The first picture
 * (`prev` null) ripples only the busiest few, once.
 */
export function newRipples(prev: PartnerTownPulse['areas'] | null, next: PartnerTownPulse['areas'], pictureAt: number): Ripple[] {
  const before = new Map((prev ?? []).map((a) => [a.zoneId, a.n]));
  const risen = prev === null ? next.slice(0, FIRST_RIPPLES) : next.filter((a) => a.n > (before.get(a.zoneId) ?? 0));
  return risen.flatMap((a) => {
    const at = rippleSpot(a.zoneId, pictureAt);
    return at ? [{ key: `${a.zoneId}:${pictureAt}`, zoneId: a.zoneId, at }] : [];
  });
}

/** Kitchens that just turned «جاهز» (they get one soft pop). The first picture pops nothing. */
export function justReady(prev: PartnerTownPulse['kitchens'] | null, next: PartnerTownPulse['kitchens']): Set<string> {
  if (prev === null) return new Set();
  const was = new Map(prev.map((k) => [k.id, k.state]));
  return new Set(next.filter((k) => k.state === 'ready' && was.get(k.id) !== 'ready').map((k) => k.id));
}

/** One stop of «يومي»: a bag where he picked up, a money chip where he delivered, joined by a straight line. */
export interface DayStop {
  tripId: string;
  pickup: LngLat | null;
  dropoff: LngLat | null;
  earnedIqd: number;
}

/** His day in order (oldest first), only jobs with somewhere to draw; the line joins each pickup to its door. */
export function dayStops(day: PartnerMyDay | undefined): DayStop[] {
  if (!day) return [];
  return [...day.jobs]
    .sort((a, b) => a.doneAt.getTime() - b.doneAt.getTime())
    .filter((j) => j.pickup || j.dropoff)
    .map((j) => ({
      tripId: j.tripId,
      pickup: j.pickup,
      dropoff: j.dropoff,
      earnedIqd: j.earnedIqd,
    }));
}

/** Every point «يومي» draws, for the camera to frame his whole day. */
export function dayPoints(stops: readonly DayStop[]): LngLat[] {
  return stops.flatMap((s) => [s.pickup, s.dropoff].filter((p): p is LngLat => p !== null));
}

/** Two money chips closer than this (about 400 m) would sit on each other at the home's zoom. */
const COIN_CLASH_DEG = 0.004;

/** Which side of its door each money chip sits: one that would cover an earlier chip flips under its door. */
export function coinSides(stops: readonly DayStop[]): Array<'above' | 'below'> {
  const above: LngLat[] = [];
  return stops.map((s) => {
    const d = s.dropoff;
    if (!d) return 'above';
    const clash = above.some((p) => Math.abs(p.lat - d.lat) < COIN_CLASH_DEG && Math.abs(p.lng - d.lng) < COIN_CLASH_DEG * 2);
    if (clash) return 'below';
    above.push(d);
    return 'above';
  });
}

/** The live map's zoom range: far enough to see a few kitchens, never so far the houses turn pale and flat (the Golden style thins them under ~15.7). */
export const LIVE_ZOOM_MAX = 16.3;
export const LIVE_ZOOM_MIN = 15.8;

/**
 * How close the home opens: near enough to see the nearest two kitchens cooking around him (within
 * about 1.2 km), the closest view when there are none. `halfWidthPx` is half the map's width.
 */
export function framingZoom(self: LngLat, kitchens: readonly { at: LngLat }[], halfWidthPx = 195): number {
  const metres = (a: LngLat) => Math.hypot((a.lng - self.lng) * 93_400, (a.lat - self.lat) * 110_540);
  const near = kitchens
    .map((k) => metres(k.at))
    .filter((d) => d <= 1_200)
    .sort((a, b) => a - b)
    .slice(0, 2);
  const far = near[near.length - 1];
  if (!far) return LIVE_ZOOM_MAX;
  // Metres per pixel at zoom z here: 131,300 / 2^z; keep the farther of them inside 80 % of the half-width.
  const z = Math.log2((0.8 * halfWidthPx * 131_300) / far);
  return Math.round(Math.min(LIVE_ZOOM_MAX, Math.max(LIVE_ZOOM_MIN, z)) * 10) / 10;
}
