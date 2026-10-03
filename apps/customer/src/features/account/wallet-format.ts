import type { WalletLine } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { amountParam, iqd, type MoneyLocale } from '@/lib/money';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** "2,500 نقطة = 25,000 دينار" at the API's point value (100 points = 1,000 IQD). */
export function pointsWorthText(points: number, pointValueIqd: number, t: T): string {
  return t('wallet.points_worth', { points: amountParam(points), amount: amountParam(points * pointValueIqd) });
}

/** 12-hour clock, no AM/PM words (voice spec §5). */
function clock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "اليوم 7:05", "أمس 9:30", else "3/10" (day/month, Western digits). */
export function lineWhen(at: Date, now: Date, t: T): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return t('wallet.when_today', { time: clock(at) });
  if (diff === 1) return t('wallet.when_yesterday', { time: clock(at) });
  return `${at.getDate()}/${at.getMonth() + 1}`;
}

/** Signed amount: "+20,000 دينار", "−16,500 دينار", "+27 نقطة". */
export function lineAmount(line: Pick<WalletLine, 'amount' | 'unit'>, locale: MoneyLocale, t: T): string {
  if (line.unit === 'points') return t('wallet.points_signed', { n: amountParam(line.amount, { sign: true }) });
  return iqd(line.amount, { locale, sign: true });
}

/** A money balance: positive/zero reads as the amount, negative as "عليك X". */
export function balanceText(amount: number, locale: MoneyLocale, t: T): string {
  return amount < 0 ? t('wallet.you_owe', { amount: amountParam(-amount) }) : iqd(amount, { locale });
}
