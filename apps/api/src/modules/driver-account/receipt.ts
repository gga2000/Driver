import { orderTicketNumber, type DriverLedgerView, type JobReceipt, type JobReceiptLine, type ReceiptReasonCode } from '@driver/contracts';
import { CASH_IN_TYPES, GROSS_TYPES, jobKey, SETTLEMENT_TYPES } from './earnings.js';

/**
 * "Why was I paid this" (Partner audit S-7), pure: one job's ledger lines with the reason for each,
 * the platform's take as a rate, and where the cash he took went. Reasons reuse the customer's quote
 * sentences where the line is the same pay (night, rain, peak, door, wait, delivery in full), so both
 * sides read the same words.
 */

export interface ReceiptContext {
  /** "11:00" — when night pay starts (the city's pricing rule), for `quote.reason.night`. */
  nightFrom: string;
  /** IQD per waiting step (the city's wait rule), for `quote.reason.wait`. */
  waitAmountIqd: number;
}

type Reason = { code: ReceiptReasonCode; params: Record<string, string | number> } | null;

const r = (code: ReceiptReasonCode, params: Record<string, string | number> = {}): Reason => ({ code, params });

/** The reason a line carries, from its ledger type and memo ("night", "guarantee:…", …). */
export function reasonOf(line: { type: string; memo: string | null; amountIqd: number }, ctx: ReceiptContext, takeRate: number | null): Reason {
  const memo = (line.memo ?? '').split(':')[0] ?? '';
  if (line.type === 'commission_accrued') return r('take', { rate: Math.round((takeRate ?? 0) * 100) });
  if (line.type === 'tip') return r('tip');
  if (line.type === 'driver_incentive') {
    if (memo === 'guarantee') return r('guarantee');
    if (memo === 'rebroadcast_compensation' || memo === 'pickup_compensation') return r('compensation');
    return r('incentive');
  }
  if (line.amountIqd < 0) return r('penalty');
  switch (memo) {
    case 'night':
      return r('night', { time: ctx.nightFrom });
    case 'weather':
    case 'rain':
      return r('rain');
    case 'peak':
      return r('peak');
    case 'door_pickup':
      return r('door_pickup');
    case 'wait':
      return r('wait', { amount: ctx.waitAmountIqd });
    case 'batch_bonus':
      return r('batch');
    case 'pickup_compensation':
      return r('compensation');
    default:
      break;
  }
  if (line.type === 'delivery_fee') return r('delivery_full');
  if (line.type === 'fare') return r('fare');
  return null;
}

/** The receipt of the job `key` in `view` (the ledger read around the job), or null when it isn't there. */
export function composeReceipt(view: DriverLedgerView, key: string, ctx: ReceiptContext, opts: { queryOpen?: boolean } = {}): JobReceipt | null {
  const lines = view.earnings.lines.filter((l) => !SETTLEMENT_TYPES.has(l.type) && jobKey(l) === key);
  const cash = view.cash.lines.filter((l) => jobKey(l) === key);
  if (lines.length === 0 && cash.length === 0) return null;

  let grossIqd = 0;
  let takeIqd = 0;
  let tipsIqd = 0;
  let netIqd = 0;
  for (const l of lines) {
    netIqd += l.amountIqd;
    if (l.type === 'commission_accrued') takeIqd -= l.amountIqd;
    else if (l.type === 'tip') tipsIqd += l.amountIqd;
    else if (GROSS_TYPES.has(l.type) && l.amountIqd > 0) grossIqd += l.amountIqd;
  }
  const takeRate = takeIqd > 0 && grossIqd > 0 ? Math.min(1, takeIqd / grossIqd) : null;

  const out: JobReceiptLine[] = lines
    .slice()
    .sort((a, b) => order(a.type) - order(b.type) || a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((l) => ({
      type: l.type,
      label_ar: l.label_ar,
      label_en: l.label_en,
      amountIqd: l.amountIqd,
      memo: l.memo ?? null,
      reason: reasonOf({ type: l.type, memo: l.memo ?? null, amountIqd: l.amountIqd }, ctx, takeRate),
    }));

  let collectedIqd = 0;
  let toMerchantIqd = 0;
  for (const l of cash) {
    if (CASH_IN_TYPES.has(l.type)) collectedIqd += Math.abs(l.amountIqd);
    else if (l.type === 'merchant_paid_by_courier') toMerchantIqd += Math.abs(l.amountIqd);
  }
  const first = [...lines, ...cash].reduce((a, b) => (b.occurredAt < a.occurredAt ? b : a));
  const tripId = first.tripId ?? lines.find((l) => l.tripId)?.tripId ?? null;
  const orderId = first.orderId ?? [...lines, ...cash].find((l) => l.orderId)?.orderId ?? null;
  return {
    key,
    tripId,
    orderId,
    ticket: orderId ? orderTicketNumber(orderId) : null,
    at: first.occurredAt,
    lines: out,
    grossIqd,
    takeIqd,
    takeRate,
    tipsIqd,
    netIqd,
    cash: collectedIqd > 0 ? cashSplit(collectedIqd, toMerchantIqd, netIqd) : null,
    queryOpen: opts.queryOpen ?? false,
  };
}

/**
 * Where the cash he took went: the restaurant's share if he paid it at pickup, then his own pay for
 * the job — the hand-over nets his earnings against the cash (`owedOf` = cash − earnings), so it stays
 * with him — and the rest is the company's (it pays a restaurant he did not pay at pickup). The three
 * always add up to what he took. A job that paid him nothing (or less) keeps nothing back.
 */
export function cashSplit(collectedIqd: number, toMerchantIqd: number, netIqd: number): NonNullable<JobReceipt['cash']> {
  const afterMerchant = Math.max(0, collectedIqd - toMerchantIqd);
  const keptIqd = Math.min(afterMerchant, Math.max(0, netIqd));
  return { collectedIqd, toMerchantIqd, keptIqd, toCompanyIqd: afterMerchant - keptIqd };
}

/** Pay first, then extras, tips and incentives, the take last: the order a receipt reads in. */
function order(type: string): number {
  if (type === 'commission_accrued') return 9;
  if (type === 'tip') return 5;
  if (type === 'driver_incentive') return 6;
  return 0;
}

/** The receipt in a few plain lines for the support ticket ("أجرة التوصيل +1,500 · …"). */
export function receiptNote(rcpt: JobReceipt): string {
  const fmt = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString('en-US')}`;
  const parts = rcpt.lines.map((l) => `${l.label_ar} ${fmt(l.amountIqd)}`);
  const n = (v: number) => v.toLocaleString('en-US');
  const cash = rcpt.cash ? ` · كاش ${n(rcpt.cash.collectedIqd)} (للمطعم ${n(rcpt.cash.toMerchantIqd)} · أجرته ${n(rcpt.cash.keptIqd)} · للشركة ${n(rcpt.cash.toCompanyIqd)})` : '';
  return `${parts.join(' · ')} · الصافي ${rcpt.netIqd.toLocaleString('en-US')} دينار${cash}`;
}
