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

/**
 * The faster board (joy r7, audit R-05): cars a rider can still book stay as tiles; full cars, and
 * cars with nothing left for this rider, fold into one short line each at the bottom of their
 * garage, so a full car never holds the top slot. `asked`: the rider said who travels (r1).
 */
export function foldBoard<T extends Pick<DepartureCard, 'seats'> & { fill: Pick<DepartureCard['fill'], 'free'> }>(departures: readonly T[], asked: boolean): { open: T[]; folded: T[] } {
  const open: T[] = [];
  const folded: T[] = [];
  for (const d of departures) {
    const gone = d.fill.free <= 0 || (asked && seatFit(d).kind !== 'fits');
    (gone ? folded : open).push(d);
  }
  return { open, folded };
}

