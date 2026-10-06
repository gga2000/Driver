import type { MenuItem, Serves } from '@driver/contracts';
import { formatRange, type Locale } from '@driver/i18n';
import type { Selection } from './modifiers';

/**
 * Portions (joy o3, audit F-09): how many a dish feeds, in the kitchen's own numbers — never guessed.
 * «لشخص واحد», «يشبّع 2», «يشبّع 2–3» (the range low to high in Arabic reading order).
 */
export type ServesCopy = { key: 'item.serves_one' } | { key: 'item.serves_n'; params: { n: number } } | { key: 'item.serves_range'; params: { range: string } };

export function servesCopy(serves: Serves | null | undefined, locale: Locale = 'ar-IQ'): ServesCopy | null {
  if (!serves) return null;
  if (serves.min === serves.max) return serves.min === 1 ? { key: 'item.serves_one' } : { key: 'item.serves_n', params: { n: serves.min } };
  return { key: 'item.serves_range', params: { range: formatRange(serves.min, serves.max, locale) } };
}

/**
 * How many the dish as chosen feeds: the picked version's own number (a variant says it), else the
 * dish's. Null when the kitchen said nothing.
 */
export function servesChosen(item: Pick<MenuItem, 'serves' | 'modifierGroups'>, selection: Selection): Serves | null {
  for (const g of item.modifierGroups) {
    if (!g.variant) continue;
    const picked = g.modifiers.find((m) => (selection[g.id] ?? []).includes(m.id));
    if (picked?.serves) return picked.serves;
  }
  return item.serves ?? null;
}
