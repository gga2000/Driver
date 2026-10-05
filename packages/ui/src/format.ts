/**
 * Number and time formatting per the voice spec §5: Western digits, comma thousands, "دينار"
 * after the amount, U+2212 minus for discounts. Time comes from the one clock in @driver/i18n
 * (Asia/Baghdad, ص/م, days and durations; audit S-06), re-exported here for the apps.
 */
import { formatClock as cityClock, formatCountdown as cityCountdown } from '@driver/i18n';

export { formatDay, formatDuration, formatMinutes, formatWhen, cityDayDiff, cityParts } from '@driver/i18n';

export const MINUS = '\u2212';
/** Left-to-right isolate: keeps "−1,500" in one piece inside an Arabic sentence. */
const LRI = '\u2066';
const PDI = '\u2069';

export function groupDigits(n: number): string {
  const abs = Math.abs(Math.round(n));
  return abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Isolates a left-to-right run (hex codes, "99+", plates, Latin names) inside Arabic text. */
export function ltr(s: string): string {
  return `${LRI}${s}${PDI}`;
}

/** `1500` → `1,500`; `-1500` → `−1,500`; `{ sign: true }` adds `+` to positive amounts. */
export function formatAmount(n: number, opts: { sign?: boolean } = {}): string {
  const body = groupDigits(n);
  if (n < 0) return `${LRI}${MINUS}${body}${PDI}`;
  if (opts.sign && n > 0) return `${LRI}+${body}${PDI}`;
  return body;
}

/** `1500` → `1,500 دينار`. */
export function formatIqd(n: number, opts: { sign?: boolean; currency?: string } = {}): string {
  return `${formatAmount(n, opts)} ${opts.currency ?? 'دينار'}`;
}

/** Round to the city's step (default 250 IQD), half up — matches the pricing engine. */
export function roundToStep(n: number, step = 250): number {
  if (step <= 0) return n;
  return Math.round(n / step) * step;
}

/** "7:05 م" on the city's clock, whatever the phone's time zone. */
export function formatClock(d: Date | number, opts: { period?: boolean; locale?: 'ar-IQ' | 'en' } = {}): string {
  return cityClock(d, opts);
}

/** Countdown `m:ss` (voice spec: `{minutes}:{seconds}`), `h:mm:ss` from an hour up. */
export function formatCountdown(ms: number): string {
  return cityCountdown(ms);
}
