/**
 * Arabic count forms (voice guide: counts read naturally): 1 → "مطعم واحد", 2 → "مطعمين", 3–10 →
 * "4 مطاعم", 11+ (and 0) → "12 مطعم". A counted key `x` has `x_one`, `x_two`, `x_few` siblings and
 * `x` itself is the 11+ form.
 */
export type ArPlural = 'one' | 'two' | 'few' | 'many';

export function arPlural(n: number): ArPlural {
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  const r = n % 100;
  if (r >= 3 && r <= 10) return 'few';
  return 'many';
}

/** The key for `n` of a counted message (`list.count` → `list.count_few` for 4). */
export function countKey<K extends string>(base: K, n: number): K | `${K}_one` | `${K}_two` | `${K}_few` {
  const form = arPlural(n);
  return form === 'many' ? base : (`${base}_${form}` as const);
}
