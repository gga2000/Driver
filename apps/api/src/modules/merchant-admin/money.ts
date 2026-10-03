import {
  AZIZIYAH_MONEY_RULES,
  CommissionTier,
  type CashHandover,
  type HandoverConfirmation,
  type MerchantBalanceView,
  type MerchantCashAccount,
  type MoneyRules,
  type MoneyToday,
  type Order,
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

/** Per-order lines of the merchant cash account: items (payable), commission, fees received. */
export function orderLines(statement: Statement, orders: ReadonlyMap<string, Order>, rules: MoneyRules = AZIZIYAH_MONEY_RULES): StatementOrderLine[] {
  const byOrder = new Map<string, StatementOrderLine>();
  for (const l of statement.lines) {
    if (!l.orderId) continue;
    if (l.type !== 'merchant_payable' && l.type !== 'commission_accrued' && l.type !== 'cancellation_fee') continue;
    const order = orders.get(l.orderId);
    const discountIqd = order?.discountIqd ?? 0;
    const row: StatementOrderLine = byOrder.get(l.orderId) ?? {
      orderId: l.orderId,
      at: l.occurredAt,
      payment: order?.paymentMethod ?? 'cash',
      itemsIqd: 0,
      commissionTier: null,
      commissionPct: null,
      commissionIqd: 0,
      // Merchant-funded deals are not redeemed on orders yet (G-87 binding pending): every discount today is a platform promo.
      discountIqd,
      discountFunder: discountIqd > 0 ? 'platform' : null,
      feesIqd: 0,
      netIqd: 0,
    };
    if (l.type === 'merchant_payable') row.itemsIqd += l.amountIqd;
    else if (l.type === 'commission_accrued') {
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
  const tiers = new Map<CommissionTier, { baseIqd: number; commissionIqd: number; orders: number }>();
  for (const l of lines) {
    if (!l.commissionTier) continue;
    const t = tiers.get(l.commissionTier) ?? { baseIqd: 0, commissionIqd: 0, orders: 0 };
    t.baseIqd += l.itemsIqd;
    t.commissionIqd += l.commissionIqd;
    t.orders += 1;
    tiers.set(l.commissionTier, t);
  }
  const salesIqd = lines.reduce((s, l) => s + l.itemsIqd, 0);
  const commissionIqd = lines.reduce((s, l) => s + l.commissionIqd, 0);
  const feesIqd = lines.reduce((s, l) => s + l.feesIqd, 0);
  const counted = [...input.orders.values()].filter((o) => !['merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'placed'].includes(o.state)).length;
  return {
    merchantOrgId: input.merchantOrgId,
    localDate: input.localDate,
    orders: counted,
    salesIqd,
    commissionIqd,
    commissionByTier: [...tiers.entries()].map(([tier, t]) => ({ tier, pct: tierPct(tier, input.rules), ...t })),
    // Merchant-funded deals are not redeemed on orders yet (PromotionsPort binding pending): always 0.
    dealsIqd: 0,
    netIqd: salesIqd - commissionIqd + feesIqd,
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
      netIqd: lines.reduce((s, l) => s + l.netIqd, 0),
      settledIqd: settlements.reduce((s, x) => s + x.amountIqd, 0),
    },
  };
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
