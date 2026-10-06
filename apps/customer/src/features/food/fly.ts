import type { CartLine, CartState } from './cart';

/**
 * «لقمة تطير» (joy o1, audit F-03 / S-1) as plain maths: the dish's arc from its card to the cart
 * bar's count bubble, how it shrinks and turns on the way, and which dishes the living bar stacks.
 * `FlyToCart.tsx` runs it as one overlay node, transforms only.
 */

export interface Point {
  x: number;
  y: number;
}

/** The flight: 420 ms, an ease-out cubic, arcing this far above the straight line's midpoint. */
export const FLIGHT_MS = 420;
export const FLIGHT_LIFT = 120;
/** The dish lands at about a third of its size (a 96 px thumbnail → a 34 px bubble). */
export const FLIGHT_END_SCALE = 0.35;
/** A slight turn as it flies (degrees). */
export const FLIGHT_TURN = -12;

/** A point on the quadratic arc at `t` (0…1): control point `lift` px above the midpoint. */
export function flightPoint(from: Point, to: Point, t: number, lift: number = FLIGHT_LIFT): Point {
  'worklet';
  const cx = (from.x + to.x) / 2;
  const cy = Math.min(from.y, to.y) - lift;
  const u = 1 - t;
  return { x: u * u * from.x + 2 * u * t * cx + t * t * to.x, y: u * u * from.y + 2 * u * t * cy + t * t * to.y };
}

/** Size along the way: 1 at the card, `FLIGHT_END_SCALE` at the bubble. */
export function flightScale(t: number): number {
  'worklet';
  return 1 + (FLIGHT_END_SCALE - 1) * t;
}

/** The newest dishes in the cart, one per dish, newest first (the bar's thumbnail stack). */
export function stackThumbs(cart: Pick<CartState, 'lines'>, max = 3): CartLine[] {
  const seen = new Set<string>();
  const out: CartLine[] = [];
  for (let i = cart.lines.length - 1; i >= 0 && out.length < max; i--) {
    const l = cart.lines[i]!;
    if (seen.has(l.itemId)) continue;
    seen.add(l.itemId);
    out.push(l);
  }
  return out;
}
