/**
 * «صورنا» (Ali, 2026-10-08): a dish with no photo can take one from Driver's own library of Iraqi dishes
 * (34 dishes, 2–3 photos each). Pure, tested: which library dishes fit a dish's name, best first.
 */

export type LibrarySection = 'grill' | 'rice' | 'breakfast' | 'fast' | 'sweets' | 'drinks';

export const LIBRARY_SECTIONS: readonly LibrarySection[] = ['grill', 'rice', 'breakfast', 'fast', 'sweets', 'drinks'];

export interface LibraryDishLike {
  slug: string;
  nameAr: string;
  words: readonly string[];
  section: LibrarySection;
}

/** Spellings people mix up written one way: گ/ك, چ/ج, پ/ب, ة/ه, ى/ي, hamza forms, «ال», tatweel. */
export function normaliseAr(text: string): string {
  return text
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[گك]/g, 'ك')
    .replace(/[چج]/g, 'ج')
    .replace(/پ/g, 'ب')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))
    .filter(Boolean)
    .join(' ');
}

/**
 * Library dishes whose words appear in the dish's name (and section), best first: a word in the name
 * beats one only in the section, and a longer match beats a shorter one («تكة دجاج» → tikka and
 * chicken, tikka first because it comes first in the name).
 */
export function libraryMatches<D extends LibraryDishLike>(library: readonly D[], name: string, section?: string | null): D[] {
  const inName = normaliseAr(name);
  const inSection = normaliseAr(section ?? '');
  const scored: { dish: D; score: number }[] = [];
  for (const dish of library) {
    let best = 0;
    for (const w of dish.words) {
      const word = normaliseAr(w);
      if (!word) continue;
      const at = ` ${inName} `.indexOf(` ${word}`);
      if (at >= 0) best = Math.max(best, 1000 - at + word.length);
      else if (inSection && ` ${inSection} `.includes(` ${word}`)) best = Math.max(best, 100 + word.length);
    }
    if (best > 0) scored.push({ dish, score: best });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.dish);
}
