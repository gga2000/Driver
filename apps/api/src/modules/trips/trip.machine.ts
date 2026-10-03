import type { StopState, StopType, TripState } from '@driver/contracts';

/**
 * Trip machine (domain §2) — pure. `created → offered → accepted → en_route_to_pickup →
 * arrived_pickup → in_transit → arrived_dropoff → completed`, with `declined`/`timed_out` going
 * back to `offered` on the next offer and five terminal exits.
 *
 * Once a driver has accepted, the state is derived from the stops (`deriveTripState`): the
 * progress states are therefore connected both ways (a batched trip goes in_transit →
 * arrived_pickup for its second pickup, arrived_dropoff → in_transit for its next dropoff).
 */
export const TRIP_TRANSITIONS: Readonly<Record<TripState, readonly TripState[]>> = {
  created: ['offered', 'customer_cancelled', 'platform_cancelled'],
  offered: ['accepted', 'declined', 'timed_out', 'customer_cancelled', 'platform_cancelled'],
  declined: ['offered', 'customer_cancelled', 'platform_cancelled'],
  timed_out: ['offered', 'customer_cancelled', 'platform_cancelled'],
  accepted: ['en_route_to_pickup', 'arrived_pickup', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled'],
  en_route_to_pickup: ['arrived_pickup', 'arrived_dropoff', 'completed', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled'],
  arrived_pickup: ['en_route_to_pickup', 'in_transit', 'arrived_dropoff', 'completed', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed'],
  in_transit: ['arrived_pickup', 'arrived_dropoff', 'completed', 'driver_cancelled', 'platform_cancelled', 'failed'],
  arrived_dropoff: ['en_route_to_pickup', 'arrived_pickup', 'in_transit', 'completed', 'driver_cancelled', 'platform_cancelled', 'failed'],
  completed: [],
  driver_cancelled: [],
  customer_cancelled: [],
  platform_cancelled: [],
  failed: [],
};

/** Driver is working the trip; stop activity drives the state. */
export const PROGRESS_STATES: readonly TripState[] = ['accepted', 'en_route_to_pickup', 'arrived_pickup', 'in_transit', 'arrived_dropoff'];

export const TERMINAL_STATES: readonly TripState[] = ['completed', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed'];

/** Not yet assigned: the offer loop. */
export const OFFER_STATES: readonly TripState[] = ['created', 'offered', 'declined', 'timed_out'];

export function canTransition(from: TripState, to: TripState): boolean {
  return TRIP_TRANSITIONS[from].includes(to);
}

export class TripTransitionError extends Error {
  constructor(
    readonly from: TripState,
    readonly to: TripState,
  ) {
    super(`illegal trip transition ${from} → ${to}`);
    this.name = 'TripTransitionError';
  }
}

/** Returns `to` or throws; a no-op when `from === to`. */
export function transition(from: TripState, to: TripState): TripState {
  if (from === to) return to;
  if (!canTransition(from, to)) throw new TripTransitionError(from, to);
  return to;
}

export function isTerminal(state: TripState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Domain event type for entering `to` (domain §6 taxonomy). Stop-driven moves are `trip.progressed`. */
export function tripEventType(to: TripState): string {
  switch (to) {
    case 'created':
    case 'offered':
    case 'accepted':
    case 'declined':
    case 'timed_out':
    case 'completed':
    case 'failed':
      return `trip.${to}`;
    case 'en_route_to_pickup':
      return 'trip.en_route';
    case 'driver_cancelled':
    case 'customer_cancelled':
    case 'platform_cancelled':
      return 'trip.cancelled';
    default:
      return 'trip.progressed';
  }
}

export interface StopLike {
  seq: number;
  type: StopType;
  state: StopState;
}

/**
 * Trip state from its stops (domain §2: "trip state derives from stop states for multi-stop
 * trips"). Only progress states are derived; offer-loop and terminal states pass through.
 *
 * - every stop finished and at least one completed → `completed`;
 * - next unfinished stop arrived → `arrived_dropoff` for a dropoff, `arrived_pickup` otherwise
 *   (a `wait` with the rider aboard stays `in_transit`);
 * - next unfinished stop pending → `in_transit` when something is aboard (a pickup or shop stop
 *   was completed), otherwise `en_route_to_pickup`.
 * All stops skipped with none completed leaves the state alone: the caller fails or cancels.
 */
export function deriveTripState(current: TripState, stops: readonly StopLike[]): TripState {
  if (!PROGRESS_STATES.includes(current)) return current;
  const ordered = [...stops].sort((a, b) => a.seq - b.seq);
  if (ordered.length === 0) return current;
  const finished = (s: StopLike) => s.state === 'completed' || s.state === 'skipped';
  if (ordered.every(finished)) return ordered.some((s) => s.state === 'completed') ? 'completed' : current;

  const next = ordered.find((s) => !finished(s))!;
  const aboard = ordered.some((s) => (s.type === 'pickup' || s.type === 'shop') && s.state === 'completed');
  if (next.state === 'arrived') {
    if (next.type === 'dropoff') return 'arrived_dropoff';
    if (next.type === 'wait' && aboard) return 'in_transit';
    return 'arrived_pickup';
  }
  return aboard ? 'in_transit' : 'en_route_to_pickup';
}
