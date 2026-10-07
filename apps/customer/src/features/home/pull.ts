/**
 * Home's tea pull to refresh as plain maths (`TeaPull.tsx` runs it on the UI thread): how far the
 * page follows the finger and where letting go refreshes.
 */

/** Let go past this much pull (px) and home refreshes; the istikan is full here. */
export const PULL_AT = 64;
/** While it refreshes the page stays this far down, the full glass steaming in the gap. */
export const PULL_HOLD = 64;

/** The finger's travel → how far the page moves: half as far at first, then a quarter as freely past the line. */
export function pullDistance(dy: number): number {
  'worklet';
  if (dy <= 0) return 0;
  const r = dy * 0.5;
  return r <= PULL_AT ? r : PULL_AT + (r - PULL_AT) * 0.25;
}
