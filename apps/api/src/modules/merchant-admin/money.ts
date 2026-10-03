import {
  CommissionTier,
  type MerchantBalanceView,
  type MoneyRules,
  type MoneyToday,
  type Order,
  type Statement,
  type StatementOrderLine,
  type WeeklyStatement,
} from '@driver/contracts';

const TIERS = CommissionTier.options;

function tierOf(memo: string | undefined): CommissionTier | null {
  const t = memo?.startsWith('commission:') ? memo.slice('commission:'.length) : null;
  return t && (TIERS as readonly string[]).includes(t) ? (t as CommissionTier) : null;
}

/** Per-order lines of the merchant cash account: items (payable), commission, fees received. */
export function orderLines(statement: Statement, orders: ReadonlyMap<string, Order>): StatementOrderLine[] {
  const byOrder = new Map<string, StatementOrderLine>();
  for (const l of statement.lines) {
    if (!l.orderId) continue;
    if (l.type !== 'merchant_payable' && l.type !== 'commission_accrued' && l.type !== 'cancellation_fee') continue;
    const row = byOrder.get(l.orderId) ?? {
      orderId: l.orderId,
      at: l.occurredAt,
      payment: orders.get(l.orderId)?.paymentMethod ?? 'cash',
      itemsIqd: 0,
      commissionTier: null,
      commissionIqd: 0,
      feesIqd: 0,
      netIqd: 0,
    };
    if (l.type === 'merchant_payable') row.itemsIqd += l.amountIqd;
    else if (l.type === 'commission_accrued') {
      row.commissionIqd -= l.amountIqd;
      row.commissionTier = tierOf(l.memo) ?? row.commissionTier;
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
  const lines = orderLines(input.statement, input.orders);
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
    commissionByTier: [...tiers.entries()].map(([tier, t]) => ({ tier, pct: Math.round(input.rules.commission[tier] * 1000) / 10, ...t })),
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
