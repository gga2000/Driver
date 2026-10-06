import type { TFn } from './timeline';

const MIN = 60_000;

/** The slice of the tracking view the arrival copy reads (structural, so tests build it plainly). */
export interface RideArrivalView {
  order: { type: string };
  trip: { completedAt: Date | null; stops: ReadonlyArray<{ mine: boolean; type: string; completedAt: Date | null }> } | null;
  courier?: { firstName: string | null } | null;
}

/**
 * Whole minutes on the road for a finished ride: from the rider's pickup (the pickup stop's
 * completion) to the trip's completion. Null when either time is missing or the order isn't a ride.
 */
export function rideMinutes(view: RideArrivalView): number | null {
  if (view.order.type !== 'ride' || !view.trip?.completedAt) return null;
  const pickup = view.trip.stops.find((s) => s.mine && s.type === 'pickup');
  if (!pickup?.completedAt) return null;
  const ms = view.trip.completedAt.getTime() - pickup.completedAt.getTime();
  return ms > 0 ? Math.max(1, Math.round(ms / MIN)) : null;
}

/**
 * L-09: the ride's arrival says who drove and how long («ويا عباس · 12 دقيقة») under its title
 * «وصلت بالسلامة», instead of repeating the title; the button names the driver («قيّم عباس»).
 * Without a first name both fall back to «السايق».
 */
export function rideArrivalCopy(t: TFn, view: RideArrivalView): { subtitle: string; rate: string } {
  const name = view.courier?.firstName ?? t('track.driver_fallback');
  const minutes = rideMinutes(view);
  return {
    subtitle: minutes === null ? t('track.arrived_ride_with_name', { name }) : t('track.arrived_ride_with', { name, minutes }),
    rate: t('track.rate_driver_cta', { name }),
  };
}
