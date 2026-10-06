import type { HouseholdMemberView, Serves } from '@driver/contracts';
import { ME, TABLE, foldName, type CartPerson } from './cart';

/**
 * «سفرة العائلة» (joy o5, audit F-11 / F-12 / S-2) as plain data: who the «لمنو؟» chips offer —
 * the table, me, the household already set up in the account, then people used before — and which
 * one a dish starts on. Nothing here invents a person; a household member becomes a cart person only
 * when picked.
 */

export type PersonChip =
  | { id: typeof TABLE; kind: 'table' }
  | { id: typeof ME; kind: 'me' }
  /** A saved/cart person (their id is the cart's). */
  | { id: string; kind: 'person'; name: string; phone: string | null }
  /** A household member not yet used on a cart: picking one saves them by name. */
  | { id: string; kind: 'household'; name: string };

/** Household chip ids are `hh_<personId>` until picked. */
export const HOUSEHOLD_PREFIX = 'hh_';

/**
 * The chips in order: «للسفرة» (family mode only), أنا, every household member other than me (by
 * name; one already saved shows as that saved person), then the other saved people. Names match
 * folded (ة/ه, أ/ا…), so «منار» is never offered twice.
 */
export function personChips(input: { household: readonly Pick<HouseholdMemberView, 'personId' | 'name' | 'isMe'>[]; saved: readonly CartPerson[]; family: boolean }): PersonChip[] {
  const out: PersonChip[] = [];
  if (input.family) out.push({ id: TABLE, kind: 'table' });
  out.push({ id: ME, kind: 'me' });
  const used = new Set<string>();
  for (const m of input.household) {
    const name = m.name?.trim();
    if (m.isMe || !name || used.has(foldName(name))) continue;
    used.add(foldName(name));
    const saved = input.saved.find((p) => foldName(p.name) === foldName(name));
    out.push(saved ? { id: saved.id, kind: 'person', name: saved.name, phone: saved.phone } : { id: `${HOUSEHOLD_PREFIX}${m.personId}`, kind: 'household', name });
  }
  for (const p of input.saved) {
    if (used.has(foldName(p.name))) continue;
    used.add(foldName(p.name));
    out.push({ id: p.id, kind: 'person', name: p.name, phone: p.phone });
  }
  return out;
}

/**
 * Family mode: the person orders for others — a household with someone else in it, people already
 * on this cart, or shared dishes already on it.
 */
export function isFamilyOrder(input: { household: readonly Pick<HouseholdMemberView, 'isMe'>[]; cartPeople: number; tableLines: number }): boolean {
  return input.household.some((m) => !m.isMe) || input.cartPeople > 0 || input.tableLines > 0;
}

/** Where a dish starts in «لمنو؟»: «للسفرة» when it feeds two or more and this is a family order; else me. */
export function defaultPersonFor(serves: Serves | null, family: boolean): string {
  return family && serves !== null && serves.max >= 2 ? TABLE : ME;
}
