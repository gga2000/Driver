import type { BoardSeat, DepartureCard } from '@driver/contracts';

/**
 * Seats that fit you (joy r1, audit R-03). The board is read with the rider's remembered «تسافر:»
 * choice, so the API marks every free seat this rider can't take (`blocked`: the gender rule's
 * adjacency, or a family-only car). A tile then says whether a seat is left *for you*, instead of
 * "one seat left" that turns out to be the middle seat between two men three taps later.
 */
export type SeatFit =
  | { kind: 'fits'; n: number }
  /** Free seats exist, none of them for this rider; `reason` is the first blocked seat's. */
  | { kind: 'none_fit'; free: number; reason: NonNullable<BoardSeat['blocked']> }
  | { kind: 'full' };

export function seatFit(dep: Pick<DepartureCard, 'seats'>): SeatFit {
  const free = dep.seats.filter((s) => s.state === 'free');
  if (free.length === 0) return { kind: 'full' };
  const forYou = free.filter((s) => s.blocked === null);
  if (forYou.length > 0) return { kind: 'fits', n: forYou.length };
  return { kind: 'none_fit', free: free.length, reason: free.find((s) => s.blocked !== null)?.blocked ?? 'adjacency' };
}

