/**
 * Arabic number agreement (audit S-17). Iraqi speech: طلب واحد · طلبين · 3 طلبات (3–10) · 11 طلب
 * (11–99) · 100 طلب. Keys carry the form as a suffix: `x_one`, `x_two`, `x_few`, `x_many`, and
 * optionally `x_zero` ("ماكو طلبات") and `x_other` (100, 101, 102 …). A missing form falls back
 * along a fixed chain, so a key set of just `_one`/`_few`/`_many` is enough.
 *
 * The voice spec's exception stays: minutes are "{n} دقيقة" for every count, so `time.minutes`
 * has no plural forms.
 */
import { hasKey, locales, PLURAL_FALLBACK, pluralCategory, t, type Locale, type MessageKey, type Params } from './translate.js';

export { PLURAL_FALLBACK, pluralCategory, type PluralCategory } from './translate.js';

/** Base names of every key that has plural forms (`partner.jobs` for `partner.jobs_one`, …). */
export type PluralBase = MessageKey extends infer K ? (K extends `${infer B}_one` ? B : never) : never;

/**
 * The key to use for `count` among `base_*`, checked with `exists` (so the merchant app can pass its
 * own table). Falls back to `base` itself when no suffixed form exists.
 */
export function pluralKeyIn(base: string, count: number, exists: (key: string) => boolean): string {
  for (const suffix of PLURAL_FALLBACK[pluralCategory(count)]) {
    if (exists(base + suffix)) return base + suffix;
  }
  return base;
}

/** The shared-table key for `count`: `pluralKey('partner.jobs', 2)` → `partner.jobs_two` (or `_few`). */
export function pluralKey(base: PluralBase, count: number): MessageKey {
  return pluralKeyIn(base, count, hasKey) as MessageKey;
}

/**
 * Translate a counted phrase: `tp('merchant.items', 2)` → "صنفين", `tp(…, 5)` → "5 أصناف".
 * `{n}` and `{count}` are filled with the count unless `params` sets them.
 */
export function tp(base: PluralBase, count: number, params?: Params, locale: Locale = 'ar-IQ'): string {
  return t(pluralKey(base, count), { n: count, count, ...params }, locale);
}

/** Every plural family in the shared table must have at least `_one`, `_few` and `_many`. */
export function pluralFamilies(table: Record<string, string> = locales['ar-IQ']): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const k of Object.keys(table)) {
    const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(k);
    if (!m) continue;
    const set = out.get(m[1]!) ?? new Set<string>();
    set.add(m[2]!);
    out.set(m[1]!, set);
  }
  return out;
}
