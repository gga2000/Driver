/**
 * Seat layouts and selection rules for intercity cars (customer spec §2, partner spec "walk-up
 * marking per seat"). Layouts are physical (top-down, front of the car at the top, driver on
 * the left as in Iraqi LHD cars) and never mirror with RTL.
 */

export type SeatLayout = 4 | 6 | 7;

/** Seat ids double as i18n keys under `seat.*`. */
export type SeatId =
  | 'front'
  | 'back_left'
  | 'back_middle'
  | 'back_right'
  | 'middle_left'
  | 'middle_middle'
  | 'middle_right'
  | 'rear_left'
  | 'rear_middle'
  | 'rear_right';

/** `free` can be booked; `taken` is paid/owned; `walkup` was sold at the garage; `held` is someone's 10-minute hold. */
export type SeatState = 'free' | 'taken' | 'walkup' | 'held';

export interface SeatInfo {
  id: SeatId;
  state: SeatState;
  /** Premium over the base seat price (front seat +2,000). */
  premium?: number;
}

/** Rows from the front, three physical columns (left, centre, right). `driver` is a fixed, non-seat cell. */
export type SeatCell = SeatId | 'driver' | null;

export const SEAT_ROWS: Record<SeatLayout, SeatCell[][]> = {
  // Saloon (Camry/Sonata): front passenger beside the driver, three across the back.
  4: [
    ['driver', null, 'front'],
    ['back_left', 'back_middle', 'back_right'],
  ],
  // Six-seater (captain chairs in the middle row).
  6: [
    ['driver', null, 'front'],
    ['middle_left', null, 'middle_right'],
    ['rear_left', 'rear_middle', 'rear_right'],
  ],
  // Seven-seater (GMC/Suburban): bench middle row.
  7: [
    ['driver', null, 'front'],
    ['middle_left', 'middle_middle', 'middle_right'],
    ['rear_left', 'rear_middle', 'rear_right'],
  ],
};

export function seatIds(layout: SeatLayout): SeatId[] {
  return SEAT_ROWS[layout].flat().filter((c): c is SeatId => c !== null && c !== 'driver');
}

export type SelectRejection = 'taken' | 'walkup' | 'held' | 'unknown' | 'max';

export interface SelectResult {
  selection: SeatId[];
  /** Why the tap did nothing (drives a toast / haptic error); null when the selection changed. */
  rejected: SelectRejection | null;
}

/**
 * Applies a tap on `id`:
 * - a selected seat deselects;
 * - only `free` seats can be selected;
 * - with `max === 1` a new seat replaces the old one (the common single-seat booking);
 * - with `max > 1` a tap beyond the limit is rejected with `max`.
 */
export function toggleSeat(seats: readonly SeatInfo[], selection: readonly SeatId[], id: SeatId, max = 1): SelectResult {
  if (selection.includes(id)) return { selection: selection.filter((s) => s !== id), rejected: null };
  const seat = seats.find((s) => s.id === id);
  if (!seat) return { selection: [...selection], rejected: 'unknown' };
  if (seat.state !== 'free') return { selection: [...selection], rejected: seat.state };
  if (max === 1) return { selection: [id], rejected: null };
  if (selection.length >= max) return { selection: [...selection], rejected: 'max' };
  return { selection: [...selection, id], rejected: null };
}

/** Driver-side walk-up marking: free ↔ walkup. Booked or held seats cannot be marked. */
export function toggleWalkup(seats: readonly SeatInfo[], id: SeatId): SeatInfo[] {
  return seats.map((s) => {
    if (s.id !== id) return s;
    if (s.state === 'free') return { ...s, state: 'walkup' };
    if (s.state === 'walkup') return { ...s, state: 'free' };
    return s;
  });
}

export function seatsLeft(seats: readonly SeatInfo[]): number {
  return seats.filter((s) => s.state === 'free').length;
}

/** Sum of base price × seats plus premiums of the selected seats. */
export function selectionPrice(seats: readonly SeatInfo[], selection: readonly SeatId[], basePrice: number): number {
  return selection.reduce((sum, id) => sum + basePrice + (seats.find((s) => s.id === id)?.premium ?? 0), 0);
}
