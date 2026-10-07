import { tooClose, type Spot } from '@/features/ride/logic';

/** What the phone's position came back as (`useMyLocationSpot().locate()`). */
export type HereResult = { spot: Spot; weak: boolean } | 'denied' | 'none' | 'outside';

/**
 * «رجعني للبيت» in simple mode, one decision: no saved home → ask for it first; a good fix away from
 * home → the choose screen with pickup = here and drop-off = home (one confirm); already at home →
 * say so; no good fix (refused, none, weak, outside Aziziyah) → the where-to screen with home already
 * set, asking where to pick him up. Same rules as home's ride card (`RideHomeCard`), except the
 * pickup is always where he is, never the deliver-to place.
 */
export type GoHomeStep =
  | { kind: 'set_home' }
  | { kind: 'book'; pickup: Spot; home: Spot }
  | { kind: 'at_home' }
  | { kind: 'ask_pickup'; home: Spot };

export function goHomeStep(home: Spot | null, here: HereResult): GoHomeStep {
  if (!home) return { kind: 'set_home' };
  if (typeof here !== 'object') return { kind: 'ask_pickup', home };
  if (tooClose(here.spot, home)) return { kind: 'at_home' };
  if (here.weak) return { kind: 'ask_pickup', home };
  return { kind: 'book', pickup: here.spot, home };
}

/** The saved home among the rider's places (his own or one shared by the household). */
export function homeOf(saved: readonly Spot[]): Spot | null {
  return saved.find((s) => s.savedLabel === 'home') ?? null;
}
