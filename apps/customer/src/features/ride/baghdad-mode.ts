import type { BookingView, DepartureCard, IntercityNetwork } from '@driver/contracts';
import { compareDepartures, isLiveBooking, publicPlaceName } from '@/features/rajaa/logic';
import type { CardQuery } from './garage-taxi';

/**
 * Ride idea n9 «Baghdad mode»: when the phone is in Baghdad (or Kut), a card with the next car back to
 * Aziziyah from that city's garage — or, when he already holds a seat on one, that seat with the n10
 * switch for a taxi waiting at the Aziziyah garage. Pure: the card's state from the board, his
 * bookings and the network, so it runs in plain Node tests.
 */

/** The card re-reads the board this often while it shows (seats fill, cars get announced). */
export const BAGHDAD_MODE_POLL_MS = 30_000;
/** Cars leaving within this many hours are "the next car back"; the board's own default window. */
export const BAGHDAD_MODE_TODAY_H = 12;
/** The board is read this far ahead, so an empty card can say when the next car is announced for. */
export const BAGHDAD_MODE_AHEAD_H = 36;

const HOUR = 3_600_000;
const OPEN: ReadonlySet<DepartureCard['state']> = new Set(['scheduled', 'boarding']);
/** A seat he holds stays on the card until the car arrives (on the road it carries the n10 switch). */
const SEAT_DEPARTURE: ReadonlySet<BookingView['departure']['state']> = new Set(['scheduled', 'boarding', 'departed']);

/** One car back as the card shows it: where, when, seats left and the seat price the server gave. */
export interface CarBack {
  departureId: string;
  corridorId: string;
  garageNameAr: string;
  departAt: Date;
  free: number;
  seatPriceIqd: number;
}

/** His own seat on a car back. */
export interface SeatBack {
  bookingId: string;
  state: BookingView['state'];
  departAt: Date;
  seatIds: BookingView['seatIds'];
  garageNameAr: string;
  heldUntil: Date | null;
}

/** Without data yet (one member per kind, so a check on `kind` narrows). */
export type BaghdadModeWaiting = { kind: 'loading'; cityId: string } | { kind: 'error'; cityId: string } | { kind: 'offline'; cityId: string };
export type BaghdadModeState =
  | { kind: 'hidden' }
  | BaghdadModeWaiting
  | { kind: 'next'; cityId: string; next: CarBack; after: CarBack | null; offline: boolean }
  | { kind: 'empty'; cityId: string; corridorId: string; announced: CarBack | null; offline: boolean }
  | { kind: 'booked'; cityId: string; seat: SeatBack; offline: boolean };

/** The corridor home from a far city (its primary one when a city ever has more than one). */
export function corridorBack(network: Pick<IntercityNetwork, 'corridors'> | undefined, cityId: string | null): string | null {
  if (!network || !cityId) return null;
  const mine = network.corridors.filter((c) => c.cityId === cityId);
  return (mine.find((c) => c.primary) ?? mine[0])?.id ?? null;
}

function garageNameAr(network: Pick<IntercityNetwork, 'garages'> | undefined, id: string): string {
  const name = network?.garages.find((g) => g.id === id)?.nameAr;
  return name ? publicPlaceName(name) : '';
}

/**
 * Bookable cars back with a free seat, earliest first, split at `BAGHDAD_MODE_TODAY_H`: `today` are
 * the cars to catch, `later` only tells an empty card when the next one is announced for.
 */
export function carsBack(departures: readonly DepartureCard[], network: Pick<IntercityNetwork, 'garages'> | undefined, now: Date): { today: CarBack[]; later: CarBack[] } {
  const cut = now.getTime() + BAGHDAD_MODE_TODAY_H * HOUR;
  const open = departures
    .filter((d) => d.direction === 'to_aziziyah' && OPEN.has(d.state) && d.latestDepartureAt.getTime() > now.getTime() && d.fill.free > 0)
    .sort(compareDepartures)
    .map<CarBack>((d) => ({ departureId: d.id, corridorId: d.corridorId, garageNameAr: garageNameAr(network, d.garageId), departAt: d.departAt, free: d.fill.free, seatPriceIqd: d.seatPriceIqd }));
  return { today: open.filter((c) => c.departAt.getTime() <= cut), later: open.filter((c) => c.departAt.getTime() > cut) };
}

/** His live seat on a car back home on this corridor within the coming `BAGHDAD_MODE_TODAY_H` (the earliest). */
export function seatBack(bookings: readonly BookingView[], corridorId: string, network: Pick<IntercityNetwork, 'garages'> | undefined, now: Date): SeatBack | null {
  const cut = now.getTime() + BAGHDAD_MODE_TODAY_H * HOUR;
  const b = bookings
    .filter(
      (x) =>
        isLiveBooking(x, now) &&
        x.departure.corridorId === corridorId &&
        x.departure.direction === 'to_aziziyah' &&
        SEAT_DEPARTURE.has(x.departure.state) &&
        x.departure.departAt.getTime() <= cut &&
        (x.departure.state === 'departed' || x.departure.latestDepartureAt.getTime() > now.getTime()),
    )
    .sort((a, c) => a.departure.departAt.getTime() - c.departure.departAt.getTime())[0];
  if (!b) return null;
  return { bookingId: b.id, state: b.state, departAt: b.departure.departAt, seatIds: b.seatIds, garageNameAr: garageNameAr(network, b.departure.garageId), heldUntil: b.heldUntil };
}

export interface BaghdadModeInput {
  /** The far city the phone is in (`awayCityAt`), null when not in one or the position is unknown. */
  cityId: string | null;
  network: IntercityNetwork | undefined;
  board: CardQuery<readonly DepartureCard[]>;
  bookings: readonly BookingView[] | undefined;
  online: boolean;
  now: Date;
}

/**
 * The card's state. Not in a far city (or no corridor home from it): hidden. His seat on a car back
 * leads (with the n10 switch); otherwise the next car and the one after, or «ماكو سيارة راجعة هسة»
 * with the first car announced later. Without data: loading, offline, or the error with its retry.
 */
export function baghdadModeState({ cityId, network, board, bookings, online, now }: BaghdadModeInput): BaghdadModeState {
  if (!cityId) return { kind: 'hidden' };
  if (!network) return waiting(online, board.isError, cityId);
  const corridorId = corridorBack(network, cityId);
  if (!corridorId) return { kind: 'hidden' };
  const offline = !online;
  const seat = bookings ? seatBack(bookings, corridorId, network, now) : null;
  if (seat) return { kind: 'booked', cityId, seat, offline };
  if (!board.data) return waiting(online, board.isError, cityId);
  const cars = carsBack(board.data, network, now);
  const [next, after] = cars.today;
  if (next) return { kind: 'next', cityId, next, after: after ?? null, offline };
  return { kind: 'empty', cityId, corridorId, announced: cars.later[0] ?? null, offline };
}

function waiting(online: boolean, isError: boolean, cityId: string): BaghdadModeWaiting {
  return { kind: !online ? 'offline' : isError ? 'error' : 'loading', cityId };
}

/** The board window: from the server's default start to `BAGHDAD_MODE_AHEAD_H` ahead, on the hour (a stable query key). */
export function boardUntil(now: Date): Date {
  return new Date(Math.ceil(now.getTime() / HOUR) * HOUR + BAGHDAD_MODE_AHEAD_H * HOUR);
}
