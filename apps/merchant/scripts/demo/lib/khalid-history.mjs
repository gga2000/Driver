// Five weeks of مطعم خالد's real-looking history, shared by the money and insights demo sections
// (built once, whichever section asks first). Orders go straight into the orders repository with their
// past timestamps, their money into the ledger the way a delivered order posts it, and couriers hand the
// cash over every evening. Deterministic (seeded), anchored to "now".
//
//   ~18 orders a weekday, ~25 on Thursday/Friday nights; lunch 1–3 pm and a big 8–11 pm peak
//   72 % cash · base 12 % (most), featured 15 %, pickup 5 %
//   prep promised 10/15/20/25 min, actually ~3 min over on average (the insights "late" story)
//   rejections fall from ~7 % five weeks ago to ~2 % this week; لفة كبد rates lowest
import { AZIZIYAH_MONEY_RULES } from '@driver/contracts';

const KEY = Symbol.for('driver.demo.khalidHistory');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BAGHDAD = 3 * HOUR;

export const COURIERS = [
  { phone: '07714100001', name: 'علي رزاق' },
  { phone: '07714100002', name: 'سجاد ناصر' },
  { phone: '07714100003', name: 'أمير جبار' },
  { phone: '07714100004', name: 'حسن فلاح' },
  { phone: '07714100005', name: 'مهدي صالح' },
];

/** Orders per local hour on a normal day (sums to ~18). */
const HOURLY = { 11: 0.6, 12: 1.2, 13: 2.1, 14: 1.7, 15: 0.8, 16: 0.4, 17: 0.5, 18: 0.9, 19: 1.6, 20: 2.6, 21: 3.0, 22: 1.9, 23: 1.0, 0: 0.5, 1: 0.2 };

/** Baskets: [key, qty range, weight]. */
const BASKETS = [
  [[['tikka_wrap', 2, 4], ['pepsi', 1, 2]], 9],
  [[['kebab_wrap', 2, 4], ['shenina', 1, 2]], 8],
  [[['kebab_plate', 1, 2], ['salad', 1, 1], ['pepsi', 1, 2]], 7],
  [[['tikka_plate', 1, 1], ['lentil_soup', 1, 2]], 5],
  [[['khalid_mix', 1, 1], ['pepsi', 2, 3]], 5],
  [[['liver_wrap', 2, 3], ['torshi', 1, 1]], 4],
  [[['chicken_tikka_wrap', 2, 3], ['water', 1, 2]], 5],
  [[['gus_wrap', 2, 3], ['pepsi', 1, 1]], 6],
  [[['gus_plate', 1, 2], ['shenina', 1, 2]], 4],
  [[['grill_mix_kilo', 1, 1], ['torshi', 1, 1], ['pepsi', 3, 4]], 2],
  [[['pacha', 1, 1], ['lentil_soup', 1, 1]], 2],
  [[['lamb_tikka_plate', 1, 1], ['salad', 1, 1]], 2],
];

/** Food rating per item (mean) and what people write. */
const TASTE = {
  liver_wrap: { mean: 3.1, notes: ['الكبد ناشف شوية', 'الكبد بارد وصل', 'زين بس الكبد قليل'] },
  gus_plate: { mean: 3.8, notes: ['الكص طيب بس دهن هواي', 'الكمية قليلة على السعر'] },
  kebab_plate: { mean: 4.2, notes: ['التمن بارد شوية', 'الكباب طيب'] },
  tikka_wrap: { mean: 4.6, notes: ['التكة طرية وطيبة', 'أطيب لفة بالعزيزية'] },
  khalid_mix: { mean: 4.8, notes: ['المشكل يكفي لثلاثة، عاشت إيدكم', 'كلشي حار وطازج'] },
  kebab_wrap: { mean: 4.4, notes: ['الكباب على الفحم ريحته تجنن'] },
  gus_wrap: { mean: 4.3, notes: ['الصمون حار والكص مقرمش'] },
  chicken_tikka_wrap: { mean: 4.5, notes: [] },
  pacha: { mean: 4.0, notes: ['الباجة زينة بس وصلت فاترة'] },
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const localDayStart = (ms) => {
  const s = ms + BAGHDAD;
  return s - (s % DAY) - BAGHDAD;
};

export async function khalidHistory(ctx) {
  if (globalThis[KEY]) return globalThis[KEY];
  globalThis[KEY] = build(ctx);
  return globalThis[KEY];
}

async function build(ctx) {
  const { identity, catalog, ledger } = ctx.services;
  const { khalid } = ctx.stores;
  const { ORDERS_REPOSITORY } = await ctx.load('modules/orders/index.js');
  const { postOrderClosed, postMerchantPaidByCourier, postSettlement } = await ctx.load('modules/ledger/postings.js');
  const { EventsService } = await ctx.load('modules/events/index.js');
  const repo = ctx.app.get(ORDERS_REPOSITORY);
  const events = ctx.app.get(EventsService);
  const rand = rng(20261003);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

  // Couriers with names (first names show on the Money screen).
  const couriers = [];
  for (const c of COURIERS) {
    const id = await identity.ensurePersonByPhone(c.phone, 'system:demo', 'demo');
    await identity.updateProfile({ personId: id, sessionId: 'demo' }, { name: c.name });
    await identity.grantRole({ personId: 'system:demo' }, { personId: id, kind: 'courier' });
    couriers.push({ id, name: c.name });
  }

  const items = new Map();
  for (const [key, id] of khalid.itemIds) {
    const [item] = await catalog.itemsOf(khalid.orgId, [id]);
    if (item) items.set(key, { id, priceIqd: item.priceIqd, prepTimeMin: item.prepTimeMin });
  }
  const totalWeight = BASKETS.reduce((s, b) => s + b[1], 0);
  const basket = () => {
    let r = rand() * totalWeight;
    for (const [lines, w] of BASKETS) {
      r -= w;
      if (r <= 0) return lines;
    }
    return BASKETS[0][0];
  };

  const now = Date.now();
  const startDay = localDayStart(now) - 35 * DAY;
  const orders = [];
  let customer = 0;
  // Settlement points: every evening at (now − 2 h) − k days; cash couriers hand over, Driver pays prepaid.
  const settleAt = (k) => now - 2 * HOUR - k * DAY;

  for (let day = startDay; day < now; day += DAY) {
    const dow = new Date(day + BAGHDAD).getUTCDay();
    const busy = dow === 4 || dow === 5 ? 1.4 : dow === 6 ? 1.1 : 1;
    const weeksAgo = (now - day) / (7 * DAY);
    const rejectP = 0.018 + Math.min(0.06, weeksAgo * 0.012);
    for (const [hourStr, mean] of Object.entries(HOURLY)) {
      const hour = Number(hourStr);
      const base = day + (hour < 5 ? DAY : 0) + hour * HOUR;
      const n = Math.floor(mean * busy + rand());
      for (let i = 0; i < n; i++) {
        const placedAt = base + Math.floor(rand() * HOUR);
        if (placedAt > now - 12 * MIN) continue;
        const lines = [];
        let prep = 0;
        for (const [key, lo, hi] of basket()) {
          const it = items.get(key);
          if (!it) continue;
          const qty = between(lo, hi);
          lines.push({ key, catalogItemId: it.id, freeText: null, qty, unitPriceIqd: it.priceIqd, modifiers: [], note: null, pointsEligible: true, participantRef: null });
          prep = Math.max(prep, it.prepTimeMin);
        }
        if (lines.length === 0) continue;
        const itemsIqd = lines.reduce((s, l) => s + l.qty * l.unitPriceIqd, 0);
        const r = rand();
        const pickup = r < 0.06;
        const tier = pickup ? 'pickup' : r < 0.26 ? 'featured' : 'base';
        const cash = rand() < 0.72;
        const discountIqd = !pickup && rand() < 0.08 ? pick([1000, 1500, 2000]) : 0;
        const deliveryFeeIqd = pickup ? 0 : pick([1000, 1000, 1500, 1500, 2000]);
        const serviceFeeIqd = 500;
        const ordererId = `demo-diner-${++customer}`;
        const { order } = await repo.create(
          {
            cityId: 'aziziyah',
            type: 'food',
            ordererId,
            merchantOrgId: khalid.orgId,
            householdOrgId: null,
            quoteId: null,
            paymentMethod: cash ? 'cash' : 'wallet',
            itemsTotalIqd: itemsIqd,
            deliveryFeeIqd,
            serviceFeeIqd,
            discountIqd,
            promotionId: discountIqd ? 'promo_first_orders' : null,
            tipIqd: 0,
            totalIqd: itemsIqd + deliveryFeeIqd + serviceFeeIqd - discountIqd,
            receiptTotalIqd: null,
            refundState: 'none',
            note: null,
            scheduledFor: null,
            minVehicleClass: null,
            dropoff: null,
            placedAt: new Date(placedAt),
          },
          lines.map((l) => ({ catalogItemId: l.catalogItemId, freeText: l.freeText, qty: l.qty, unitPriceIqd: l.unitPriceIqd, modifiers: l.modifiers, note: l.note, pointsEligible: l.pointsEligible, participantRef: l.participantRef })),
          [],
        );
        const offeredAt = new Date(placedAt + 20_000);
        if (rand() < rejectP) {
          await repo.update(order.id, { state: 'merchant_rejected', merchantOfferedAt: offeredAt, cancelledAt: new Date(placedAt + 60_000), cancellationReason: pick(['sold_out', 'too_busy']) });
          orders.push({ id: order.id, state: 'merchant_rejected' });
          continue;
        }
        const quoted = prep <= 8 ? 10 : prep <= 12 ? 15 : prep <= 22 ? 20 : 25;
        const acceptedAt = placedAt + between(15, 70) * 1000;
        const late = rand() < 0.4 ? between(5, 11) : -between(0, 3);
        const readyAt = acceptedAt + (quoted + late) * MIN + between(0, 50) * 1000;
        const pickedUpAt = readyAt + between(1, 6) * MIN;
        const deliveredAt = pickedUpAt + between(7, 16) * MIN;
        const courier = pickup ? null : couriers[Math.floor(rand() * couriers.length)];
        const patch = {
          state: deliveredAt < now - 30 * MIN ? 'closed' : 'delivered',
          merchantOfferedAt: offeredAt,
          acceptedAt: new Date(acceptedAt),
          preparingAt: new Date(acceptedAt),
          promisedReadyAt: new Date(acceptedAt + quoted * MIN),
          readyAt: new Date(readyAt),
          pickedUpAt: new Date(pickedUpAt),
          deliveredAt: new Date(Math.min(deliveredAt, now - 2 * MIN)),
          closedAt: deliveredAt < now - 30 * MIN ? new Date(deliveredAt + 20 * MIN) : null,
        };
        // Food ratings on ~45 % of orders, scored around each item's mean.
        if (rand() < 0.45) {
          const main = lines[0].key;
          const taste = TASTE[main] ?? { mean: 4.4, notes: [] };
          const score = Math.max(1, Math.min(5, Math.round(taste.mean + (rand() - 0.5) * 1.6)));
          const note = taste.notes.length && rand() < 0.5 ? pick(taste.notes) : null;
          patch.rating = { delivery: between(4, 5), food: score, tags: [], note, ratedAt: new Date(deliveredAt + 15 * MIN) };
          patch.ratedAt = patch.rating.ratedAt;
        }
        await repo.update(order.id, patch);
        const at = new Date(Math.min(deliveredAt, now - 2 * MIN));
        const money = postOrderClosed(
          {
            orderId: order.id,
            orderType: 'food',
            occurredAt: at,
            customerId: ordererId,
            payment: cash ? 'cash' : 'wallet',
            merchantId: khalid.orgId,
            ...(courier ? { courierId: courier.id } : {}),
            itemsSubtotalIqd: itemsIqd,
            commissionTier: tier,
            serviceFeeIqd,
            deliveryFeeIqd,
          },
          AZIZIYAH_MONEY_RULES,
        );
        await ledger.recordAll([money.money]);
        const net = itemsIqd - Math.round(itemsIqd * AZIZIYAH_MONEY_RULES.commission[tier]);
        // What this order did to the merchant's cash account: couriers carry cash orders' net; a pickup
        // paid in cash leaves the cash in the till, so the account only keeps the commission and fee owed.
        const delta = cash && !courier ? net - (itemsIqd + serviceFeeIqd) : net;
        orders.push({ id: order.id, state: patch.state, at: at.getTime(), cash, pickup, courierId: courier?.id ?? null, net, delta, ordererId, keys: lines.map((l) => l.key) });
      }
    }
  }

  // Evening settlements: each courier hands over what he collected since the last one (PIN), Driver
  // transfers the prepaid orders' net (ZainCash) — so the live balance is just the last two hours.
  const merchantAgg = { name: 'merchant', id: khalid.orgId };
  let seq = 0;
  for (let k = 35; k >= 0; k--) {
    const at = settleAt(k);
    const from = settleAt(k + 1);
    const window = orders.filter((o) => o.at && o.at >= from && o.at < at);
    const byCourier = new Map();
    for (const o of window) if (o.cash && o.courierId) byCourier.set(o.courierId, (byCourier.get(o.courierId) ?? 0) + o.net);
    let minute = 0;
    for (const [courierId, amount] of byCourier) {
      const handoverId = `hv-${new Date(at).toISOString().slice(0, 10).replace(/-/g, '')}-${++seq}`;
      const when = new Date(at + minute++ * 7 * MIN);
      await ledger.recordAll([postMerchantPaidByCourier({ handoverId, courierId, merchantId: khalid.orgId, amountIqd: amount, occurredAt: when })]);
      await events.emit(undefined, { actorId: courierId, type: 'merchant.paid_by_courier', occurredAt: when, payload: { handoverId, merchantId: khalid.orgId, courierId, amountIqd: amount, confirmedBy: rand() < 0.85 ? 'pin' : 'tablet' } }, merchantAgg);
    }
    // The board section's bare 87,500 (no orders behind it) is paid out with today's first transfer.
    const prepaid = window.filter((o) => !o.cash || !o.courierId).reduce((s, o) => s + o.delta, 0) + (k === 0 ? 87_500 : 0);
    if (prepaid > 0) {
      const reference = `M-${String(4000 + seq).slice(-4)}-ZC${String(k).padStart(2, '0')}`;
      await ledger.recordAll([postSettlement({ kind: 'merchant_payout', merchantId: khalid.orgId, amountIqd: prepaid, channel: 'zaincash', reference, occurredAt: new Date(at + 40 * MIN) })]);
    }
  }
  return { couriers, orders, now };
}
