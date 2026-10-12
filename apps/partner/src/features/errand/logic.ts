import type { PartnerJob, PartnerJobStop, PartnerShopItem, PartnerShopList } from '@driver/contracts';

/** The errand pickup whose list shows now: the current stop when it carries one, else the first still to do. */
export function listStop(job: PartnerJob): (PartnerJobStop & { shopList: PartnerShopList }) | null {
  const withList = job.stops.filter((s): s is PartnerJobStop & { shopList: PartnerShopList } => Boolean(s.shopList) && s.state !== 'completed' && s.state !== 'skipped');
  return withList.find((s) => s.stopId === job.currentStopId) ?? withList[0] ?? null;
}

/** Device-local key of a stop's ticks (SecureStore keys allow only letters, digits, `_`, `.` and `-`). */
export function ticksKey(stopId: string): string {
  return `errand.ticks.${stopId.replace(/[^\w.-]/g, '_')}`;
}

/** Stored ticks back to item indexes; anything unreadable or out of range is dropped. */
export function parseTicks(raw: string | null, count: number): Set<number> {
  if (!raw) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < count) : []);
  } catch {
    return new Set();
  }
}

export function toggleTick(ticks: ReadonlySet<number>, i: number): Set<number> {
  const next = new Set(ticks);
  if (!next.delete(i)) next.add(i);
  return next;
}

export const UNIT_KEY = { piece: 'partner.errand.unit_piece', box: 'partner.errand.unit_box', kg: 'partner.errand.unit_kg', carton: 'partner.errand.unit_carton' } as const;
export const MISSING_KEY = { call: 'partner.errand.missing_call', similar: 'partner.errand.missing_similar', skip: 'partner.errand.missing_skip' } as const;

/** Where to buy it, in his words: the app shop's or the known shop's name, else «أقرب محل». */
export function whereKey(item: PartnerShopItem): { key: 'partner.errand.where_shop' | 'partner.errand.where_near'; name: string | null } {
  return item.where.name ? { key: 'partner.errand.where_shop', name: item.where.name } : { key: 'partner.errand.where_near', name: null };
}
