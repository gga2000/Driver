/** A service's door in «وعدنا هم» at the end of home. */
export type DoorId = 'carts' | 'parcel';

export interface DoorFacts {
  /** طرود has opened in the city (`parcel` in the season's launched services). */
  parcel: boolean;
  /** The carts list, once read: whether carts have launched in the city and how many are open now. */
  carts: { launched: boolean; open: number } | null;
}

/**
 * The doors home shows, in look D's order (Ali, 2026-10-11): the carts card while any cart is open
 * (Ali chose "Both" for where customers find carts, 2026-10-12), then طرود once it has opened (Ali:
 * "switch it on", 2026-10-12). None at all → no «وعدنا هم» heading either.
 */
export function liveDoors(f: DoorFacts): DoorId[] {
  const doors: DoorId[] = [];
  if (f.carts?.launched && f.carts.open > 0) doors.push('carts');
  if (f.parcel) doors.push('parcel');
  return doors;
}
