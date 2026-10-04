import { foldArabic } from '@driver/contracts';

/** Search screen logic (audit C-01), pure so it is tested. Matching itself is the server's (`catalog.search`). */

export const MAX_RECENTS = 8;

/** A new search on top; the same words spelled another way ("التكة" / "تكه") replace the older one. */
export function pushRecent(recents: readonly string[], query: string): string[] {
  const q = query.trim().replace(/\s+/g, ' ');
  const key = foldArabic(q);
  if (!key) return [...recents];
  return [q, ...recents.filter((r) => foldArabic(r) !== key)].slice(0, MAX_RECENTS);
}

/**
 * "الناس تدور على" chips from the live catalog: the words of the kitchens' cuisine lines
 * ("كباب · تكة · كبد"), most kitchens first, then by first appearance. Real menu words only, so every
 * chip finds something.
 */
export function popularTerms(cuisineLines: readonly string[], max = 8): string[] {
  const counts = new Map<string, { term: string; n: number; first: number }>();
  let i = 0;
  for (const line of cuisineLines) {
    for (const part of line.split(/[·،,]/)) {
      const term = part.trim();
      const key = foldArabic(term);
      if (!key) continue;
      const prior = counts.get(key);
      if (prior) prior.n += 1;
      else counts.set(key, { term, n: 1, first: i++ });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .slice(0, max)
    .map((c) => c.term);
}

/** Wait this long after the last keystroke before asking the server. */
export const SEARCH_DEBOUNCE_MS = 250;
