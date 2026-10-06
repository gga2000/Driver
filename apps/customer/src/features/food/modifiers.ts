import type { MenuItem, MenuModifierGroup } from '@driver/contracts';
import type { CartModifier } from './cart';

/**
 * Item-sheet choices (variants and modifier chips) as plain data: group id → chosen modifier ids.
 * Enforces each group's required/min/max the same way the server does (`modifier_invalid`), so the
 * add button only lights up for a line the server will accept.
 */
export type Selection = Record<string, string[]>;

/** Variants open on their first available option (the plain version); everything else starts empty. */
export function defaultSelection(item: MenuItem): Selection {
  const sel: Selection = {};
  for (const g of item.modifierGroups) {
    const first = g.modifiers.find((m) => m.available);
    sel[g.id] = g.variant && first ? [first.id] : [];
  }
  return sel;
}

export type ToggleResult = { selection: Selection; blocked: null } | { selection: Selection; blocked: 'max' | 'unavailable' };

/**
 * One tap on a chip. Single-choice groups switch to the tapped option (a required one can't be
 * emptied); multi-choice groups add or remove, and refuse past `max` (the sheet says why).
 */
export function toggleModifier(item: MenuItem, selection: Selection, groupId: string, modifierId: string): ToggleResult {
  const group = item.modifierGroups.find((g) => g.id === groupId);
  const mod = group?.modifiers.find((m) => m.id === modifierId);
  if (!group || !mod) return { selection, blocked: null };
  if (!mod.available) return { selection, blocked: 'unavailable' };
  const current = selection[groupId] ?? [];
  const has = current.includes(modifierId);
  let next: string[];
  if (group.max === 1) {
    if (has) next = group.min >= 1 ? current : [];
    else next = [modifierId];
  } else if (has) {
    next = current.filter((id) => id !== modifierId);
  } else {
    if (current.length >= group.max) return { selection, blocked: 'max' };
    next = [...current, modifierId];
  }
  return { selection: { ...selection, [groupId]: next }, blocked: null };
}

export interface GroupProblem {
  groupId: string;
  name: string;
  problem: 'too_few' | 'too_many';
}

/** Groups whose choice count is outside [min, max] (or that point at a missing option). */
export function selectionProblems(item: MenuItem, selection: Selection): GroupProblem[] {
  const out: GroupProblem[] = [];
  for (const g of item.modifierGroups) {
    const ids = (selection[g.id] ?? []).filter((id) => g.modifiers.some((m) => m.id === id && m.available));
    if (ids.length < g.min) out.push({ groupId: g.id, name: g.name, problem: 'too_few' });
    else if (ids.length > g.max) out.push({ groupId: g.id, name: g.name, problem: 'too_many' });
  }
  return out;
}

/**
 * What the sheet's main button does (joy o4, audit F-10): add the dish; or, when the only thing missing
 * is a required choice, stay pressable as «اختار {group}» and take the person to that group; or stay
 * disabled (kitchen closed, sold out, too many picked — the chips already say so).
 */
export type SheetCta = { kind: 'add' } | { kind: 'choose'; groupId: string; name: string } | { kind: 'blocked' };

export function sheetCta(problems: readonly GroupProblem[], orderable: boolean): SheetCta {
  if (!orderable) return { kind: 'blocked' };
  if (problems.length === 0) return { kind: 'add' };
  const missing = problems.find((p) => p.problem === 'too_few');
  if (missing && problems.every((p) => p.problem === 'too_few')) return { kind: 'choose', groupId: missing.groupId, name: missing.name };
  return { kind: 'blocked' };
}

export function isSelectionValid(item: MenuItem, selection: Selection): boolean {
  return selectionProblems(item, selection).length === 0;
}

/** The chosen modifiers in menu order, as cart lines carry them. */
export function chosenModifiers(item: MenuItem, selection: Selection): CartModifier[] {
  const out: CartModifier[] = [];
  for (const g of item.modifierGroups) {
    const ids = selection[g.id] ?? [];
    for (const m of g.modifiers) if (ids.includes(m.id)) out.push({ groupId: g.id, modifierId: m.id, name: m.name, priceIqd: m.priceIqd });
  }
  return out;
}

/** Live line price on the sheet's button: (item + chosen deltas) × quantity. */
export function sheetLinePrice(item: MenuItem, selection: Selection, qty: number): number {
  return (item.priceIqd + chosenModifiers(item, selection).reduce((s, m) => s + m.priceIqd, 0)) * qty;
}

/** One-tap add from the dish card: only when no group needs a choice. */
export function canQuickAdd(item: MenuItem): boolean {
  return item.available && item.modifierGroups.every((g) => g.min === 0);
}

/** "From" price for a dish card: the cheapest valid version (variants included). */
export function fromPrice(item: MenuItem): { amount: number; varies: boolean } {
  const variantDeltas = item.modifierGroups
    .filter((g: MenuModifierGroup) => g.min > 0)
    .map((g) => Math.min(...g.modifiers.filter((m) => m.available).map((m) => m.priceIqd), Number.POSITIVE_INFINITY));
  const min = item.priceIqd + variantDeltas.reduce((s, d) => s + (Number.isFinite(d) ? d : 0), 0);
  const varies = item.modifierGroups.some((g) => g.variant);
  return { amount: min, varies };
}
