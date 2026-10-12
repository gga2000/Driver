import type { Theme } from '@driver/ui';

/**
 * The carts' own colour (food carts thread, 2026-10-11): fuchsia, clear of home cooks' pomegranate and
 * the tuktuk's plum. Solid only: no pale pink wash (it read too close to home cooks' blush side by
 * side), so chips are the page's cream with a fuchsia dot. Fill and ink come from the `services.carts`
 * token; the ring is the bright awning fuchsia in both schemes.
 */
export interface CartPalette {
  /** Buttons, the open ring, the selected state. */
  fill: string;
  /** Text and icons on `fill`. */
  on: string;
  /** Fuchsia text on the page (open chips, prices that are the cart's). */
  text: string;
  /** The open dot and ring around a followed cart's photo. */
  ring: string;
}

const RING = '#F25CC0';

export function cartPalette(theme: Pick<Theme, 'services'>): CartPalette {
  const c = theme.services.carts;
  return { fill: c.fill, on: c.on, text: c.card.dot, ring: RING };
}
