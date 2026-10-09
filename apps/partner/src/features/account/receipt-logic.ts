import type { JobReceipt, JobReceiptLine, ReceiptReasonCode } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { amountParam } from '@/lib/money';
import { componentLabel } from './logic';

/**
 * "Why was I paid this" (audit S-7), pure: the receipt's lines in words. The reason sentences are the
 * customer's own quote reasons (`quote.reason.*`) where the pay is the same thing, so both sides read
 * the same words; the rest are partner lines (`partner.receipt_reason_*`). Plain Node (unit-tested).
 */

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

const REASON_KEY: Record<ReceiptReasonCode, MessageKey> = {
  delivery_full: 'quote.reason.delivery_full',
  night: 'quote.reason.night',
  rain: 'quote.reason.rain',
  peak: 'quote.reason.peak',
  door_pickup: 'quote.reason.door_pickup',
  wait: 'quote.reason.wait',
  fare: 'partner.receipt_reason_fare',
  take: 'partner.receipt_reason_take_v2',
  tip: 'partner.receipt_reason_tip',
  batch: 'partner.receipt_reason_batch',
  compensation: 'partner.receipt_reason_compensation',
  guarantee: 'partner.receipt_reason_guarantee',
  incentive: 'partner.receipt_reason_incentive',
  penalty: 'partner.receipt_reason_penalty',
};

/** "12%" kept in one left-to-right piece inside Arabic. */
export function ratePct(rate: number): string {
  return `⁦${Math.round(rate * 100)}%⁩`;
}

/** Placeholders the reason needs, formatted: the take's rate as "12%", amounts with thousands. */
function reasonParams(code: ReceiptReasonCode, params: Record<string, string | number>): Record<string, string | number> {
  if (code === 'take') return { rate: ratePct(Number(params['rate'] ?? 0) / 100) };
  if (code === 'wait') return { amount: amountParam(Number(params['amount'] ?? 0)) };
  return params;
}

export interface ReceiptRow {
  key: string;
  label: string;
  amountIqd: number;
  reason: string | null;
  /** The platform's take: drawn apart, with its rate. */
  take: boolean;
}

export function receiptRows(r: Pick<JobReceipt, 'lines' | 'takeRate'>, t: T): ReceiptRow[] {
  return r.lines.map((l: JobReceiptLine, i) => {
    const take = l.type === 'commission_accrued';
    return {
      key: `${i}-${l.type}-${l.memo ?? ''}`,
      label: take && r.takeRate !== null ? t('partner.receipt_take_label_v2', { rate: ratePct(r.takeRate) }) : componentLabel(l, t),
      amountIqd: l.amountIqd,
      reason: l.reason ? t(REASON_KEY[l.reason.code], reasonParams(l.reason.code, l.reason.params)) : null,
      take,
    };
  });
}

/** "#1284", the number the kitchen and support say; else the short reference. */
export function receiptRef(r: Pick<JobReceipt, 'ticket' | 'key'>): string {
  return r.ticket ? `⁦#${r.ticket}⁩` : `⁦${r.key.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()}⁩`;
}

/** A taxi/tuktuk ride is a مشوار (voice glossary), a delivery a طلب: rides are paid as a fare. */
export function isRide(r: Pick<JobReceipt, 'lines'>): boolean {
  return r.lines.some((l) => l.type === 'fare');
}

/** "طلب #1284" / "مشوار #1284" */
export function receiptTitle(r: Pick<JobReceipt, 'ticket' | 'key' | 'lines'>, t: T): string {
  return t(isRide(r) ? 'partner.receipt_ticket_ride' : 'partner.receipt_ticket', { ref: receiptRef(r) });
}

/** The objection's opening line, with the job's number, ready for his own words. */
export function disputePrefill(r: Pick<JobReceipt, 'ticket' | 'key' | 'lines'>, t: T): string {
  return t(isRide(r) ? 'partner.receipt_dispute_prefill_ride' : 'partner.receipt_dispute_prefill', { ref: receiptRef(r) });
}

export interface ReceiptCashRow {
  key: 'collected' | 'merchant' | 'kept' | 'company';
  label: string;
  amountIqd: number;
}

/**
 * The cash card, from the server's split (`JobReceipt.cash`): what he took, then where each part
 * went — the restaurant at pickup, his own pay (it stays with him), the company — each only when it is
 * not zero, so the arrows always add up to the first line. Null for a cashless job.
 */
export function cashRows(r: Pick<JobReceipt, 'cash'>, t: T): ReceiptCashRow[] | null {
  const c = r.cash;
  if (!c) return null;
  const rows: ReceiptCashRow[] = [{ key: 'collected', label: t('partner.receipt_cash_collected'), amountIqd: c.collectedIqd }];
  if (c.toMerchantIqd > 0) rows.push({ key: 'merchant', label: t('partner.receipt_cash_merchant'), amountIqd: c.toMerchantIqd });
  if (c.keptIqd > 0) rows.push({ key: 'kept', label: t('partner.receipt_cash_kept'), amountIqd: c.keptIqd });
  if (c.toCompanyIqd > 0) rows.push({ key: 'company', label: t('partner.receipt_cash_company'), amountIqd: c.toCompanyIqd });
  return rows;
}

/**
 * The line under the cash card. A restaurant order whose restaurant he did not pay at pickup: its
 * share is inside the company's part (the company pays it). Otherwise, when some of the cash is his
 * pay: why he hands over less than he took. Nothing else to say otherwise.
 */
export function cashNote(r: Pick<JobReceipt, 'cash' | 'lines' | 'orderId'>, t: T): string | null {
  const c = r.cash;
  if (!c) return null;
  const restaurant = r.orderId !== null && !isRide(r) && r.lines.some((l) => l.type === 'delivery_fee');
  if (restaurant && c.toMerchantIqd === 0 && c.toCompanyIqd > 0) return t('partner.receipt_cash_note_restaurant');
  if (c.keptIqd > 0) return t('partner.receipt_cash_note_kept');
  return null;
}
