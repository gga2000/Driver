import type { MenuCategory, MenuItem, MenuModifierGroup } from '@driver/contracts';
import type { CartModifier } from '@/features/food/cart';
import { motifForDish, type Motif } from '@/features/food/food-art';

/**
 * «اختارلي» and «ضيوف جايين؟» (Ali's Yes on k10 and s2, 2026-10-07): a whole tray from one shop in a
 * couple of taps. You say how many people (and, for a meal, a rough budget and what you feel like);
 * the tray comes back with each piece, how many it feeds and the menu price, and any piece can be
 * swapped for another of the same kind. Nothing is invented: only dishes on the menu, available now,
 * in versions the kitchen sells; a dish that needs a choice we can't make for you (flavours, sauce)
 * is left out. The kitchen's own «يشبّع» numbers decide the portions; where it said nothing, one main
 * dish is one person. Prices are the menu's and the cart total is the server's, as always.
 */

export type TrayRole = 'main' | 'side' | 'drink' | 'sweet';

const DRINK: ReadonlySet<Motif> = new Set(['tea', 'laban', 'water', 'can', 'juice', 'coffee', 'dallah', 'iced', 'pomegranate', 'lemonade', 'bananamilk', 'cocktail']);
const SWEET: ReadonlySet<Motif> = new Set(['sweet', 'baklava', 'zalabia', 'kleicha', 'cake', 'icecream']);
const SIDE: ReadonlySet<Motif> = new Set(['bread', 'salad', 'pickles', 'hummus', 'soup']);
const SIDE_SECTION = /مقبلات|شوربة|خبز|سلط|إضافات|اضافات/;

export function roleOf(item: Pick<MenuItem, 'name'>, section: string): TrayRole {
  const m = motifForDish(item.name, section);
  if (DRINK.has(m)) return 'drink';
  if (SWEET.has(m)) return 'sweet';
  if (SIDE.has(m) || SIDE_SECTION.test(section)) return 'side';
  return 'main';
}

/** What a meal tray leans to («شنو جوّك؟»): the dish drawings each mood takes. */
export const TRAY_MOODS = ['grill', 'chicken', 'home', 'quick'] as const;
export type TrayMood = (typeof TRAY_MOODS)[number];
const MOOD: Readonly<Record<TrayMood, ReadonlySet<Motif>>> = {
  grill: new Set(['kebab', 'tikka', 'liver', 'tray', 'plate']),
  chicken: new Set(['chicken']),
  home: new Set(['rice', 'okra', 'beans', 'dolma', 'kubba', 'fish', 'pacha']),
  quick: new Set(['shawarma', 'falafel', 'wrap']),
};

/** Rough budget per person («تقريباً للشخص»): the tray keeps each serving under it. Null = no limit. */
export const TRAY_BUDGETS = [4000, 7000, null] as const;
export type TrayBudget = (typeof TRAY_BUDGETS)[number];

export interface TrayVersion {
  modifiers: CartModifier[];
  /** One of this version: base price + its options. */
  priceIqd: number;
  /** How many one of it feeds (the kitchen's range, read conservatively). */
  serves: number;
  /** The version's own name when there is one («نص كيلو»). */
  label: string | null;
}

export interface TrayLine {
  item: MenuItem;
  role: TrayRole;
  version: TrayVersion;
  qty: number;
  /** The people this line is meant to cover (a swap keeps it). */
  share: number;
}

export interface Tray {
  lines: TrayLine[];
  /** Menu prices × quantities (the server prices the cart again; this is what the menu says). */
  totalIqd: number;
  /** How many the tray feeds by the kitchen's numbers. */
  serves: number;
  /** Nothing fitted the budget, so the cheapest servings were used. */
  overBudget: boolean;
  /** Nothing matched the mood, so the tray took from the whole menu. */
  moodIgnored: boolean;
  /** Guests: this shop has no sweets but ice cream, so another shop's tray should come first. */
  fallback?: boolean;
}

/** A range read conservatively: «يشبّع 2–3» is 2, «4–6» is 5 (the middle, rounded down). */
function servesOf(range: { min: number; max: number } | null | undefined): number | null {
  return range ? Math.max(1, Math.floor((range.min + range.max) / 2)) : null;
}

/** A required group we may choose in: the dish's version (size, weight). Anything else needs the person. */
const choosable = (g: MenuModifierGroup) => !g.required || g.variant;

/** The versions of a dish we can put on a tray without asking anything, with how many each feeds. */
export function versionsOf(item: MenuItem, role: TrayRole): TrayVersion[] {
  if (!item.available || !item.modifierGroups.every(choosable)) return [];
  const fallback = servesOf(item.serves) ?? (role === 'side' ? 2 : 1);
  const variant = item.modifierGroups.find((g) => g.variant);
  if (!variant) return [{ modifiers: [], priceIqd: item.priceIqd, serves: fallback, label: null }];
  return variant.modifiers
    .filter((m) => m.available)
    .map((m) => ({
      modifiers: [{ groupId: variant.id, modifierId: m.id, name: m.name, priceIqd: m.priceIqd }],
      priceIqd: item.priceIqd + m.priceIqd,
      serves: servesOf(m.serves) ?? fallback,
      label: m.name,
    }));
}

interface Candidate {
  item: MenuItem;
  role: TrayRole;
  versions: TrayVersion[];
}

export function candidates(categories: readonly MenuCategory[]): Candidate[] {
  return categories.flatMap((c) =>
    c.items.map((item) => {
      const role = roleOf(item, c.name);
      return { item, role, versions: versionsOf(item, role) };
    }),
  ).filter((c) => c.versions.length > 0);
}

/**
 * The version (and how many of it) that covers `share` people: the fewest pieces (one نص كيلو, not two
 * ربع), then the least left over, then the least money.
 */
function fit(versions: readonly TrayVersion[], share: number): { version: TrayVersion; qty: number } {
  let best: { version: TrayVersion; qty: number; waste: number; cost: number } | null = null;
  for (const v of versions) {
    const qty = Math.max(1, Math.ceil(share / v.serves));
    const waste = qty * v.serves - share;
    const cost = qty * v.priceIqd;
    if (!best || qty < best.qty || (qty === best.qty && (waste < best.waste || (waste === best.waste && cost < best.cost)))) best = { version: v, qty, waste, cost };
  }
  return { version: best!.version, qty: best!.qty };
}

const perServing = (v: TrayVersion) => v.priceIqd / v.serves;

/** Splits `n` people into `k` shares as evenly as possible, bigger shares first (8 into 3 → 3, 3, 2). */
export function shares(n: number, k: number): number[] {
  const parts = Math.max(1, Math.min(k, n));
  return Array.from({ length: parts }, (_, i) => Math.floor(n / parts) + (i < n % parts ? 1 : 0));
}

function total(lines: readonly TrayLine[]): number {
  return lines.reduce((s, l) => s + l.version.priceIqd * l.qty, 0);
}

function fed(lines: readonly TrayLine[], role: TrayRole): number {
  return lines.filter((l) => l.role === role).reduce((s, l) => s + l.version.serves * l.qty, 0);
}

/**
 * A meal for `people` from one kitchen: up to three different main dishes sharing the people between
 * them (the kitchen's trays and kilos first when they fit, «للسفرة»), a side for every three people
 * and a drink each, as long as the budget allows. Mains whose servings cost more than the budget are
 * skipped; if none is left, the cheapest are used and the tray says so.
 */
export function mealTray(categories: readonly MenuCategory[], opts: { people: number; budget: TrayBudget; mood: TrayMood | null }): Tray | null {
  const people = Math.max(1, Math.min(30, Math.round(opts.people)));
  const all = candidates(categories);
  const mains = all.filter((c) => c.role === 'main');
  if (mains.length === 0) return null;
  const moodMains = opts.mood ? mains.filter((c) => MOOD[opts.mood!].has(motifForDish(c.item.name))) : mains;
  const moodIgnored = opts.mood !== null && moodMains.length === 0;
  const pool = moodIgnored ? mains : moodMains;
  const affordable = opts.budget === null ? pool : pool.map((c) => ({ ...c, versions: c.versions.filter((v) => perServing(v) <= opts.budget!) })).filter((c) => c.versions.length > 0);
  const overBudget = affordable.length === 0;
  const usable = overBudget ? pool : affordable;
  // Different dishes first (a kebab, a chicken, a rice before a second kebab), in the kitchen's own menu order.
  const seen = new Set<Motif>();
  const distinct: Candidate[] = [];
  const again: Candidate[] = [];
  for (const c of usable) {
    const m = motifForDish(c.item.name);
    if (seen.has(m)) again.push(c);
    else {
      seen.add(m);
      distinct.push(c);
    }
  }
  const ordered = [...distinct, ...again];
  const kinds = Math.min(ordered.length, people >= 5 ? 3 : people >= 2 ? 2 : 1);
  const lines: TrayLine[] = shares(people, kinds).map((share, i) => {
    const c = ordered[i]!;
    const { version, qty } = fit(c.versions, share);
    return { item: c.item, role: 'main', version, qty, share };
  });
  const cap = opts.budget === null ? Infinity : opts.budget * people;
  const extras = (role: TrayRole, count: number) => {
    const pool2 = all.filter((c) => c.role === role).sort((a, b) => Math.min(...a.versions.map((v) => v.priceIqd)) - Math.min(...b.versions.map((v) => v.priceIqd)));
    for (let i = 0; i < count && pool2.length > 0; i++) {
      const c = pool2[i % pool2.length]!;
      const version = [...c.versions].sort((a, b) => a.priceIqd - b.priceIqd)[0]!;
      if (total(lines) + version.priceIqd > cap) return;
      const same = lines.find((l) => l.item.id === c.item.id && l.version === version);
      if (same) same.qty += 1;
      else lines.push({ item: c.item, role, version, qty: 1, share: 1 });
    }
  };
  extras('side', Math.ceil(people / 3));
  extras('drink', people);
  return { lines, totalIqd: total(lines), serves: fed(lines, 'main'), overBudget: overBudget && opts.budget !== null, moodIgnored };
}

/**
 * «ضيوف جايين؟»: sweets for `guests` from one shop. Two kinds from four guests, three from ten, the
 * guests shared between them; sweets sold by weight first (a guest tray is ربع، نص، كيلو), each in the
 * weight that covers its share with the least left over. Ice cream only when the shop has nothing else.
 */
export function guestTray(categories: readonly MenuCategory[], guests: number): Tray | null {
  const n = Math.max(2, Math.min(60, Math.round(guests)));
  const sweets = candidates(categories).filter((c) => c.role === 'sweet');
  const notIce = sweets.filter((c) => motifForDish(c.item.name) !== 'icecream');
  const pool = notIce.length > 0 ? notIce : sweets;
  if (pool.length === 0) return null;
  const byWeight = (c: Candidate) => (c.versions.length > 1 ? 0 : 1);
  const ordered = [...pool].sort((a, b) => byWeight(a) - byWeight(b));
  const kinds = Math.min(ordered.length, n >= 10 ? 3 : n >= 4 ? 2 : 1);
  const lines: TrayLine[] = shares(n, kinds).map((share, i) => {
    const c = ordered[i]!;
    const { version, qty } = fit(c.versions, share);
    return { item: c.item, role: 'sweet', version, qty, share };
  });
  return { lines, totalIqd: total(lines), serves: fed(lines, 'sweet'), overBudget: false, moodIgnored: false, fallback: notIce.length === 0 };
}

/**
 * «بدّل»: the next dish of the same kind not already on the tray (menu order, wrapping round), fitted to
 * the same share of people. The same tray back when there is nothing else to offer.
 */
export function swapLine(tray: Tray, index: number, categories: readonly MenuCategory[]): Tray {
  const line = tray.lines[index];
  if (!line) return tray;
  const pool = candidates(categories).filter((c) => c.role === line.role);
  const taken = new Set(tray.lines.map((l) => l.item.id));
  const from = pool.findIndex((c) => c.item.id === line.item.id);
  for (let step = 1; step <= pool.length; step++) {
    const c = pool[(from + step + pool.length) % pool.length]!;
    if (taken.has(c.item.id)) continue;
    const { version, qty } = line.role === 'main' || line.role === 'sweet' ? fit(c.versions, line.share) : { version: [...c.versions].sort((a, b) => a.priceIqd - b.priceIqd)[0]!, qty: line.qty };
    const lines = tray.lines.map((l, i) => (i === index ? { item: c.item, role: line.role, version, qty, share: line.share } : l));
    return { ...tray, lines, totalIqd: total(lines), serves: fed(lines, line.role === 'sweet' ? 'sweet' : 'main') || tray.serves };
  }
  return tray;
}
