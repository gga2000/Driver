/**
 * Snap logic for the bottom sheet, kept free of Reanimated so it can be unit-tested. Positions
 * are visible heights in px (larger = more open). The gesture handler calls it as a worklet.
 */
export function snapTarget(height: number, velocityY: number, snaps: readonly number[]): number {
  'worklet';
  // Project ~120 ms ahead so a flick goes to the next detent instead of springing back.
  const projected = height - velocityY * 0.12;
  let best = snaps[0] ?? height;
  for (const s of snaps) if (Math.abs(s - projected) < Math.abs(best - projected)) best = s;
  return best;
}

/** Resolves fractional detents (0.4 = 40% of the container) to px, ascending. */
export function resolveSnaps(snaps: readonly number[], containerHeight: number): number[] {
  return snaps.map((s) => (s <= 1 ? Math.round(s * containerHeight) : s)).sort((a, b) => a - b);
}
