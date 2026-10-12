import type { AdminMenuItem } from '@driver/contracts';
import { parseDelta, parsePrice } from '@/features/menu/logic';

/**
 * A cart's dish as its owner writes it (Ali 2026-10-12: "full freedom of what he can add"): any name,
 * a price, a photo if he has one, one line about it, sizes each with its own full price («نص 1,500 ·
 * كامل 2,500»), and extras with what they add («بيض +500», «حار» for nothing). Stored as a menu item:
 * sizes are a required pick-one group priced from the cheapest size, extras an optional pick-any group.
 * Free of React so the mapping can be tested.
 */
export interface DraftRow {
  key: string;
  name: string;
  /** What he typed: a full price for a size, what it adds for an extra. */
  price: string;
}

export interface CartDraft {
  name: string;
  about: string;
  /** The price when there are no sizes. */
  price: string;
  sizes: DraftRow[];
  extras: DraftRow[];
}

let seq = 0;
export const rowKey = () => `r${++seq}`;
export const emptyRow = (): DraftRow => ({ key: rowKey(), name: '', price: '' });

export const emptyDraft = (): CartDraft => ({ name: '', about: '', price: '', sizes: [], extras: [] });

/** Sizes are the required pick-one group; extras the first group that isn't. */
const isSizes = (g: AdminMenuItem['modifierGroups'][number]) => g.required && g.maxSelect === 1;

export function draftOf(item: AdminMenuItem): CartDraft {
  const sizes = item.modifierGroups.find(isSizes);
  const extras = item.modifierGroups.find((g) => !isSizes(g));
  return {
    name: item.nameAr,
    about: item.description ?? '',
    price: String(item.priceIqd),
    sizes: sizes ? sizes.modifiers.map((m) => ({ key: rowKey(), name: m.nameAr, price: String(item.priceIqd + m.priceIqd) })) : [],
    extras: extras ? extras.modifiers.map((m) => ({ key: rowKey(), name: m.nameAr, price: m.priceIqd ? String(m.priceIqd) : '' })) : [],
  };
}

export type DraftProblem = 'name' | 'price' | 'sizes' | 'size_row' | 'extra_row';

/** Rows he left completely empty don't count. */
const filled = (rows: readonly DraftRow[]) => rows.filter((r) => r.name.trim() !== '' || r.price.trim() !== '');

export function draftProblems(d: CartDraft): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!d.name.trim()) out.push('name');
  const sizes = filled(d.sizes);
  if (sizes.length === 0 && parsePrice(d.price) === null) out.push('price');
  if (sizes.length === 1) out.push('sizes');
  if (sizes.some((r) => !r.name.trim() || parsePrice(r.price) === null)) out.push('size_row');
  if (filled(d.extras).some((r) => !r.name.trim() || parseDelta(r.price) === null)) out.push('extra_row');
  return out;
}

type SaveModifier = { nameAr: string; nameEn?: string | null; priceIqd: number; available: boolean; servesMin?: number | null; servesMax?: number | null };
type SaveGroup = { nameAr: string; nameEn?: string | null; minSelect: number; maxSelect: number; required: boolean; modifiers: SaveModifier[] };

export interface CartItemSave {
  nameAr: string;
  description: string | null;
  priceIqd: number;
  groups: SaveGroup[];
}

type AdminGroup = AdminMenuItem['modifierGroups'][number];

/** An option he switched off stays off when the dish is saved again (matched by its name in that group). */
const wasOn = (g: AdminGroup | undefined, name: string) => g?.modifiers.find((m) => m.nameAr === name)?.available ?? true;

/** A group the cart editor doesn't show (set up on the full menu screen) is saved back as it was. */
const keep = (g: AdminGroup): SaveGroup => ({
  nameAr: g.nameAr,
  nameEn: g.nameEn,
  minSelect: g.minSelect,
  maxSelect: g.maxSelect,
  required: g.required,
  modifiers: g.modifiers.map((m) => ({ nameAr: m.nameAr, nameEn: m.nameEn, priceIqd: m.priceIqd, available: m.available, servesMin: m.servesMin ?? null, servesMax: m.servesMax ?? null })),
});

/**
 * The menu calls for a draft with no problems. `names` are the groups' names in the owner's language;
 * `prev` is the dish as it was, so switched-off options and groups this editor doesn't show survive.
 */
export function toSave(d: CartDraft, names: { sizes: string; extras: string }, prev?: Pick<AdminMenuItem, 'modifierGroups'>): CartItemSave {
  const prevSizes = prev?.modifierGroups.find(isSizes);
  const prevExtras = prev?.modifierGroups.find((g) => !isSizes(g));
  const sizes = filled(d.sizes).map((r) => ({ name: r.name.trim(), price: parsePrice(r.price)! }));
  const extras = filled(d.extras).map((r) => ({ name: r.name.trim(), price: parseDelta(r.price) ?? 0 }));
  const base = sizes.length > 1 ? Math.min(...sizes.map((s) => s.price)) : parsePrice(d.price)!;
  const groups: SaveGroup[] = [];
  if (sizes.length > 1) groups.push({ nameAr: names.sizes, minSelect: 1, maxSelect: 1, required: true, modifiers: sizes.map((s) => ({ nameAr: s.name, priceIqd: s.price - base, available: wasOn(prevSizes, s.name) })) });
  if (extras.length > 0) groups.push({ nameAr: names.extras, minSelect: 0, maxSelect: extras.length, required: false, modifiers: extras.map((e) => ({ nameAr: e.name, priceIqd: e.price, available: wasOn(prevExtras, e.name) })) });
  for (const g of prev?.modifierGroups ?? []) if (g !== prevSizes && g !== prevExtras) groups.push(keep(g));
  return { nameAr: d.name.trim(), description: d.about.trim() || null, priceIqd: base, groups };
}

/** «1,500 دينار» or «من 1,500» for a dish with sizes. */
export function startsAt(item: Pick<AdminMenuItem, 'priceIqd' | 'modifierGroups'>): { from: boolean; priceIqd: number } {
  return { from: item.modifierGroups.some(isSizes), priceIqd: item.priceIqd };
}
