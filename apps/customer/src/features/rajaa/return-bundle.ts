import type { BookingView, IntercityDirection } from '@driver/contracts';

export interface ReturnOffer {
  percent: number;
  /** His booked seat this car would be the way back for. */
  booking: BookingView;
}

/**
 * Step 5 (Ali's item 51): the rider's booked seat that a car on this road the other way would pair
 * with, when the server offers the pair (`returnOfferPercent`). The earliest such seat wins. Labels
 * only: the discount itself comes back on the hold, priced by the server.
 */
export function returnOfferFor(
  bookings: readonly BookingView[] | undefined,
  corridorId: string,
  direction: IntercityDirection,
): ReturnOffer | null {
  let best: ReturnOffer | null = null;
  for (const b of bookings ?? []) {
    if (b.returnOfferPercent === null || b.departure.corridorId !== corridorId || b.departure.direction === direction) continue;
    if (!best || b.departure.departAt.getTime() < best.booking.departure.departAt.getTime()) best = { percent: b.returnOfferPercent, booking: b };
  }
  return best;
}
