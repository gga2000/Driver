import type { MenuItem } from '@driver/contracts';
import type { CartState } from './cart';
import { canQuickAdd } from './modifiers';

/** Menu sections a same-kitchen upsell draws sides from: starters, soup, bread, salad. */
const SIDE_SECTIONS = /مقبلات|شوربة|خبز|سلط/;
/** Drinks, by section or by name (a kitchen without a drinks section still sells بيبسي). */
const DRINK_SECTION = /مشروب/;
const DRINK_NAME = /بيبسي|ببسي|كولا|سفن|ماي|عصير|ليمون|لبن|شنينة|چاي|شاي/;

const UPSELL_MAX = 6;

/**
 * Up to six quick-add dishes from the same kitchen for the cart's rail (UI/UX audit F-15), never one
 * already in the cart:
 * 1. below the minimum (`shortIqd` > 0): the dishes that close the gap in one add, the closest first;
 * 2. then drinks when the cart has none (and first of all when nothing closes the gap);
 * 3. then sides (starters, soup, bread, salad), then the rest, cheapest first.
 */
export function upsellItems(categories: ReadonlyArray<{ name: string; items: MenuItem[] }>, cart: CartState, shortIqd = 0): MenuItem[] {
  const inCart = new Set(cart.lines.map((l) => l.itemId));
  const all = categories.flatMap((c) => c.items.map((item) => ({ item, drink: DRINK_SECTION.test(c.name) || DRINK_NAME.test(item.name), side: SIDE_SECTIONS.test(c.name) })));
  const drinkIds = new Set(all.filter((a) => a.drink).map((a) => a.item.id));
  const hasDrink = cart.lines.some((l) => drinkIds.has(l.itemId) || DRINK_NAME.test(l.name));
  const candidates = all.filter((a) => canQuickAdd(a.item) && !inCart.has(a.item.id));
  const byPrice = (a: { item: MenuItem }, b: { item: MenuItem }) => a.item.priceIqd - b.item.priceIqd;

  const closers = shortIqd > 0 ? candidates.filter((a) => !a.drink && a.item.priceIqd >= shortIqd).sort(byPrice) : [];
  const drinks = hasDrink ? [] : candidates.filter((a) => a.drink);
  const sides = candidates.filter((a) => a.side && !a.drink);
  const rest = candidates.filter((a) => !a.side && !a.drink).sort(byPrice);
  const ordered = [...closers, ...drinks, ...sides, ...rest, ...(hasDrink ? candidates.filter((a) => a.drink) : [])];
  const seen = new Set<string>();
  const out: MenuItem[] = [];
  for (const { item } of ordered) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length === UPSELL_MAX) break;
  }
  return out;
}
