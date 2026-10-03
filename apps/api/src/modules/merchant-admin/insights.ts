import { DisputeKind, type MerchantDispute, type MerchantInsights, type Order } from '@driver/contracts';
import { localHour } from '../../shared/local-time.js';

const MIN_MS = 60_000;
/** "جاهز" within this of the promised time still counts as on time. */
export const PREP_ON_TIME_GRACE_MIN = 2;
const REVIEWS_PER_ITEM = 5;

/** Insights (merchant app): prep-time honesty, rejection rate, item ratings with review text, peak hours. */
export function composeInsights(input: { merchantOrgId: string; from: Date; to: Date; orders: readonly Order[]; itemNames: ReadonlyMap<string, string> }): MerchantInsights {
  let samples = 0;
  let quoted = 0;
  let actual = 0;
  let onTime = 0;
  let offered = 0;
  let rejected = 0;
  const peak = Array.from({ length: 24 }, () => 0);
  const items = new Map<string, { sum: number; count: number; reviews: Array<{ score: number; note: string; at: Date }> }>();
  for (const o of input.orders) {
    peak[localHour(o.placedAt)]! += 1;
    if (o.merchantOfferedAt || o.acceptedAt || o.state === 'merchant_rejected') offered += 1;
    if (o.state === 'merchant_rejected') rejected += 1;
    if (o.acceptedAt && o.promisedReadyAt && o.readyAt) {
      samples += 1;
      quoted += (o.promisedReadyAt.getTime() - o.acceptedAt.getTime()) / MIN_MS;
      actual += (o.readyAt.getTime() - o.acceptedAt.getTime()) / MIN_MS;
      if (o.readyAt.getTime() <= o.promisedReadyAt.getTime() + PREP_ON_TIME_GRACE_MIN * MIN_MS) onTime += 1;
    }
    const food = o.rating?.food;
    if (!food) continue;
    for (const itemId of new Set(o.lines.map((l) => l.catalogItemId).filter((x): x is string => Boolean(x)))) {
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
    rejection: { offered, rejected, rate: offered > 0 ? Math.round((rejected / offered) * 1000) / 1000 : null },
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
      return { code: 'merchant_redelivers', text_ar: 'المطعم يرجّع المادة الغلط ويوصّل الصحيحة خلال ٣٠ دقيقة على حسابه', merchantImpactIqd: order.deliveryFeeIqd };
    case 'not_delivered':
    case 'courier_cancelled_after_pickup':
      return { code: 'courier_liable', text_ar: 'المندوب يتحمّل حسب أدلة التسليم (الصورة والموقع)', merchantImpactIqd: 0 };
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
