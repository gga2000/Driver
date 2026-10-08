import { draftKey, type DraftGroup, type MenuGroupLike } from './logic';

/**
 * k2 / k3 · Sold by weight (ربع · نص · كيلو) or by size (صغير · وسط · كبير). The kitchen types one full
 * price per weight or size; underneath it is an ordinary dish: its price is the smallest one and a
 * required «الوزن» / «الحجم» choice adds the difference, so customers, tickets and the server's price
 * check work as they do today. Pure, unit-tested.
 *
 * The names are menu data the customer reads (always Arabic, like every dish name), not app copy.
 */
export type TierKind = 'weight' | 'size';

export const TIER_GROUP: Record<TierKind, string> = { weight: 'الوزن', size: 'الحجم' };
export const TIER_NAMES: Record<TierKind, readonly string[]> = {
  weight: ['ربع', 'نص', 'كيلو'],
  size: ['صغير', 'وسط', 'كبير'],
};

export interface Tier {
  name: string;
  /** The full price of this weight or size, in IQD. */
  priceIqd: number;
}

export interface Tiers {
  kind: TierKind;
  /** Cheapest first. */
  tiers: Tier[];
}

function kindOfGroup(g: Pick<MenuGroupLike, 'nameAr' | 'minSelect' | 'maxSelect'>): TierKind | null {
  if (g.minSelect !== 1 || g.maxSelect !== 1) return null;
  const name = g.nameAr.trim();
  if (name === TIER_GROUP.weight) return 'weight';
  if (name === TIER_GROUP.size) return 'size';
  return null;
}

/** The dish's weights or sizes with their full prices, or null when it is sold one way. */
export function tiersOf(item: { priceIqd: number; modifierGroups: readonly MenuGroupLike[] }): Tiers | null {
  for (const g of item.modifierGroups) {
    const kind = kindOfGroup(g);
    if (!kind) continue;
    const tiers = g.modifiers.filter((m) => m.available).map((m) => ({ name: m.nameAr, priceIqd: item.priceIqd + m.priceIqd }));
    if (tiers.length < 2) return null;
    return { kind, tiers: tiers.sort((a, b) => a.priceIqd - b.priceIqd) };
  }
  return null;
}

/** Same, from the editor's draft groups (a new dish before it is saved). */
export function draftTiersOf(basePrice: number | null, groups: readonly DraftGroup[]): Tiers | null {
  if (basePrice === null) return null;
  return tiersOf({
    priceIqd: basePrice,
    modifierGroups: groups.map((g) => ({ ...g, modifiers: g.modifiers.map((m) => ({ nameAr: m.nameAr, priceIqd: Number(m.price) || 0, available: m.available })) })),
  });
}

/** The template a kitchen starts from: the three names, prices empty. */
export function tierTemplate(kind: TierKind): Array<{ name: string; price: string }> {
  return TIER_NAMES[kind].map((name) => ({ name, price: '' }));
}

export type TierProblem = 'too_few' | 'name' | 'same_name';

/** What is wrong with the weights or sizes as typed (empty = fine). Rows with no price are left out. */
export function tierProblems(tiers: readonly Tier[]): TierProblem[] {
  const out: TierProblem[] = [];
  if (tiers.length < 2) out.push('too_few');
  if (tiers.some((t) => !t.name.trim())) out.push('name');
  if (new Set(tiers.map((t) => t.name.trim())).size !== tiers.length) out.push('same_name');
  return out;
}

/**
 * The dish's price and option groups for these weights or sizes: the price becomes the cheapest one, the
 * «الوزن» / «الحجم» group goes first (required, one pick) and replaces any earlier one; other groups
 * (extras, sauces) stay as they are.
 */
export function applyTiers(kind: TierKind, tiers: readonly Tier[], groups: readonly DraftGroup[]): { priceIqd: number; groups: DraftGroup[] } {
  const sorted = [...tiers].sort((a, b) => a.priceIqd - b.priceIqd);
  const priceIqd = sorted[0]?.priceIqd ?? 0;
  const group: DraftGroup = {
    key: draftKey('g'),
    nameAr: TIER_GROUP[kind],
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: sorted.map((t) => ({ key: draftKey('m'), nameAr: t.name.trim(), price: String(t.priceIqd - priceIqd), available: true })),
  };
  return { priceIqd, groups: [group, ...groups.filter((g) => !kindOfGroup(g))] };
}

/** Back to one price: the weight or size group goes, the price stays the cheapest one. */
export function dropTiers(groups: readonly DraftGroup[]): DraftGroup[] {
  return groups.filter((g) => !kindOfGroup(g));
}
