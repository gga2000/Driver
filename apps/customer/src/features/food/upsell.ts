import type { MenuItem } from '@driver/contracts';
import type { CartState } from './cart';
import { canQuickAdd } from './modifiers';

/** Sections a same-kitchen upsell draws from first: drinks, sides, bread. */
const UPSELL_SECTIONS = /مشروب|مقبلات|شوربة|خبز|سلط/;

/** Up to six quick-add dishes from the same kitchen that aren't in the cart yet, sides and drinks first. */
export function upsellItems(categories: ReadonlyArray<{ name: string; items: MenuItem[] }>, cart: CartState): MenuItem[] {
  const inCart = new Set(cart.lines.map((l) => l.itemId));
  const pick = (preferred: boolean) =>
    categories
      .filter((c) => UPSELL_SECTIONS.test(c.name) === preferred)
      .flatMap((c) => c.items)
      .filter((i) => canQuickAdd(i) && !inCart.has(i.id));
  return [...pick(true), ...pick(false).sort((a, b) => a.priceIqd - b.priceIqd)].slice(0, 6);
}

