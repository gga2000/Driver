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

/** The receipt total as he types it: Western or Arabic-Indic digits, separators ignored; null when empty or 0. */
export function parseReceipt(text: string): number | null {
  const digits = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\D/g, '');
  const n = digits ? Number(digits) : 0;
  return n > 0 && n <= 10_000_000 ? n : null;
}

/** Thousands grouped with commas, Western digits («18,750»). */
export function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Over the customer's list ceiling: he calls the customer first (a confirm, never a block). */
export function overCeiling(amount: number | null, listMaxIqd: number | null): boolean {
  return amount !== null && listMaxIqd !== null && amount > listMaxIqd;
}

/** Device-local key of what he recorded at this stop (shown again after a restart). */
export function receiptKey(stopId: string): string {
  return `errand.receipt.${stopId.replace(/[^\w.-]/g, '_')}`;
}
