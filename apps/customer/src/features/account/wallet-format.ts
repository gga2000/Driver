import type { WalletLine } from '@driver/contracts';
import { cityDayDiff, cityParts, formatClock } from '@driver/i18n';
import type { MessageKey } from '@driver/i18n';
import { amountParam, iqd, type MoneyLocale } from '@/lib/money';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** "2,500 نقطة = 25,000 دينار" at the API's point value (100 points = 1,000 IQD). */
export function pointsWorthText(points: number, pointValueIqd: number, t: T): string {
  return t('wallet.points_worth', { points: amountParam(points), amount: amountParam(points * pointValueIqd) });
}

/** "اليوم 7:05 م", "أمس 9:30 ص", else "3/10" (day/month): the city's one clock and calendar. */
export function lineWhen(at: Date, now: Date, t: T): string {
  const diff = -cityDayDiff(at, now);
  if (diff === 0) return t('wallet.when_today', { time: formatClock(at) });
  if (diff === 1) return t('wallet.when_yesterday', { time: formatClock(at) });
  const p = cityParts(at);
  return `${p.day}/${p.month}`;
}

/**
 * A purchase paid in cash at the door never came out of the wallet: the API lists it for the record
 * (with any change or shortfall as lines of their own), so it reads as a plain price, not a debit.
 */
export function paidOutsideWallet(line: Pick<WalletLine, 'method' | 'unit'>): boolean {
  return line.unit === 'iqd' && line.method === 'cash';
}

/** Signed amount: "+20,000 دينار", "−16,500 دينار", "+27 نقطة"; a cash purchase unsigned: "14,000 دينار". */
export function lineAmount(line: Pick<WalletLine, 'amount' | 'unit' | 'method'>, locale: MoneyLocale, t: T): string {
  if (line.unit === 'points') return t('wallet.points_signed', { n: amountParam(line.amount, { sign: true }) });
  if (paidOutsideWallet(line)) return iqd(Math.abs(line.amount), { locale });
  return iqd(line.amount, { locale, sign: true });
}

/** A money balance: positive/zero reads as the amount, negative as "عليك X". */
export function balanceText(amount: number, locale: MoneyLocale, t: T): string {
  return amount < 0 ? t('wallet.you_owe', { amount: amountParam(-amount) }) : iqd(amount, { locale });
}

/** "18/10": a day on Baghdad's clock, whatever time zone the phone is set to (audit REL-21). */
export function cityDateText(at: Date, t: T): string {
  const { day, month } = cityParts(at);
  return t('time.date', { day, month });
}
