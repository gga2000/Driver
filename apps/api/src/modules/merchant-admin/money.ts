import {
  AZIZIYAH_MONEY_RULES,
  CommissionTier,
  type CashHandover,
  type HandoverConfirmation,
  type MerchantBalanceView,
  type MerchantCashAccount,
  type MoneyHeadline,
  type MoneyRules,
  type MoneyToday,
  type Order,
  type SettlementMode,
  type SettlementRequestView,
  type Statement,
  type StatementOrderLine,
  type WeeklyStatement,
} from '@driver/contracts';

const TIERS = CommissionTier.options;

function tierOf(memo: string | undefined): CommissionTier | null {
  const t = memo?.startsWith('commission:') ? memo.slice('commission:'.length) : null;
  return t && (TIERS as readonly string[]).includes(t) ? (t as CommissionTier) : null;
}

/** Commission rate of a tier in percent, one decimal (0.12 → 12). */
export function tierPct(tier: CommissionTier, rules: MoneyRules = AZIZIYAH_MONEY_RULES): number {
  return Math.round(rules.commission[tier] * 1000) / 10;
}

/** A merchant deal's ledger line (`promo_funded` out of the merchant cash account, memo `deal:<id>[:delivery]`). */
function isDealLine(l: Statement['lines'][number]): boolean {
  return l.type === 'promo_funded' && (l.memo ?? '').startsWith('deal:');
}

/** What a merchant's own deals cost per order (items deals and free delivery), from its ledger lines. */
export function dealCostByOrder(statement: Statement): Map<string, { itemsIqd: number; deliveryIqd: number }> {
  const out = new Map<string, { itemsIqd: number; deliveryIqd: number }>();
  for (const l of statement.lines) {
    if (!l.orderId || !isDealLine(l)) continue;
    const row = out.get(l.orderId) ?? { itemsIqd: 0, deliveryIqd: 0 };
    if ((l.memo ?? '').endsWith(':delivery')) row.deliveryIqd += Math.abs(l.amountIqd);
    else row.itemsIqd += Math.abs(l.amountIqd);
    out.set(l.orderId, row);
  }
  return out;
}

/**
 * Per-order lines of the merchant cash account: items (payable), the merchant's own deal (discount
 * funded by the merchant), commission (on items after that deal, G-87), fees received.
 */
export function orderLines(statement: Statement, orders: ReadonlyMap<string, Order>, rules: MoneyRules = AZIZIYAH_MONEY_RULES): StatementOrderLine[] {
  const byOrder = new Map<string, StatementOrderLine>();
  for (const l of statement.lines) {
    if (!l.orderId) continue;
    if (l.type !== 'merchant_payable' && l.type !== 'commission_accrued' && l.type !== 'cancellation_fee' && !isDealLine(l)) continue;
    const order = orders.get(l.orderId);
    // A platform promo is shown for information (it does not lower the merchant's net); a merchant deal
    // comes from its own ledger line below.
    const platformDiscount = order && order.discountIqd > 0 && order.discount?.funder !== 'merchant' ? order.discountIqd : 0;
    const row: StatementOrderLine = byOrder.get(l.orderId) ?? {
      orderId: l.orderId,
      at: l.occurredAt,
      payment: order?.paymentMethod ?? 'cash',
      itemsIqd: 0,
      commissionTier: null,
      commissionPct: null,
      commissionIqd: 0,
      discountIqd: platformDiscount,
      discountFunder: platformDiscount > 0 ? 'platform' : null,
      dealIqd: platformDiscount > 0 ? (order?.discount?.dealIqd ?? platformDiscount) : 0,
      roundingIqd: platformDiscount > 0 ? (order?.discount?.roundingIqd ?? 0) : 0,
      feesIqd: 0,
      netIqd: 0,
    };
    if (l.type === 'merchant_payable') row.itemsIqd += l.amountIqd;
    else if (isDealLine(l)) {
      if (row.discountFunder !== 'merchant') row.discountIqd = 0;
      row.discountIqd += Math.abs(l.amountIqd);
      row.discountFunder = 'merchant';
      // The receipt split (exact deal, rounding given back) from the order; the ledger line is the cost.
      const rounding = order?.discount?.funder === 'merchant' ? (order.discount.roundingIqd ?? 0) : 0;
      row.roundingIqd = rounding;
      row.dealIqd = row.discountIqd + rounding;
    } else if (l.type === 'commission_accrued') {
      row.commissionIqd -= l.amountIqd;
      row.commissionTier = tierOf(l.memo) ?? row.commissionTier;
      row.commissionPct = row.commissionTier ? tierPct(row.commissionTier, rules) : null;
    } else row.feesIqd += l.amountIqd;
    row.netIqd += l.amountIqd;
    if (l.occurredAt < row.at) row.at = l.occurredAt;
    byOrder.set(l.orderId, row);
  }
  return [...byOrder.values()].sort((a, b) => a.at.getTime() - b.at.getTime() || a.orderId.localeCompare(b.orderId));
}

/** Money today (merchant app): sales, commission by tier, net, cash with couriers, live payable balance. */
export function composeMoneyToday(input: {
  merchantOrgId: string;
  localDate: string;
  statement: Statement;
  orders: ReadonlyMap<string, Order>;
  balance: MerchantBalanceView;
  rules: MoneyRules;
}): MoneyToday {
  const lines = orderLines(input.statement, input.orders, input.rules);
  const deals = dealCostByOrder(input.statement);
  const tiers = new Map<CommissionTier, { baseIqd: number; commissionIqd: number; orders: number }>();
  for (const l of lines) {
    if (!l.commissionTier) continue;
    const t = tiers.get(l.commissionTier) ?? { baseIqd: 0, commissionIqd: 0, orders: 0 };
    // G-87: the base is the items after the merchant's own items deal (free delivery is not in it).
    t.baseIqd += l.itemsIqd - (deals.get(l.orderId)?.itemsIqd ?? 0);
    t.commissionIqd += l.commissionIqd;
    t.orders += 1;
    tiers.set(l.commissionTier, t);
  }
  const salesIqd = lines.reduce((s, l) => s + l.itemsIqd, 0);
  const commissionIqd = lines.reduce((s, l) => s + l.commissionIqd, 0);
  const feesIqd = lines.reduce((s, l) => s + l.feesIqd, 0);
  const dealsIqd = [...deals.values()].reduce((s, d) => s + d.itemsIqd + d.deliveryIqd, 0);
  // The orders the sales figure is made of: an order's money is booked when it is delivered, so the
  // kitchen's open orders are not counted next to sales that don't include them yet.
  const sold = lines.filter((l) => l.itemsIqd > 0).length;
  return {
    merchantOrgId: input.merchantOrgId,
    localDate: input.localDate,
    orders: sold,
    salesIqd,
    commissionIqd,
    commissionByTier: [...tiers.entries()].map(([tier, t]) => ({ tier, pct: tierPct(tier, input.rules), ...t })),
    // What the merchant's own deals cost today (items discounts + free deliveries it paid for).
    dealsIqd,
    netIqd: salesIqd - commissionIqd + feesIqd - dealsIqd,
    cashHeldByCouriersIqd: input.balance.holders.reduce((s, h) => s + h.amountIqd, 0),
    holders: input.balance.holders,
    payableBalanceIqd: input.balance.balanceIqd,
    settlementMode: input.balance.mode,
    overExposure: input.balance.overExposure,
  };
}

/** The weekly statement: per-order lines plus the hand-overs and payouts that settled the account. */
export function composeStatement(input: { merchantOrgId: string; from: Date; to: Date; statement: Statement; orders: ReadonlyMap<string, Order> }): WeeklyStatement {
  const lines = orderLines(input.statement, input.orders);
  const settlements: WeeklyStatement['settlements'] = [];
  for (const l of input.statement.lines) {
    if (l.type === 'merchant_paid_by_courier') settlements.push({ at: l.occurredAt, kind: 'courier_handover', amountIqd: Math.abs(l.amountIqd), reference: null });
    else if (l.type === 'merchant_payout') {
      const memo = l.memo ?? '';
      settlements.push({ at: l.occurredAt, kind: 'payout', amountIqd: Math.abs(l.amountIqd), reference: memo.includes(':') ? memo.slice(memo.indexOf(':') + 1) : memo || null });
    }
  }
  const netIqd = lines.reduce((s, l) => s + l.netIqd, 0);
  const settledIqd = settlements.reduce((s, x) => s + x.amountIqd, 0);
  return {
    merchantOrgId: input.merchantOrgId,
    from: input.from,
    to: input.to,
    openingIqd: input.statement.openingIqd,
    closingIqd: input.statement.closingIqd,
    lines,
    settlements,
    totals: {
      orders: lines.length,
      itemsIqd: lines.reduce((s, l) => s + l.itemsIqd, 0),
      commissionIqd: lines.reduce((s, l) => s + l.commissionIqd, 0),
      feesIqd: lines.reduce((s, l) => s + l.feesIqd, 0),
      netIqd,
      settledIqd,
      adjustmentsIqd: statementAdjustments(input.statement.openingIqd, netIqd, settledIqd, input.statement.closingIqd),
    },
  };
}

/**
 * M-17 · the bridge row: whatever moved the account besides the week's orders and the money he
 * received (a correction, a deal not tied to an order…), so on screen
 * `opening + net − received + adjustments = closing` always adds up.
 */
export function statementAdjustments(openingIqd: number, netIqd: number, settledIqd: number, closingIqd: number): number {
  return closingIqd - openingIqd - netIqd + settledIqd;
}

/** How a merchant's money reaches him, by settlement mode (decisions §3). */
const ARRIVES: Record<SettlementMode, NonNullable<MoneyHeadline['arrives']>> = {
  nightly_courier: 'tonight_courier',
  on_demand: 'on_request',
  daily_zaincash: 'zaincash_daily',
  weekly_bulk: 'bank_weekly',
};

/**
 * S-M5 · the header pill in one line. An open "اطلب فلوسك" wins ("فلوسك جاية قبل 9:40 م", with the
 * promised time once a courier or channel is set); otherwise the balance in words: owed (and how it
 * reaches him), owe (commission taken off his next money) or zero.
 */
export function moneyHeadline(input: { balanceIqd: number; mode: SettlementMode; request: SettlementRequestView | null }): MoneyHeadline {
  const r = input.request;
  if (r && r.state !== 'handed_over' && input.balanceIqd > 0) return { kind: 'requested', amountIqd: input.balanceIqd, arrives: null, by: r.targetBy };
  if (input.balanceIqd > 0) return { kind: 'owed', amountIqd: input.balanceIqd, arrives: ARRIVES[input.mode], by: null };
  if (input.balanceIqd < 0) return { kind: 'owe', amountIqd: -input.balanceIqd, arrives: null, by: null };
  return { kind: 'zero', amountIqd: 0, arrives: null, by: null };
}

/** Hand-overs older than this drop off the Money screen (the weekly statement keeps them). */
export const HANDOVER_LOOKBACK_DAYS = 14;
const MAX_HANDOVERS = 20;
/** A request older than this is no longer shown as the open one. */
export const REQUEST_VISIBLE_HOURS = 24;

/** The slice of a stored event the cash account reads. */
export interface CashEvent {
  type: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const date = (v: unknown): Date | null => {
  const d = typeof v === 'string' || v instanceof Date ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * The cash account for the Money screen (decisions §3): balance split between the couriers holding
 * it and Driver, recent hand-overs (ledger `merchant_paid_by_courier` lines, confirmation from the
 * `merchant.paid_by_courier` event) and the latest "اطلب فلوسك" as a timeline: requested →
 * courier on the way (`merchant.settlement_assigned`) → handed over (his next hand-over).
 */
export function composeCashAccount(input: {
  merchantOrgId: string;
  now: Date;
  balance: MerchantBalanceView;
  /** The merchant cash account's statement over the hand-over window. */
  statement: Statement;
  /** Events of aggregate `merchant`/<id>, recording order. */
  events: readonly CashEvent[];
  names: ReadonlyMap<string, string | null>;
}): MerchantCashAccount {
  const confirmations = new Map<string, HandoverConfirmation>();
  for (const e of input.events) {
    if (e.type !== 'merchant.paid_by_courier') continue;
    const id = str(e.payload['handoverId']);
    const by = e.payload['confirmedBy'];
    if (id && (by === 'pin' || by === 'tablet')) confirmations.set(id, by);
  }
  const since = input.now.getTime() - HANDOVER_LOOKBACK_DAYS * 86_400_000;
  const all: CashHandover[] = input.statement.lines
    .filter((l) => l.type === 'merchant_paid_by_courier')
    .map((l) => {
      const courierId = l.counterparty.startsWith('cash:') ? l.counterparty.slice('cash:'.length) : l.counterparty;
      const handoverId = l.memo ?? l.id;
      return {
        handoverId,
        at: l.occurredAt,
        courierId,
        courierName: input.names.get(courierId) ?? null,
        amountIqd: Math.abs(l.amountIqd),
        balanceAfterIqd: l.balanceAfterIqd,
        confirmedBy: confirmations.get(handoverId) ?? null,
      };
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const handovers = all.filter((h) => h.at.getTime() >= since).slice(0, MAX_HANDOVERS);

  let request: SettlementRequestView | null = null;
  const requested = [...input.events].reverse().find((e) => e.type === 'merchant.settlement_requested');
  const reference = requested ? str(requested.payload['reference']) : null;
  if (requested && reference && input.now.getTime() - requested.occurredAt.getTime() <= REQUEST_VISIBLE_HOURS * 3_600_000) {
    const assigned = input.events.find((e) => e.type === 'merchant.settlement_assigned' && e.payload['reference'] === reference);
    const channel = assigned ? str(assigned.payload['channel']) : null;
    const courierId = assigned ? str(assigned.payload['courierId']) : null;
    const handover = [...all].reverse().find((h) => h.at.getTime() >= requested.occurredAt.getTime() && (!courierId || h.courierId === courierId)) ?? null;
    const reasonRaw = str(requested.payload['reason']);
    request = {
      reference,
      reason: reasonRaw === 'exposure_cap' || reasonRaw === 'mode_schedule' ? reasonRaw : 'merchant_request',
      requestedAt: requested.occurredAt,
      amountIqd: num(requested.payload['balanceIqd']) ?? 0,
      state: handover ? 'handed_over' : assigned && channel === 'courier' ? 'on_the_way' : 'requested',
      channel: channel === 'courier' || channel === 'ops_round' || channel === 'zaincash' || channel === 'bank' ? channel : null,
      courierId,
      courierName: courierId ? (input.names.get(courierId) ?? null) : null,
      assignedAt: assigned?.occurredAt ?? null,
      targetBy: assigned ? date(assigned.payload['targetBy']) : null,
      handover,
    };
  }

  const held = input.balance.holders.reduce((s, h) => s + h.amountIqd, 0);
  return {
    headline: moneyHeadline({ balanceIqd: input.balance.balanceIqd, mode: input.balance.mode, request }),
    merchantOrgId: input.merchantOrgId,
    balanceIqd: input.balance.balanceIqd,
    exposureCapIqd: input.balance.exposureCapIqd,
    overExposure: input.balance.overExposure,
    mode: input.balance.mode,
    holders: input.balance.holders.map((h) => ({ courierId: h.courierId, name: input.names.get(h.courierId) ?? null, amountIqd: h.amountIqd })),
    heldByPlatformIqd: Math.max(0, input.balance.balanceIqd - held),
    request,
    handovers,
    lastSettledAt: input.balance.lastSettledAt,
  };
}
