import { DisputeKind, type MerchantDispute, type MerchantInsights, type Order } from '@driver/contracts';
import { localDow, localHour } from '../../shared/local-time.js';

const MIN_MS = 60_000;
/** "جاهز" within this of the promised time still counts as on time. */
export const PREP_ON_TIME_GRACE_MIN = 2;
const REVIEWS_PER_ITEM = 5;
const BEST_SELLERS = 8;
const WEEK_MS = 7 * 86_400_000;
/** States in which the kitchen never took the order: they don't count as sold. */
const NOT_SOLD: ReadonlySet<string> = new Set(['placed', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled']);

const offeredToKitchen = (o: Order) => Boolean(o.merchantOfferedAt || o.acceptedAt || o.state === 'merchant_rejected');

/** Rejection rate in 7-day buckets ending at `to`, oldest first (the oldest may be shorter). */
export function rejectionTrend(orders: readonly Order[], from: Date, to: Date): MerchantInsights['rejection']['trend'] {
  const buckets = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / WEEK_MS));
  const out = Array.from({ length: buckets }, (_, i) => {
    const end = to.getTime() - (buckets - 1 - i) * WEEK_MS;
    return { from: new Date(Math.max(from.getTime(), end - WEEK_MS)), to: new Date(end), offered: 0, rejected: 0, rate: null as number | null };
  });
  for (const o of orders) {
    if (!offeredToKitchen(o)) continue;
    const b = out.find((x) => o.placedAt >= x.from && o.placedAt < x.to) ?? (o.placedAt.getTime() >= to.getTime() ? out.at(-1) : undefined);
    if (!b) continue;
    b.offered += 1;
    if (o.state === 'merchant_rejected') b.rejected += 1;
  }
  for (const b of out) b.rate = b.offered > 0 ? Math.round((b.rejected / b.offered) * 1000) / 1000 : null;
  return out;
}

/** Insights (merchant app): prep-time honesty, rejection rate, item ratings with review text, peak hours. */
export function composeInsights(input: { merchantOrgId: string; from: Date; to: Date; orders: readonly Order[]; itemNames: ReadonlyMap<string, string> }): MerchantInsights {
  let samples = 0;
  let quoted = 0;
  let actual = 0;
  let onTime = 0;
  let offered = 0;
  let rejected = 0;
  const peak = Array.from({ length: 24 }, () => 0);
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const sold = new Map<string, { qty: number; orders: number; salesIqd: number }>();
  const items = new Map<string, { sum: number; count: number; reviews: Array<{ score: number; note: string; at: Date }> }>();
  for (const o of input.orders) {
    peak[localHour(o.placedAt)]! += 1;
    grid[localDow(o.placedAt)]![localHour(o.placedAt)]! += 1;
    if (!NOT_SOLD.has(o.state)) {
      const seen = new Set<string>();
      for (const l of o.lines) {
        if (!l.catalogItemId) continue;
        const it = sold.get(l.catalogItemId) ?? { qty: 0, orders: 0, salesIqd: 0 };
        it.qty += l.qty;
        it.salesIqd += l.qty * (l.unitPriceIqd ?? 0);
        if (!seen.has(l.catalogItemId)) it.orders += 1;
        seen.add(l.catalogItemId);
        sold.set(l.catalogItemId, it);
      }
    }
    if (offeredToKitchen(o)) offered += 1;
    if (o.state === 'merchant_rejected') rejected += 1;
    if (o.acceptedAt && o.promisedReadyAt && o.readyAt) {
      samples += 1;
      quoted += (o.promisedReadyAt.getTime() - o.acceptedAt.getTime()) / MIN_MS;
      actual += (o.readyAt.getTime() - o.acceptedAt.getTime()) / MIN_MS;
      if (o.readyAt.getTime() <= o.promisedReadyAt.getTime() + PREP_ON_TIME_GRACE_MIN * MIN_MS) onTime += 1;
    }
    const food = o.rating?.food;
    if (!food) continue;
    // The food score and its text go to the order's main dish (largest line), not the drinks and
    // sides that rode along — otherwise a pickle inherits every complaint about the liver wrap.
    const main = [...o.lines].filter((l) => l.catalogItemId).sort((a, b) => b.qty * (b.unitPriceIqd ?? 0) - a.qty * (a.unitPriceIqd ?? 0))[0];
    for (const itemId of main?.catalogItemId ? [main.catalogItemId] : []) {
      const it = items.get(itemId) ?? { sum: 0, count: 0, reviews: [] };
      it.sum += food;
      it.count += 1;
      if (o.rating?.note) it.reviews.push({ score: food, note: o.rating.note, at: o.rating.ratedAt });
      items.set(itemId, it);
    }
  }
  return {
    merchantOrgId: input.merchantOrgId,
    from: input.from,
    to: input.to,
    prepHonesty: {
      samples,
      quotedAvgMin: samples > 0 ? Math.round((quoted / samples) * 10) / 10 : null,
      actualAvgMin: samples > 0 ? Math.round((actual / samples) * 10) / 10 : null,
      onTimeShare: samples > 0 ? Math.round((onTime / samples) * 1000) / 1000 : null,
    },
    rejection: { offered, rejected, rate: offered > 0 ? Math.round((rejected / offered) * 1000) / 1000 : null, trend: rejectionTrend(input.orders, input.from, input.to) },
    itemRatings: [...items.entries()]
      .map(([itemId, it]) => ({
        itemId,
        nameAr: input.itemNames.get(itemId) ?? null,
        avg: Math.round((it.sum / it.count) * 10) / 10,
        count: it.count,
        reviews: it.reviews.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, REVIEWS_PER_ITEM),
      }))
      .sort((a, b) => a.avg - b.avg || b.count - a.count),
    peakHours: peak,
    peakGrid: grid,
    bestSellers: [...sold.entries()]
      .map(([itemId, it]) => ({ itemId, nameAr: input.itemNames.get(itemId) ?? null, ...it }))
      // By what they brought in, so a 750-dinar Pepsi that rides along doesn't top the grill.
      .sort((a, b) => b.salesIqd - a.salesIqd || b.qty - a.qty || a.itemId.localeCompare(b.itemId))
      .slice(0, BEST_SELLERS),
    orders: input.orders.length,
  };
}

/**
 * The staff cut of insights (backend review 2026-10-04 #10): every owner-only figure stripped —
 * per-item sales money is null and best sellers are ranked by quantity, so the order does not leak
 * it either. Prep honesty, rejections, ratings, peaks and order counts are the kitchen's to see.
 */
export function staffInsights(i: MerchantInsights): MerchantInsights {
  return {
    ...i,
    bestSellers: i.bestSellers
      .map((b) => ({ ...b, salesIqd: null }))
      .sort((a, b) => b.qty - a.qty || b.orders - a.orders || a.itemId.localeCompare(b.itemId)),
  };
}

/** Domain §9 dispute table, as it lands on the merchant. */
export function defaultOutcome(kind: string, order: Order): MerchantDispute['defaultOutcome'] {
  switch (kind) {
    case 'cold_or_late':
      return { code: 'delivery_fee_credit', text_ar: 'أجرة التوصيل ترجع للزبون رصيد، والتأخير يتحسب على اللي سبّبه (التحضير لو التوصيل)', merchantImpactIqd: 0 };
    case 'missing_item':
      return { code: 'merchant_refunds_item', text_ar: 'المطعم يرجّع سعر المادة الناقصة من حسابه', merchantImpactIqd: 0 };
    case 'wrong_item':
      return { code: 'merchant_redelivers', text_ar: 'المطعم يرجّع المادة الغلط ويوصّل الصحيحة خلال 30 دقيقة على حسابه', merchantImpactIqd: order.deliveryFeeIqd };
    case 'not_delivered':
    case 'courier_cancelled_after_pickup':
      return { code: 'courier_liable', text_ar: 'الدليفري يتحمّل حسب أدلة التسليم (الصورة والموقع)', merchantImpactIqd: 0 };
    case 'unreachable':
      return { code: 'support_review', text_ar: 'الزبون ما رد بعد بروتوكول الاتصال: الزبون يتحمّل الكلفة', merchantImpactIqd: 0 };
    default:
      return { code: 'support_review', text_ar: 'الدعم يراجع ويقرر', merchantImpactIqd: 0 };
  }
}

/** Kinds outside the customer-facing enum (system-opened disputes) read as `other`. */
export function disputeKindOf(raw: string): DisputeKind {
  const parsed = DisputeKind.safeParse(raw);
  return parsed.success ? parsed.data : 'other';
}
