import { AZIZIYAH_ZONES, type PartnerCash, type PartnerDemand } from '@driver/contracts';

/**
 * «الدشبول» home (partner redesign, ideas h1–h11), pure: which state top he sees, how loud the cash
 * line is, which "needs you" card leads, and the one work hint. Plain Node (unit-tested).
 */

/** h3: working = saffron top, waiting = cream, no internet = ink. */
export type DashState = 'working' | 'waiting' | 'cut';

export function dashState(online: boolean, netOk: boolean): DashState {
  if (!netOk) return 'cut';
  return online ? 'working' : 'waiting';
}

/**
 * h7 + bug b10: the cash line is one quiet sentence until the cap warning (the server's `nearCap`,
 * the same 70 % the earnings meter uses), a saffron card after that, red only when offers stopped.
 * Nothing at all when he owes nothing (the locked home no longer says «0 دينار من 75,000»).
 */
export type CashLoudness = 'none' | 'quiet' | 'near' | 'blocked';

export function cashLoudness(cash: PartnerCash): CashLoudness {
  if (cash.overCap) return 'blocked';
  if (cash.owedIqd <= 0 && cash.heldIqd <= 0) return 'none';
  return cash.nearCap ? 'near' : 'quiet';
}

/** h9: the things that may need him on home, most urgent first. */
export type AttentionKind = 'job' | 'gate' | 'cash' | 'invite' | 'lost' | 'climate' | 'zone';

const ATTENTION_ORDER: readonly AttentionKind[] = ['job', 'gate', 'cash', 'lost', 'invite', 'climate', 'zone'];

/** Sorts what applies by urgency: the first is shown, the rest fold into «+2 بعد». */
export function attentionOrder(present: readonly AttentionKind[]): AttentionKind[] {
  return ATTENTION_ORDER.filter((k) => present.includes(k));
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle metres between two points (good to a few metres inside a town). */
export function metresBetween(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface WorkHint {
  zoneId: string;
  /** Where to drive to («روح هناك»): the zone's centre. */
  at: LatLng;
  /** Kilometres from him, one decimal; null without a position. */
  km: number | null;
  /** He is already there (under 300 m): no «روح هناك», just "you're in the right place". */
  here: boolean;
  waiting: number;
  drivers: number;
  level: PartnerDemand['level'];
}

/**
 * h4: «الشغل هسة بشارع 30 · 1.2 كم» — the one place worth going, from the server's demand hint.
 * Null when it's quiet or the zone is unknown (no hint is better than a wrong one).
 */
export function workHint(demand: PartnerDemand | null | undefined, self: LatLng | null | undefined): WorkHint | null {
  if (!demand || demand.level === 'quiet' || !demand.zoneId) return null;
  const zone = AZIZIYAH_ZONES.find((z) => z.id === demand.zoneId);
  if (!zone) return null;
  const at = { lat: zone.lat, lng: zone.lng };
  const m = self ? metresBetween(self, at) : null;
  return {
    zoneId: zone.id,
    at,
    km: m == null ? null : Math.round(m / 100) / 10,
    here: m != null && m < Math.max(300, zone.radiusM),
    waiting: demand.waitingJobs,
    drivers: demand.driversNearby,
    level: demand.level,
  };
}

/** Minutes since he went online (working top: «من 12 دقيقة»); 0 for anything in the future. */
export function minutesSince(since: Date | null | undefined, now: number): number | null {
  if (!since) return null;
  return Math.max(0, Math.floor((now - since.getTime()) / 60_000));
}

/** h10: «هلا حيدر» — the first word of his name; null when we have none. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

/** h5: the map peek returns to the dashboard by itself after this long. */
export const MAP_PEEK_MS = 20_000;

/** h8: the start-of-shift check shows once per calendar day (Baghdad time), before the first slide. */
export function shiftCheckDay(now: Date): string {
  // Baghdad is UTC+3 all year (no daylight saving since 2008).
  const b = new Date(now.getTime() + 3 * 3_600_000);
  return `${b.getUTCFullYear()}-${String(b.getUTCMonth() + 1).padStart(2, '0')}-${String(b.getUTCDate()).padStart(2, '0')}`;
}
