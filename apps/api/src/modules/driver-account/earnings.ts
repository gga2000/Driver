import type { DriverLedgerView, EarningsJobLine, EarningsPeriod, EarningsView, MoneyRules, StatementLine } from '@driver/contracts';

/** Earnings lines that are positive pay before take (fares, delivery fees, seat money, fees received). */
export const GROSS_TYPES: ReadonlySet<string> = new Set([
  'fare',
  'delivery_fee',
  'seat_premium',
  'subscription_charge',
  'subscription_proration',
  'late_penalty_driver',
  'cancellation_fee',
  'errand_fee',
  'errand_cost_actual',
  'parcel_fee',
]);

/**
 * Cash he took from a customer at a stop: the price, its 0–249 rounding change and, when he had no
 * change ("الخردة علينا"), the rest of the note that went to the customer's wallet — the whole note —
 * and (M-3, `debt_settled`) the cancellation fees the customer owed and paid with it.
 */
export const CASH_IN_TYPES: ReadonlySet<string> = new Set(['cash_collected', 'cash_rounding_credit', 'cash_change_to_wallet', 'debt_settled']);

/** Settlement lines move money already earned; they are not earnings. */
export const SETTLEMENT_TYPES: ReadonlySet<string> = new Set(['driver_payout', 'driver_settlement', 'debt_settled']);

export function jobKey(l: Pick<StatementLine, 'tripId' | 'orderId' | 'id'>): string {
  return l.tripId ?? l.orderId ?? l.id;
}

/**
 * Driver earnings for a period, composed from the ledger's own statements (`ledger.driverLedger`):
 * every pay component of every job named, totals by kind, the cash he moved, and the cap bar.
 */
export function composeEarnings(view: DriverLedgerView, period: EarningsPeriod, range: { from: Date; to: Date }, rules: MoneyRules): EarningsView {
  const earningLines = view.earnings.lines.filter((l) => !SETTLEMENT_TYPES.has(l.type));
  let grossIqd = 0;
  let takeIqd = 0;
  let tipsIqd = 0;
  let bonusesIqd = 0;
  let guaranteeTopUpsIqd = 0;
  let penaltiesIqd = 0;
  const jobs = new Map<string, EarningsJobLine>();
  for (const l of earningLines) {
    if (l.type === 'commission_accrued') takeIqd -= l.amountIqd;
    else if (l.type === 'tip') tipsIqd += l.amountIqd;
    else if (l.type === 'driver_incentive' && (l.memo ?? '').startsWith('guarantee')) guaranteeTopUpsIqd += l.amountIqd;
    else if (l.type === 'driver_incentive') bonusesIqd += l.amountIqd;
    else if (GROSS_TYPES.has(l.type) && l.amountIqd > 0) grossIqd += l.amountIqd;
    else if (l.amountIqd < 0) penaltiesIqd -= l.amountIqd;
    else grossIqd += l.amountIqd;
    const key = jobKey(l);
    const job = jobs.get(key) ?? { key, tripId: l.tripId ?? null, orderId: l.orderId ?? null, at: l.occurredAt, components: [], netIqd: 0, cashCollectedIqd: 0 };
    job.components.push({ type: l.type, label_ar: l.label_ar, label_en: l.label_en, amountIqd: l.amountIqd, memo: l.memo ?? null });
    job.netIqd += l.amountIqd;
    if (l.occurredAt < job.at) job.at = l.occurredAt;
    jobs.set(key, job);
  }

  let collectedIqd = 0;
  let toMerchantsIqd = 0;
  let settledIqd = 0;
  for (const l of view.cash.lines) {
    if (CASH_IN_TYPES.has(l.type)) {
      collectedIqd += Math.abs(l.amountIqd);
      const job = jobs.get(jobKey(l));
      if (job) job.cashCollectedIqd += Math.abs(l.amountIqd);
    } else if (l.type === 'merchant_paid_by_courier') toMerchantsIqd += Math.abs(l.amountIqd);
    else if (l.type === 'driver_settlement') settledIqd += Math.abs(l.amountIqd);
  }

  const byTier = rules.caps.byRole[view.role];
  const list = [...jobs.values()].sort((a, b) => b.at.getTime() - a.at.getTime() || a.key.localeCompare(b.key));
  return {
    driverId: view.driverId,
    period,
    from: range.from,
    to: range.to,
    totals: {
      grossIqd,
      takeIqd,
      tipsIqd,
      bonusesIqd,
      guaranteeTopUpsIqd,
      penaltiesIqd,
      netIqd: grossIqd + tipsIqd + bonusesIqd + guaranteeTopUpsIqd - takeIqd - penaltiesIqd,
      jobs: list.filter((j) => j.tripId !== null || j.orderId !== null).length,
    },
    jobs: list,
    cash: {
      collectedIqd,
      toMerchantsIqd,
      settledIqd,
      heldIqd: Math.max(0, -view.cashBalanceIqd),
      owedIqd: view.owedIqd,
    },
    cap: {
      role: view.role,
      tier: view.tier,
      capIqd: view.capIqd,
      owedIqd: view.owedIqd,
      remainingIqd: view.capRemainingIqd,
      fill: view.capIqd > 0 ? Math.min(1, Math.max(0, view.owedIqd / view.capIqd)) : 1,
      overCap: view.overCap,
      byTier: { bronze: byTier.bronze, silver: byTier.silver, gold: byTier.gold },
    },
    payoutDueIqd: view.payoutDueIqd,
  };
}
