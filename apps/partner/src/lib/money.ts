/**
 * Money on screen, per the voice guide §5: Western digits, comma thousands, "دينار" after the
 * number (`IQD` in English), never "د.ع". Amounts are integer IQD from the API; we never do
 * float maths on them.
 *
 * Use `iqd()` for a standalone amount and `amountParam()` for `{amount}` placeholders in i18n
 * strings that already say "دينار" (e.g. `restaurant.delivery_from`).
 *
 * Same output as `formatIqd` in @driver/ui (kept dependency-free here so it runs in plain Node
 * tests without React Native).
 */

export type MoneyLocale = 'ar-IQ' | 'en';

const CURRENCY: Record<MoneyLocale, string> = { 'ar-IQ': 'دينار', en: 'IQD' };
/** U+2212 minus, wrapped in a left-to-right isolate so "−1,500" stays in one piece in Arabic. */
const MINUS = '−';
const LRI = '⁦';
const PDI = '⁩';

/** Toward +∞ at .5, like the pricing engine (so −0.5 → −0 → 0, not −1). */
function whole(n: number): number {
  return Math.round(n) || 0;
}

/** `1500` → `1,500` (no sign handling). */
export function groupDigits(n: number): string {
  return Math.abs(whole(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The number alone, for `{amount}` placeholders: `1500` → `1,500`; `-250` → `−250`. */
export function amountParam(amount: number, opts: { sign?: boolean } = {}): string {
  const n = whole(amount);
  const body = groupDigits(n);
  if (n < 0) return `${LRI}${MINUS}${body}${PDI}`;
  if (opts.sign && n > 0) return `${LRI}+${body}${PDI}`;
  return body;
}

/** `12500` → `12,500 دينار`; `-1500` → `−1,500 دينار`; English: `12,500 IQD`. */
export function iqd(amount: number, opts: { locale?: MoneyLocale; sign?: boolean } = {}): string {
  return `${amountParam(amount, { sign: opts.sign })} ${CURRENCY[opts.locale ?? 'ar-IQ']}`;
}

/** Delivery-fee label: 0 reads as the free label ("توصيل مجاني") rather than "0 دينار". */
export function feeOrFree(amount: number, freeLabel: string, opts: { locale?: MoneyLocale } = {}): string {
  return whole(amount) <= 0 ? freeLabel : iqd(amount, opts);
}

/** Prices shown to customers are rounded to the city step (250 IQD), half up, like the pricing engine. */
export function roundToStep(amount: number, step = 250): number {
  if (step <= 0) return whole(amount);
  return whole(Math.round(amount / step) * step);
}
