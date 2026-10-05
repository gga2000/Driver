import type { MenuCategory, MenuItem, Order, OrderHistoryItem, RestaurantCard } from '@driver/contracts';
import { addLine, cartMerchantOf, EMPTY_CART, ME, unitPrice, type CartModifier, type CartPerson, type CartState } from '@/features/food/cart';

/**
 * "اطلبه مرة ثانية" (audit C-15) as plain data: an old order's lines rebuilt into a fresh cart from
 * the restaurant's menu as it is NOW — today's prices and today's availability, never the old ones
 * (the server prices the cart again at the quote and at placement). Nothing is guessed: a dish that
 * left the menu, ran out, or lost a choice it needs is not added, and the person is told which and
 * why. Optional extras that are gone are dropped from their dish and listed too.
 */

export type ReorderMissReason = 'gone' | 'sold_out' | 'schedule' | 'choice_gone';

export interface ReorderMiss {
  name: string;
  qty: number;
  reason: ReorderMissReason;
}

export interface ReorderRepriced {
  name: string;
  /** Unit price (dish + choices) on the old order and on today's menu. */
  wasIqd: number;
  nowIqd: number;
}

export interface ReorderResult {
  cart: CartState;
  /** Dishes put back in the cart (names as the menu has them today). */
  added: string[];
  missing: ReorderMiss[];
  repriced: ReorderRepriced[];
  /** Optional extras no longer offered, dropped from the dish ("لفة تكة: بدون جبن"). */
  droppedExtras: Array<{ dish: string; extra: string }>;
  /** The kitchen is closed right now (the cart is still built; the menu says when it opens). */
  closed: boolean;
  opensAt: string | null;
}

interface StoredModifier {
  groupId: string;
  modifierId: string;
  priceIqd: number;
}

/** Order lines keep their choices as `{groupId, modifierId, priceIqd}` (what checkout sends). */
function storedModifiers(raw: readonly unknown[]): StoredModifier[] {
  const out: StoredModifier[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    if (typeof r.groupId === 'string' && typeof r.modifierId === 'string') out.push({ groupId: r.groupId, modifierId: r.modifierId, priceIqd: typeof r.priceIqd === 'number' ? r.priceIqd : 0 });
  }
  return out;
}

/** The person a line was for: a saved person with the participant's name (keeps his phone), else a new one. */
function personFor(participantId: string | null, order: Pick<Order, 'participants'>, saved: readonly CartPerson[]): CartPerson | null {
  if (!participantId) return null;
  const label = order.participants.find((p) => p.id === participantId)?.label?.trim();
  if (!label) return null;
  return saved.find((p) => p.name.trim() === label) ?? { id: `pp_re_${participantId}`, name: label, phone: null };
}

function missReason(item: MenuItem | undefined): ReorderMissReason | null {
  if (!item) return 'gone';
  if (item.available) return null;
  return item.unavailableReason === 'schedule' ? 'schedule' : 'sold_out';
}

export function buildReorderCart(input: {
  order: Pick<Order, 'lines' | 'participants'>;
  /** History names for the old lines (what to call a dish that left the menu). */
  items: readonly Pick<OrderHistoryItem, 'lineId' | 'name'>[];
  menu: { restaurant: Pick<RestaurantCard, 'id' | 'name' | 'cityId' | 'pickup' | 'minOrderIqd' | 'open' | 'opensAt'>; categories: readonly MenuCategory[] };
  savedPeople?: readonly CartPerson[];
}): ReorderResult {
  const { order, menu } = input;
  const merchant = cartMerchantOf(menu.restaurant);
  const byId = new Map(menu.categories.flatMap((c) => c.items).map((i) => [i.id, i]));
  const oldName = new Map(input.items.map((i) => [i.lineId, i.name]));
  const result: ReorderResult = { cart: EMPTY_CART, added: [], missing: [], repriced: [], droppedExtras: [], closed: !menu.restaurant.open, opensAt: menu.restaurant.opensAt };
  let cart: CartState = EMPTY_CART;

  for (const line of order.lines) {
    if (line.availability === 'removed') continue;
    const item = line.catalogItemId ? byId.get(line.catalogItemId) : undefined;
    const name = item?.name ?? oldName.get(line.id) ?? line.freeText ?? '';
    const qty = Math.max(1, line.qty);
    // Free-text lines (errands) have no menu dish to bring back.
    const reason = line.catalogItemId ? missReason(item) : 'gone';
    if (reason || !item) {
      if (name) result.missing.push({ name, qty, reason: reason ?? 'gone' });
      continue;
    }

    const modifiers: CartModifier[] = [];
    const old = storedModifiers(line.modifiers);
    for (const m of old) {
      const group = item.modifierGroups.find((g) => g.id === m.groupId);
      const mod = group?.modifiers.find((x) => x.id === m.modifierId);
      if (group && mod && mod.available) modifiers.push({ groupId: group.id, modifierId: mod.id, name: mod.name, priceIqd: mod.priceIqd });
      else if (group && mod) result.droppedExtras.push({ dish: item.name, extra: mod.name });
      else result.droppedExtras.push({ dish: item.name, extra: '' });
    }
    // Every group still needs its minimum (a required bread that is gone, or a choice the menu added).
    const short = item.modifierGroups.some((g) => modifiers.filter((m) => m.groupId === g.id).length < g.min);
    if (short) {
      // The extras listed for this dish were part of why; the dish itself is what is missing.
      result.droppedExtras = result.droppedExtras.filter((d) => d.dish !== item.name);
      result.missing.push({ name: item.name, qty, reason: 'choice_gone' });
      continue;
    }

    const was = line.unitPriceIqd + old.reduce((s, m) => s + m.priceIqd, 0);
    const now = unitPrice({ basePriceIqd: item.priceIqd, modifiers });
    if (was !== now && !result.repriced.some((r) => r.name === item.name)) result.repriced.push({ name: item.name, wasIqd: was, nowIqd: now });

    const person = personFor(line.participantId, order, input.savedPeople ?? []);
    const res = addLine(cart, merchant, { itemId: item.id, name: item.name, basePriceIqd: item.priceIqd, modifiers, qty, note: line.note, personId: person?.id ?? ME }, person ? { person } : {});
    if (res.ok) {
      cart = res.cart;
      result.added.push(item.name);
    }
  }
  // An extra with no name (its group or option left the menu entirely) is not worth a line of its own.
  result.droppedExtras = result.droppedExtras.filter((d) => d.extra !== '');
  result.cart = cart.lines.length > 0 ? cart : EMPTY_CART;
  return result;
}

/** Nothing to explain: every dish came back at the same price, the kitchen is open. */
export function reorderIsClean(r: ReorderResult): boolean {
  return r.cart.lines.length > 0 && r.missing.length === 0 && r.repriced.length === 0 && r.droppedExtras.length === 0 && !r.closed;
}

/** "2× تمن وبامية، حمص، 2× لبن أربيل" (at most `max` dishes, then "…"), counts as on the order screen. */
export function itemsSummary(items: readonly Pick<OrderHistoryItem, 'name' | 'qty'>[], max = 3): string {
  const shown = items.slice(0, max).map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name));
  return items.length > max ? `${shown.join('، ')}…` : shown.join('، ');
}
