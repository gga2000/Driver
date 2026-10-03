/**
 * Number and money formatting per the voice guide (§5): Western digits 0–9, comma thousands,
 * `دينار` after the amount, no Eastern-Arabic digits. Kept pure so it is testable without React.
 */

const digits = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: true });

/** `12500` → `12,500`; negatives keep the sign in front: `-250`. */
export function formatIqd(amount: number): string {
  return digits.format(Math.trunc(amount));
}

/** `12500` → `12,500 دينار` (ar) or `12,500 IQD` (en). */
export function formatMoney(amount: number, locale: 'ar-IQ' | 'en' = 'ar-IQ'): string {
  return `${formatIqd(amount)} ${locale === 'en' ? 'IQD' : 'دينار'}`;
}

/** A signed line amount for quote tables: `+1,000` / `−250` / `0`. */
export function formatSigned(amount: number): string {
  if (amount > 0) return `+${formatIqd(amount)}`;
  if (amount < 0) return `−${formatIqd(-amount)}`;
  return '0';
}

/** `Date` → value for `<input type="datetime-local">` in the browser's local time (minute precision). */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses the `datetime-local` value back to a Date; returns `null` when empty or invalid. */
export function fromLocalInputValue(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 12-hour clock as the guide formats it (`7:30 م`, `11:05 ص`), in the given IANA zone. */
export function formatClock(d: Date, timeZone = 'Asia/Baghdad'): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour');
  const minute = get('minute');
  const pm = get('dayPeriod').toUpperCase() === 'PM';
  return `${hour}:${minute} ${pm ? 'م' : 'ص'}`;
}
