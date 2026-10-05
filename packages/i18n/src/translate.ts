import arIQ from './locales/ar-IQ.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };

export const locales = { 'ar-IQ': arIQ, en } as const;
export type Locale = keyof typeof locales;
export type MessageKey = keyof typeof arIQ;

export const DEFAULT_LOCALE: Locale = 'ar-IQ';

export type Params = Record<string, string | number>;

/** Whether a key exists (in Arabic, the source of truth). */
export function hasKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(locales['ar-IQ'], key);
}

/** `{name}` interpolation; unknown params stay visible (`{minutes}`) so QA catches them. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`));
}

/** The counted placeholder of a phrase: the first `{param}` followed by an Arabic word ("{n} طلب"). */
export function countParamOf(template: string): string | null {
  const m = /\{(\w+)\}\s+(?=[؀-ۿ])/.exec(template);
  return m ? m[1]! : null;
}

/** A param as a count: 3, "3", "1,500" and "⁦12⁩" all read as numbers; anything else is null. */
export function asCount(v: string | number | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const digits = v.replace(/[\u2066-\u2069,\s]/g, '');
  return /^-?\d+$/.test(digits) ? Number(digits) : null;
}

/** CLDR Arabic categories, by count (see plural.ts for the forms). */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export function pluralCategory(count: number): PluralCategory {
  const n = Math.abs(Math.trunc(count));
  if (n === 0) return 'zero';
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  const r = n % 100;
  if (r >= 3 && r <= 10) return 'few';
  if (r >= 11 && r <= 99) return 'many';
  return 'other';
}

/** Which suffixes to try for a category, most specific first. */
export const PLURAL_FALLBACK: Record<PluralCategory, readonly string[]> = {
  zero: ['_zero', '_many', '_other'],
  one: ['_one', '_other'],
  two: ['_two', '_few', '_other'],
  few: ['_few', '_other'],
  many: ['_many', '_other'],
  other: ['_other', '_many'],
};

/**
 * Plural-aware key choice (audit S-17): a key with `_one` and `_few` siblings is a counted phrase,
 * so `t('list.count', { n: 2 })` reads "مطعمين" and `{ n: 5 }` "5 مطاعم" with no change at the call
 * site. The count is the phrase's counted placeholder (`countParamOf`); the base key is the 11+ form.
 */
export function resolvePlural(key: string, template: string, params: Params | undefined, exists: (k: string) => boolean): string {
  if (!params || !exists(`${key}_one`) || !exists(`${key}_few`)) return key;
  const p = countParamOf(template);
  const n = p ? asCount(params[p]) : null;
  if (n === null) return key;
  for (const suffix of PLURAL_FALLBACK[pluralCategory(n)]) if (exists(key + suffix)) return key + suffix;
  return key;
}

/**
 * Interpolates `{name}` placeholders. Unknown keys fall back to Arabic, then to the key itself,
 * so a missing translation never crashes a screen. Counted phrases pick their plural form.
 */
export function t(key: MessageKey, params?: Params, locale: Locale = DEFAULT_LOCALE): string {
  const table: Record<string, string> = locales[locale];
  const ar = locales['ar-IQ'] as Record<string, string>;
  const base = ar[key];
  const k = base !== undefined ? resolvePlural(key, base, params, hasKey) : key;
  const template = table[k] ?? ar[k] ?? key;
  return interpolate(template, params);
}
