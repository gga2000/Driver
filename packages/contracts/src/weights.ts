import { foldArabic } from './search.js';

/**
 * Sweets by weight (Ali's Yes on s1 and m2, 2026-10-07): كنافة، بقلاوة، زلابية، كليچة are bought by
 * the quarter, the half or the kilo. A shop already sells them that way through a variant group
 * («الكمية: ربع كيلو · نص كيلو · كيلو», each option adding to the base price), so nothing new is
 * stored: this reads the weights out of the menu the server already prices. Pure, shared by the API
 * (the kilo price on search and craving cards) and the customer app (the ربع · نص · كيلو picker).
 */

export const WEIGHT_STEPS = ['quarter', 'half', 'kilo'] as const;
export type WeightStep = (typeof WEIGHT_STEPS)[number];

/** The weight an option's name says, or null («ربع كيلو», «نص كيلو», «نصف كيلو», «كيلو», «1 كيلو», «كيلو واحد»). */
export function weightOf(name: string): WeightStep | null {
  const words = foldArabic(name).split(' ');
  const kilo = words.some((w) => w === 'كيلو' || w === 'كغم' || w === 'كيلوغرام');
  if (words.includes('ربع')) return kilo || words.length === 1 ? 'quarter' : null;
  if (words.includes('نص') || words.includes('نصف')) return kilo || words.length === 1 ? 'half' : null;
  if (!kilo) return null;
  // «كيلو», «1 كيلو», «كيلو واحد»; not «2 كيلو» (a tray, not the kilo price).
  return words.every((w) => w === 'كيلو' || w === 'كغم' || w === 'كيلوغرام' || w === '1' || w === 'واحد') ? 'kilo' : null;
}

interface GroupLike {
  id: string;
  variant: boolean;
  modifiers: ReadonlyArray<{ id: string; name: string; priceIqd: number; available: boolean }>;
}

export interface WeightOption {
  step: WeightStep;
  groupId: string;
  modifierId: string;
  /** The option as the shop wrote it («نص كيلو»). */
  name: string;
  /** What the option adds to the base price. */
  addIqd: number;
  /** The full price of this weight (base + option). */
  priceIqd: number;
  available: boolean;
}

/**
 * The dish's weights, lightest first, when it is sold by weight: a variant group with at least two
 * options that name a weight. Null otherwise (a size, a flavour, a dish sold by the piece).
 */
export function weightOptions(item: { priceIqd: number; modifierGroups: readonly GroupLike[] }): WeightOption[] | null {
  for (const g of item.modifierGroups) {
    if (!g.variant) continue;
    const found = g.modifiers
      .map((m) => ({ m, step: weightOf(m.name) }))
      .filter((x): x is { m: (typeof g.modifiers)[number]; step: WeightStep } => x.step !== null);
    const steps = new Set(found.map((f) => f.step));
    if (steps.size < 2) continue;
    return WEIGHT_STEPS.flatMap((step) => {
      const f = found.find((x) => x.step === step);
      return f ? [{ step, groupId: g.id, modifierId: f.m.id, name: f.m.name, addIqd: f.m.priceIqd, priceIqd: item.priceIqd + f.m.priceIqd, available: f.m.available }] : [];
    });
  }
  return null;
}

/** The price of one kilo of a dish sold by weight (the shop's «الكيلو»), or null. */
export function kiloPriceOf(item: { priceIqd: number; modifierGroups: readonly GroupLike[] }): number | null {
  return weightOptions(item)?.find((w) => w.step === 'kilo')?.priceIqd ?? null;
}
