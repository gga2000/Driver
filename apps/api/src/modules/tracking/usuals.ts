import { USUAL_RULES, usualBandOf, type Order, type UsualBand } from '@driver/contracts';
import { localDow, localHour, localMinutes } from '../../shared/local-time.js';

/**
 * «طلبك المعتاد؟» (joy s3, delight G3) as plain data: from one person's own orders, the ones they keep
 * coming back to. Two orders are "the same" when they are from the same kitchen and share at least
 * `USUAL_RULES.sameShare` of their dishes (counted over the larger order). A weekday usual is the same
 * order on one weekday and time band at least `minSameWeekday` times; a band usual is the same order in
 * one band at least `minSameBand` times on any days; both within `windowDays`. Only food orders the
 * person placed and received count. Pure: the clock is passed in.
 */

const DAY_MS = 86_400_000;
/** Shifting minutes by the start of the morning band makes every band one unbroken stretch (late = 19:00–24:00 shifted). */
const BAND_SHIFT_MIN = 4 * 60;
const SLOT_MIN = 30;

export interface FoundUsual {
  kind: 'weekday' | 'band';
  weekday: number | null;
  band: UsualBand;
  times: number;
  /** Usual minute of the Baghdad day (rounded to 30). */
  atMinute: number;
  /** The newest matching order: the one the home offers again. */
  orderId: string;
}

type UsualOrder = Pick<Order, 'id' | 'type' | 'state' | 'ordererId' | 'merchantOrgId' | 'placedAt' | 'scheduledFor' | 'deliveredAt' | 'lines'>;

/** Reached the person and stayed theirs (a refund or an open dispute is not a habit). */
function received(o: UsualOrder): boolean {
  return o.deliveredAt !== null && (o.state === 'delivered' || o.state === 'closed' || o.state === 'completed');
}

/** When the person wanted it: the scheduled time when there was one. */
function wantedAt(o: UsualOrder): Date {
  return o.scheduledFor ?? o.placedAt;
}

function dishesOf(o: UsualOrder): Set<string> {
  return new Set(o.lines.filter((l) => l.availability !== 'removed' && l.catalogItemId).map((l) => l.catalogItemId!));
}

/** Same kitchen and at least `sameShare` of the dishes in common, over the larger order. */
export function sameOrder(a: { merchantOrgId: string | null; dishes: ReadonlySet<string> }, b: { merchantOrgId: string | null; dishes: ReadonlySet<string> }): boolean {
  if (!a.merchantOrgId || a.merchantOrgId !== b.merchantOrgId) return false;
  const larger = Math.max(a.dishes.size, b.dishes.size);
  if (larger === 0) return false;
  let common = 0;
  for (const d of a.dishes) if (b.dishes.has(d)) common += 1;
  return common / larger >= USUAL_RULES.sameShare;
}

/** The members' usual minute of day, averaged inside their band and rounded to the half hour. */
function usualMinute(at: readonly Date[]): number {
  const shifted = at.map((d) => (localMinutes(d) - BAND_SHIFT_MIN + 1440) % 1440);
  const mean = shifted.reduce((s, m) => s + m, 0) / shifted.length;
  const rounded = Math.round(mean / SLOT_MIN) * SLOT_MIN;
  return (rounded + BAND_SHIFT_MIN) % 1440;
}

export function findUsuals(orders: readonly UsualOrder[], personId: string, now: Date): FoundUsual[] {
  const since = now.getTime() - USUAL_RULES.windowDays * DAY_MS;
  const pool = orders
    .filter((o) => o.ordererId === personId && o.type === 'food' && o.merchantOrgId !== null && received(o) && o.placedAt.getTime() >= since && o.placedAt.getTime() <= now.getTime())
    .map((o) => {
      const at = wantedAt(o);
      return { id: o.id, merchantOrgId: o.merchantOrgId, dishes: dishesOf(o), at, placedAt: o.placedAt, dow: localDow(at), band: usualBandOf(localHour(at)) };
    })
    .filter((o) => o.dishes.size > 0)
    .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime());

  const used = new Set<string>();
  const found: Array<FoundUsual & { newest: number }> = [];
  for (const anchor of pool) {
    if (used.has(anchor.id)) continue;
    const similar = pool.filter((o) => !used.has(o.id) && sameOrder(anchor, o));
    const sameDay = similar.filter((o) => o.dow === anchor.dow && o.band === anchor.band);
    const sameBand = similar.filter((o) => o.band === anchor.band);
    let members: typeof pool;
    let kind: FoundUsual['kind'];
    if (sameDay.length >= USUAL_RULES.minSameWeekday) [members, kind] = [sameDay, 'weekday'];
    else if (sameBand.length >= USUAL_RULES.minSameBand) [members, kind] = [sameBand, 'band'];
    else continue;
    for (const m of members) used.add(m.id);
    found.push({ kind, weekday: kind === 'weekday' ? anchor.dow : null, band: anchor.band, times: members.length, atMinute: usualMinute(members.map((m) => m.at)), orderId: anchor.id, newest: anchor.placedAt.getTime() });
  }
  return found
    .sort((a, b) => Number(b.kind === 'weekday') - Number(a.kind === 'weekday') || b.times - a.times || b.newest - a.newest)
    .slice(0, USUAL_RULES.max)
    .map(({ newest: _newest, ...u }) => u);
}
