/**
 * Moving a cart to another kitchen after a rejection (customer spec §3, joy o15): which dish on the
 * other menu is "the same" and which of its choices carry over. One rule for the app (that moves the
 * cart) and the API (that says up front how much of it moves and what it costs there), so the card's
 * «كل أصنافك موجودة» is exactly what «انقل سلتي لهنا» does.
 */

/** Arabic name folding for matching dishes across kitchens (harakat, أ/إ/آ, ة, ى, brackets, spaces). */
export function foldDishName(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s: string): Set<string> {
  return new Set(
    foldDishName(s)
      .split(' ')
      .map((w) => w.replace(/^ال/, ''))
      .filter((w) => w.length > 1),
  );
}

/** The target menu's closest dish by name: exact (folded) first, then most shared words (≥ half). */
export function matchDish<T extends { name: string }>(name: string, items: readonly T[]): T | null {
  const folded = foldDishName(name);
  const exact = items.find((i) => foldDishName(i.name) === folded);
  if (exact) return exact;
  const want = words(name);
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const have = words(item.name);
    const shared = [...want].filter((w) => have.has(w)).length;
    const score = shared / Math.max(want.size, have.size, 1);
    if (shared > 0 && score >= 0.5 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}

interface CarryGroup<M> {
  id: string;
  min: number;
  max: number;
  modifiers: readonly M[];
}

/**
 * The target dish's choices that match the line's chosen ones by name (available only, at most each
 * group's max); null when a required group cannot be filled — that dish does not carry over.
 */
export function carryModifierPicks<M extends { name: string; available: boolean }>(chosenNames: readonly string[], groups: readonly CarryGroup<M>[]): Array<{ groupId: string; modifier: M }> | null {
  const want = new Set(chosenNames.map(foldDishName));
  const out: Array<{ groupId: string; modifier: M }> = [];
  for (const group of groups) {
    const picked = group.modifiers.filter((m) => m.available && want.has(foldDishName(m.name))).slice(0, group.max);
    if (picked.length < group.min) return null;
    for (const m of picked) out.push({ groupId: group.id, modifier: m });
  }
  return out;
}

/**
 * Kitchens to suggest after a rejection: open ones other than the one that said no, most shared
 * cuisine tags first, then the quickest to the door, then the best rated.
 */
export function similarKitchens<C extends { id: string; tags: readonly string[]; open: boolean; pickup: unknown; etaMinMinutes: number | null; prepMinMinutes: number; rating: { avg: number } | null }>(
  rejected: { id: string; tags: readonly string[] },
  cards: readonly C[],
  count = 2,
): C[] {
  const want = new Set(rejected.tags);
  const shared = (c: C) => c.tags.filter((t) => want.has(t)).length;
  return cards
    .filter((c) => c.id !== rejected.id && c.open && c.pickup !== null)
    .sort((a, b) => shared(b) - shared(a) || (a.etaMinMinutes ?? a.prepMinMinutes) - (b.etaMinMinutes ?? b.prepMinMinutes) || (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0))
    .slice(0, count);
}
