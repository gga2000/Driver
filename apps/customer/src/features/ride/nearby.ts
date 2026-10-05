import type { NearbyVehicles } from '@driver/contracts';
import { distanceM } from '@/features/track/geo';

/** A vehicle within this distance of one in the last set is the same one: it glides, it does not blink. */
export const NEARBY_MATCH_M = 300;

type Vehicle = NearbyVehicles['vehicles'][number];

/** One free vehicle on the map, under a key that lives as long as we believe it is the same one. */
export interface NearbySlot extends Vehicle {
  key: string;
}

/**
 * The server sends no ids (maps program c10: nobody can be followed), so consecutive refreshes are
 * matched here: closest pairs first, each old vehicle used once, nothing further than
 * `NEARBY_MATCH_M`. A matched one keeps its key (the map glides it); a new one gets `newKey()`
 * (it fades in); an old one left unmatched is gone (it fades out).
 */
export function matchVehicles(prev: readonly NearbySlot[], next: readonly Vehicle[], newKey: () => string): NearbySlot[] {
  const pairs: Array<{ i: number; j: number; d: number }> = [];
  next.forEach((n, j) => {
    prev.forEach((p, i) => {
      const d = distanceM(p, n);
      if (d <= NEARBY_MATCH_M) pairs.push({ i, j, d });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  const usedPrev = new Set<number>();
  const keyOf = new Map<number, string>();
  for (const { i, j } of pairs) {
    if (usedPrev.has(i) || keyOf.has(j)) continue;
    usedPrev.add(i);
    keyOf.set(j, prev[i]!.key);
  }
  return next.map((n, j) => ({ ...n, key: keyOf.get(j) ?? newKey() }));
}
