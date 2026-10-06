import type { DeliveryPoint, MenuCategory, MenuItem, RestaurantCard } from '@driver/contracts';

/**
 * The food cart as plain data (no React, no storage): one merchant per cart (edge-case review
 * A.11), lines tagged to people (domain §3), identical lines merged. `cart-store.ts` persists it and
 * exposes it to screens; everything here is unit-tested in Node.
 */

/** The orderer's own lines. Other people are `CartPerson.id`s. */
export const ME = 'me';
/**
 * «للسفرة» (joy o5, audit F-12): shared dishes for the whole table (the kilo, the mixed grill). They
 * belong to no one person, so their points go to the orderer — the rule for untagged lines.
 */
export const TABLE = 'table';

export interface CartModifier {
  groupId: string;
  modifierId: string;
  name: string;
  priceIqd: number;
}

export interface CartLine {
  /** Client key (stable while the line lives). */
  key: string;
  itemId: string;
  name: string;
  /** The menu's item price when added (the server re-prices and refuses a stale one). */
  basePriceIqd: number;
  modifiers: CartModifier[];
  qty: number;
  note: string | null;
  /** `ME` or a `CartPerson.id`. */
  personId: string;
}

/** Someone the order is partly for ("لمن؟"). Phone optional: with it their points reach them. */
export interface CartPerson {
  id: string;
  name: string;
  /** E.164 when given. */
  phone: string | null;
}

export interface CartMerchant {
  id: string;
  name: string;
  cityId: string;
  /** Kitchen point the delivery quote starts from. */
  pickup: DeliveryPoint | null;
  minOrderIqd: number;
}

export function cartMerchantOf(r: Pick<RestaurantCard, 'id' | 'name' | 'cityId' | 'pickup' | 'minOrderIqd'>): CartMerchant {
  return { id: r.id, name: r.name, cityId: r.cityId, pickup: r.pickup, minOrderIqd: r.minOrderIqd };
}

export interface CartState {
  merchant: CartMerchant | null;
  lines: CartLine[];
  /** People referenced by lines (kept with the cart so it is self-contained). */
  people: CartPerson[];
}

export const EMPTY_CART: CartState = { merchant: null, lines: [], people: [] };

export type NewCartLine = Omit<CartLine, 'key'>;

export function unitPrice(line: Pick<CartLine, 'basePriceIqd' | 'modifiers'>): number {
  return line.basePriceIqd + line.modifiers.reduce((s, m) => s + m.priceIqd, 0);
}

export function lineTotal(line: Pick<CartLine, 'basePriceIqd' | 'modifiers' | 'qty'>): number {
  return unitPrice(line) * line.qty;
}

export function itemsTotal(cart: Pick<CartState, 'lines'>): number {
  return cart.lines.reduce((s, l) => s + lineTotal(l), 0);
}

export function itemCount(cart: Pick<CartState, 'lines'>): number {
  return cart.lines.reduce((s, l) => s + l.qty, 0);
}

/** Two lines are the same dish when item, choices, person and note all match. */
export function lineSignature(l: Pick<CartLine, 'itemId' | 'modifiers' | 'personId' | 'note'>): string {
  const mods = l.modifiers.map((m) => m.modifierId).sort().join(',');
  return `${l.itemId}|${mods}|${l.personId}|${(l.note ?? '').trim()}`;
}

let seq = 0;
export function newLineKey(): string {
  seq += 1;
  return `l_${Date.now().toString(36)}_${seq}`;
}

export type AddResult =
  | { ok: true; cart: CartState; merged: boolean }
  /** The cart holds another merchant's food: ask before starting a new cart. */
  | { ok: false; reason: 'other_merchant'; current: CartMerchant };

const MAX_QTY = 99;

/**
 * Adds a line from `merchant`. Another merchant's cart is never mixed in: the caller asks the
 * person and passes `replace: true` to start a new cart. An identical line just gains quantity.
 */
export function addLine(cart: CartState, merchant: CartMerchant, line: NewCartLine, opts: { replace?: boolean; person?: CartPerson; key?: string } = {}): AddResult {
  let base = cart;
  if (cart.merchant && cart.merchant.id !== merchant.id && cart.lines.length > 0) {
    if (!opts.replace) return { ok: false, reason: 'other_merchant', current: cart.merchant };
    base = EMPTY_CART;
  }
  const people = opts.person && !base.people.some((p) => p.id === opts.person!.id) ? [...base.people, opts.person] : base.people;
  const sig = lineSignature(line);
  const existing = base.lines.find((l) => lineSignature(l) === sig);
  const lines = existing
    ? base.lines.map((l) => (l === existing ? { ...l, qty: Math.min(MAX_QTY, l.qty + line.qty), basePriceIqd: line.basePriceIqd, modifiers: line.modifiers } : l))
    : [...base.lines, { ...line, qty: Math.min(MAX_QTY, line.qty), key: opts.key ?? newLineKey() }];
  return { ok: true, cart: prunePeople({ merchant, lines, people }), merged: Boolean(existing) };
}

/** Quantity 0 removes the line. */
export function setQty(cart: CartState, key: string, qty: number): CartState {
  if (qty <= 0) return removeLine(cart, key);
  return { ...cart, lines: cart.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, qty) } : l)) };
}

export function removeLine(cart: CartState, key: string): CartState {
  const lines = cart.lines.filter((l) => l.key !== key);
  if (lines.length === 0) return EMPTY_CART;
  return prunePeople({ ...cart, lines });
}

/** Drops people no line points at any more. */
function prunePeople(cart: CartState): CartState {
  const used = new Set(cart.lines.map((l) => l.personId));
  return { ...cart, people: cart.people.filter((p) => used.has(p.id)) };
}

export interface PersonGroup {
  personId: string;
  /** Null for the orderer's own group (the screen says "إلي"). */
  person: CartPerson | null;
  lines: CartLine[];
  subtotalIqd: number;
}

/**
 * Lines by person for the cart (spec §3): «للسفرة» first (the shared dishes, joy o5), then the
 * orderer, then people in the order they were added. `grouped` is false when only one group is on
 * the order — the cart then lists lines flat.
 */
export function groupByPerson(cart: CartState): { grouped: boolean; groups: PersonGroup[] } {
  const ids = [...new Set(cart.lines.map((l) => l.personId))];
  const order = [TABLE, ME, ...cart.people.map((p) => p.id)].filter((id) => ids.includes(id));
  for (const id of ids) if (!order.includes(id)) order.push(id);
  const groups = order.map((personId) => {
    const lines = cart.lines.filter((l) => l.personId === personId);
    return { personId, person: personId === ME || personId === TABLE ? null : (cart.people.find((p) => p.id === personId) ?? null), lines, subtotalIqd: lines.reduce((s, l) => s + lineTotal(l), 0) };
  });
  return { grouped: groups.length > 1, groups };
}

/** IQD still missing to reach the merchant's minimum (0 when met). */
export function minOrderShortfall(cart: CartState): number {
  if (!cart.merchant) return 0;
  return Math.max(0, cart.merchant.minOrderIqd - itemsTotal(cart));
}

/** Arabic name folding for matching dishes across kitchens. */
export function foldName(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s: string): Set<string> {
  return new Set(
    foldName(s)
      .split(' ')
      .map((w) => w.replace(/^ال/, ''))
      .filter((w) => w.length > 1),
  );
}

/** The target menu's closest dish by name: exact (folded) first, then most shared words (≥ half). */
export function matchDish(name: string, items: readonly MenuItem[]): MenuItem | null {
  const folded = foldName(name);
  const exact = items.find((i) => foldName(i.name) === folded);
  if (exact) return exact;
  const want = words(name);
  let best: { item: MenuItem; score: number } | null = null;
  for (const item of items) {
    const have = words(item.name);
    const shared = [...want].filter((w) => have.has(w)).length;
    const score = shared / Math.max(want.size, have.size, 1);
    if (shared > 0 && score >= 0.5 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}

export interface CarryOverResult {
  cart: CartState;
  /** Names of the dishes moved and of those the other kitchen doesn't make. */
  moved: string[];
  dropped: string[];
}

/**
 * The rejection fallback (spec §3): moves a cart to another kitchen. Each line goes to the dish of
 * the same name there, keeping quantity, person and note; its choices carry over by name. A line is
 * dropped — never guessed — when the dish is missing or unavailable, or when a required choice has
 * no same-named option there.
 */
export function carryOver(cart: CartState, target: CartMerchant, categories: readonly MenuCategory[]): CarryOverResult {
  const items = categories.flatMap((c) => c.items);
  const moved: string[] = [];
  const dropped: string[] = [];
  let next: CartState = { merchant: target, lines: [], people: [] };
  for (const line of cart.lines) {
    const dish = matchDish(line.name, items);
    const modifiers = dish?.available ? carryModifiers(line, dish) : null;
    if (!dish || !modifiers) {
      dropped.push(line.name);
      continue;
    }
    const person = cart.people.find((p) => p.id === line.personId);
    const res = addLine(
      next,
      target,
      { itemId: dish.id, name: dish.name, basePriceIqd: dish.priceIqd, modifiers, qty: line.qty, note: line.note, personId: line.personId },
      person ? { person } : {},
    );
    if (res.ok) {
      next = res.cart;
      moved.push(dish.name);
    }
  }
  return { cart: next.lines.length ? next : EMPTY_CART, moved, dropped };
}

function carryModifiers(line: CartLine, dish: MenuItem): CartModifier[] | null {
  const out: CartModifier[] = [];
  for (const group of dish.modifierGroups) {
    const picked = group.modifiers.filter((m) => m.available && line.modifiers.some((lm) => foldName(lm.name) === foldName(m.name))).slice(0, group.max);
    if (picked.length < group.min) return null;
    for (const m of picked) out.push({ groupId: group.id, modifierId: m.id, name: m.name, priceIqd: m.priceIqd });
  }
  return out;
}

export interface ReconcileResult {
  cart: CartState;
  /** Lines removed because the dish or a chosen option is gone or unavailable. */
  removed: string[];
  /** Lines whose price moved to the menu's current one. */
  repriced: string[];
}

/**
 * After `price_changed` / `catalog_item_unavailable`: re-reads every line against the current menu
 * so the person sees the new total before confirming again (never a silent change at the server).
 */
export function reconcile(cart: CartState, categories: readonly MenuCategory[]): ReconcileResult {
  const items = new Map(categories.flatMap((c) => c.items).map((i) => [i.id, i]));
  const removed: string[] = [];
  const repriced: string[] = [];
  const lines: CartLine[] = [];
  for (const l of cart.lines) {
    const item = items.get(l.itemId);
    if (!item || !item.available) {
      removed.push(l.name);
      continue;
    }
    let ok = true;
    const modifiers = l.modifiers.map((m) => {
      const mod = item.modifierGroups.find((g) => g.id === m.groupId)?.modifiers.find((x) => x.id === m.modifierId);
      if (!mod || !mod.available) ok = false;
      return mod ? { ...m, name: mod.name, priceIqd: mod.priceIqd } : m;
    });
    if (!ok) {
      removed.push(l.name);
      continue;
    }
    const next = { ...l, basePriceIqd: item.priceIqd, modifiers };
    if (unitPrice(next) !== unitPrice(l)) repriced.push(l.name);
    lines.push(next);
  }
  return { cart: lines.length ? prunePeople({ ...cart, lines }) : EMPTY_CART, removed, repriced };
}
