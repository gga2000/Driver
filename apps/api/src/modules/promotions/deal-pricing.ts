import { dealLabel, percentDealSaving, type DealBadge, type DealSchedule } from '@driver/contracts';
import { localDow, localMinutes } from '../../shared/local-time.js';
import type { DealRecord } from './promotions.repository.js';

/**
 * Merchant deals at checkout (domain §11), pure. The API evaluates every live deal of the merchant
 * against the basket and applies the single best one (no stacking: best for the customer wins).
 * Values: percent and fixed come off the covered lines (modifiers included); BOGO makes every second
 * covered unit free at its menu price (the cheaper of each pair); free delivery takes the whole
 * delivery fee. Schedule days and hours are local (Baghdad, the clock port's instant).
 */

function hhmm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Inside the deal's local hour window (end before start wraps past midnight); no window = all day. */
export function inDealHours(at: Date, hours: DealSchedule['hours']): boolean {
  if (!hours) return true;
  const m = localMinutes(at);
  const start = hhmm(hours.start);
  const end = hhmm(hours.end);
  return start <= end ? m >= start && m < end : m >= start || m < end;
}

/** Approved, switched on, within [startsAt, endsAt), on one of its local days and hours. Budget is checked per amount. */
export function dealIsLive(d: DealRecord, at: Date): boolean {
  if (d.proposalState !== 'approved' || !d.active) return false;
  const t = at.getTime();
  if (t < d.schedule.startsAt.getTime() || t >= d.schedule.endsAt.getTime()) return false;
  if (d.schedule.days.length > 0 && !d.schedule.days.includes(localDow(at))) return false;
  return inDealHours(at, d.schedule.hours);
}

/** Budget left on the deal (null = uncapped). */
export function budgetLeft(d: Pick<DealRecord, 'budgetCapIqd' | 'spentIqd'>): number | null {
  return d.budgetCapIqd === null ? null : Math.max(0, d.budgetCapIqd - d.spentIqd);
}

export interface BasketLine {
  catalogItemId: string | null;
  qty: number;
  /** The dish's menu price, without modifiers (what a free BOGO unit is worth). */
  unitPriceIqd: number;
  /** qty × (menu price + modifiers): what the line costs. */
  lineIqd: number;
}

export interface Basket {
  lines: readonly BasketLine[];
  itemsTotalIqd: number;
  deliveryFeeIqd: number;
}

export interface DealOutcome {
  dealId: string;
  type: DealRecord['type'];
  target: 'items' | 'delivery';
  /** Before total rounding; > 0. */
  amountIqd: number;
  /** Per basket line (same order), summing to `amountIqd` for item deals; zeros for free delivery. */
  lineSavingsIqd: number[];
  label_ar: string;
  label_en: string;
}

/** Splits `total` across `weights` so the parts sum exactly to it (largest remainder). */
export function allocateIqd(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

/** What one deal takes off this basket, or null when it does not apply (minimum, nothing covered, budget). */
export function evaluateDeal(d: DealRecord, basket: Basket): DealOutcome | null {
  if (basket.itemsTotalIqd < d.minOrderIqd) return null;
  const labels = { label_ar: dealLabel(d, 'ar-IQ'), label_en: dealLabel(d, 'en') };
  const zeros = basket.lines.map(() => 0);
  let out: DealOutcome | null = null;
  if (d.type === 'free_delivery') {
    if (basket.deliveryFeeIqd > 0) out = { dealId: d.id, type: d.type, target: 'delivery', amountIqd: basket.deliveryFeeIqd, lineSavingsIqd: zeros, ...labels };
  } else {
    const items = new Set(d.itemIds);
    // Menu dishes only: free-text requests ("خبز زيادة") are not on the menu and cost nothing.
    const covered = basket.lines.map((l) => l.catalogItemId !== null && (items.size === 0 || items.has(l.catalogItemId)));
    const coveredIqd = basket.lines.reduce((s, l, i) => s + (covered[i] ? l.lineIqd : 0), 0);
    let savings = zeros;
    if (coveredIqd > 0 && d.type === 'percent') {
      savings = basket.lines.map((l, i) => (covered[i] ? percentDealSaving(l.lineIqd, d.value) : 0));
    } else if (coveredIqd > 0 && d.type === 'fixed') {
      savings = allocateIqd(Math.min(d.value, coveredIqd), basket.lines.map((l, i) => (covered[i] ? l.lineIqd : 0)));
    } else if (d.type === 'bogo') {
      // Every covered unit, dearest first; every second one is free at its menu price.
      const units = basket.lines.flatMap((l, i) => (covered[i] ? Array.from({ length: l.qty }, () => ({ i, price: l.unitPriceIqd })) : []));
      units.sort((a, b) => b.price - a.price || a.i - b.i);
      savings = [...zeros];
      units.forEach((u, k) => {
        if (k % 2 === 1) savings[u.i] = (savings[u.i] ?? 0) + u.price;
      });
    }
    const amountIqd = savings.reduce((a, b) => a + b, 0);
    if (amountIqd > 0) out = { dealId: d.id, type: d.type, target: 'items', amountIqd, lineSavingsIqd: savings, ...labels };
  }
  if (!out) return null;
  const left = budgetLeft(d);
  // A deal never spends past its cap: one that cannot pay the whole discount is out for this order.
  return left !== null && out.amountIqd > left ? null : out;
}

/** The single best deal for the customer: largest saving; ties go to the older deal. */
export function bestDeal(deals: readonly DealRecord[], basket: Basket, at: Date): DealOutcome | null {
  const live = deals.filter((d) => dealIsLive(d, at)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  let best: DealOutcome | null = null;
  for (const d of live) {
    const o = evaluateDeal(d, basket);
    if (o && (!best || o.amountIqd > best.amountIqd)) best = o;
  }
  return best;
}

/** The cheapest unmet minimum among live deals the basket could still unlock (cart nudge). */
export function nextDeal(deals: readonly DealRecord[], basket: Basket, at: Date): { deal: DealRecord; missingIqd: number } | null {
  let next: { deal: DealRecord; missingIqd: number } | null = null;
  for (const d of deals) {
    if (!dealIsLive(d, at) || d.minOrderIqd <= basket.itemsTotalIqd || budgetLeft(d) === 0) continue;
    const missing = d.minOrderIqd - basket.itemsTotalIqd;
    if (!next || missing < next.missingIqd) next = { deal: d, missingIqd: missing };
  }
  return next;
}

/** The customer-facing badge of a live deal with budget left; null otherwise. */
export function dealBadge(d: DealRecord, at: Date): DealBadge | null {
  if (!dealIsLive(d, at) || budgetLeft(d) === 0) return null;
  return {
    dealId: d.id,
    type: d.type,
    value: d.value,
    minOrderIqd: d.minOrderIqd,
    itemIds: [...d.itemIds],
    label_ar: dealLabel(d, 'ar-IQ'),
    label_en: dealLabel(d, 'en'),
    endsAt: d.schedule.endsAt,
  };
}
