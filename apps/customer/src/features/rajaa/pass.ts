import type { BookingView } from '@driver/contracts';
import { isBoardingOpen } from './logic';

/**
 * Where a boarding pass is in its life (joy r3, audit S-2): before boarding (countdown), boarding
 * open at the garage (PIN up front, live car), on the road (checked in or the car left), and kept
 * after the trip (a stub you can look back at). Cancelled, moved, expired and no-show bookings have no
 * pass life of their own: `closed`.
 */
export type PassPhase = 'before' | 'boarding' | 'onboard' | 'kept' | 'closed';

export function passPhase(b: Pick<BookingView, 'state'> & { departure: Pick<BookingView['departure'], 'state' | 'departAt'> }, now: Date): PassPhase {
  if (b.state === 'completed') return 'kept';
  if (b.state === 'checked_in' || (b.state === 'booked' && b.departure.state === 'departed')) return 'onboard';
  if (b.state !== 'booked' && b.state !== 'held') return 'closed';
  return b.departure.state === 'boarding' || isBoardingOpen(b.departure.departAt, now) ? 'boarding' : 'before';
}
