import type {
  IntercityRow,
  IntercitySeatId,
  IntercitySeatLayout,
  TravellingAs,
} from '@driver/contracts';

/**
 * Seat maps per vehicle (decisions §9: saloon 4, SUV 6, van 7) and the travelling-as adjacency rule.
 * Same physical layout as `@driver/ui`'s SeatMap (rows from the front; left / centre / right).
 * Pure: no storage, no clock.
 */

type Cell = IntercitySeatId | null;

/** Passenger rows (the driver's row holds only `front`). */
export const SEAT_ROWS: Record<
  IntercitySeatLayout,
  Array<{ row: IntercityRow | 'front'; cells: [Cell, Cell, Cell] }>
> = {
  4: [
    { row: 'front', cells: [null, null, 'front'] },
    { row: 'back', cells: ['back_left', 'back_middle', 'back_right'] },
  ],
  6: [
    { row: 'front', cells: [null, null, 'front'] },
    { row: 'middle', cells: ['middle_left', null, 'middle_right'] },
    { row: 'rear', cells: ['rear_left', 'rear_middle', 'rear_right'] },
  ],
  7: [
    { row: 'front', cells: [null, null, 'front'] },
    { row: 'middle', cells: ['middle_left', 'middle_middle', 'middle_right'] },
    { row: 'rear', cells: ['rear_left', 'rear_middle', 'rear_right'] },
  ],
};

export function seatsOf(layout: IntercitySeatLayout): IntercitySeatId[] {
  return SEAT_ROWS[layout].flatMap((r) => r.cells.filter((c): c is IntercitySeatId => c !== null));
}

/** Seats of a bookable row ("book the row"); null when the layout has no such row. */
export function rowSeats(layout: IntercitySeatLayout, row: IntercityRow): IntercitySeatId[] | null {
  const r = SEAT_ROWS[layout].find((x) => x.row === row);
  return r ? r.cells.filter((c): c is IntercitySeatId => c !== null) : null;
}

export function hasFrontSeat(layout: IntercitySeatLayout): boolean {
  return seatsOf(layout).includes('front');
}

/** Who sits where, as the adjacency rule sees it. `travellingAs: null` = a walk-up with no declaration. */
export interface Occupant {
  seatId: IntercitySeatId;
  /** Booking id (or `walkup:<seat>`): seats of one group are never strangers to each other. */
  groupId: string;
  travellingAs: TravellingAs | null;
}

/**
 * Is `neighbour` "of the other declaration" for a lone rider declared `rider`? A woman is never put
 * between two male strangers and vice-versa (decisions §9). An undeclared walk-up counts as male
 * next to a woman (the conservative reading); a family declaration is neither.
 */
function isOther(rider: TravellingAs | null, neighbour: TravellingAs | null): boolean {
  if (rider === 'nisa') return neighbour === 'rijal' || neighbour === null;
  if (rider === 'rijal') return neighbour === 'nisa';
  return false;
}

/**
 * The first middle seat whose occupant sits alone between two strangers of the other declaration,
 * or null. Checked on the whole car after every change (a hold, a walk-up, a move), so the rule
 * holds whichever seat was sold last.
 */
export function adjacencyViolation(
  layout: IntercitySeatLayout,
  occupants: readonly Occupant[],
): IntercitySeatId | null {
  const at = new Map(occupants.map((o) => [o.seatId, o]));
  for (const { cells } of SEAT_ROWS[layout]) {
    const [l, m, r] = cells;
    if (!l || !m || !r) continue;
    const mid = at.get(m);
    const left = at.get(l);
    const right = at.get(r);
    if (!mid || !left || !right) continue;
    if (left.groupId === mid.groupId || right.groupId === mid.groupId) continue;
    if (
      isOther(mid.travellingAs, left.travellingAs) &&
      isOther(mid.travellingAs, right.travellingAs)
    )
      return m;
  }
  return null;
}
