import { z } from 'zod';
import type { BookedRidesConfig } from './city-config.js';
import { atLocal, baghdadDate, shiftDate } from './ride-habits-io.js';

/**
 * Evening-before booked rides (edge-case review #28, adopted in the edge-case decisions): a ride booked
 * for later is offered ahead of time to fitting drivers as a pre-assigned job; one confirms it by 22:00
 * the evening before (city config); with nobody confirmed, or the confirmed driver gone, the normal
 * search starts 30 minutes before (`RIDE_HABIT_RULES.schedule.searchLeadMin`). The rules below are shared
 * by dispatch (when to offer) and the apps (what to tell people).
 */

const MIN = 60_000;

/** When drivers may confirm a booked ride: from `offerAt` until `confirmBy`. */
export interface BookedRideWindow {
  kind: 'evening_before' | 'same_day';
  offerAt: Date;
  confirmBy: Date;
}

/**
 * The pre-assignment window of a ride booked at `bookedAt` for `scheduledFor`, or null when it gets none
 * (its search simply starts at T−30):
 *
 * - a ride on a later day than the booking: offered from `offerFromHour` (18:00) the evening before — or at
 *   booking, when that is later — and confirmed by `confirmByHour` (22:00) that evening;
 * - otherwise (same day, or booked too late the evening before): only when booked at least
 *   `sameDayMinLeadMin` (3 h) ahead — offered at booking (never before `sameDayFromHour`, 08:00) and
 *   confirmed by `sameDayConfirmLeadMin` (90 min) before the ride, never after 22:00 that day;
 * - either way drivers need at least `minOfferWindowMin` (30 min) to answer.
 *
 * So nobody is ever asked to confirm at night.
 */
export function bookedRideWindow(scheduledFor: Date, bookedAt: Date, cfg: BookedRidesConfig): BookedRideWindow | null {
  const minWindow = cfg.minOfferWindowMin * MIN;
  const rideDate = baghdadDate(scheduledFor);
  const bookedDate = baghdadDate(bookedAt);
  if (rideDate > bookedDate) {
    const eve = shiftDate(rideDate, -1);
    const confirmBy = atLocal(eve, cfg.confirmByHour * 60);
    const offerAt = new Date(Math.max(bookedAt.getTime(), atLocal(eve, cfg.offerFromHour * 60).getTime()));
    if (confirmBy.getTime() - offerAt.getTime() >= minWindow) return { kind: 'evening_before', offerAt, confirmBy };
  }
  if (scheduledFor.getTime() - bookedAt.getTime() < cfg.sameDayMinLeadMin * MIN) return null;
  const offerAt = new Date(Math.max(bookedAt.getTime(), atLocal(bookedDate, cfg.sameDayFromHour * 60).getTime()));
  const confirmBy = new Date(Math.min(scheduledFor.getTime() - cfg.sameDayConfirmLeadMin * MIN, atLocal(bookedDate, cfg.confirmByHour * 60).getTime()));
  if (confirmBy.getTime() - offerAt.getTime() < minWindow) return null;
  return { kind: 'same_day', offerAt, confirmBy };
}

/** The end of the favourite's own time with a booked ride: `favouriteFirstMin`, at most half the window. */
export function bookedFavouriteUntil(w: Pick<BookedRideWindow, 'offerAt' | 'confirmBy'>, cfg: Pick<BookedRidesConfig, 'favouriteFirstMin'>): Date {
  const half = (w.confirmBy.getTime() - w.offerAt.getTime()) / 2;
  return new Date(w.offerAt.getTime() + Math.min(cfg.favouriteFirstMin * MIN, half));
}

// ───────────────────────── what the customer is told ─────────────────────────

/**
 * A booked ride as its rider sees it (`rideHabits.bookedRide`):
 * - `confirmed`: a driver confirmed it — his first name and approved photo;
 * - `looking`: drivers are being asked; we tell him by `confirmBy`;
 * - `later`: no driver confirmed (none asked, nobody by the deadline, or the confirmed one dropped it): the
 *   search starts at `searchAt` (T−30).
 */
export const BookedRideState = z.enum(['confirmed', 'looking', 'later']);
export type BookedRideState = z.infer<typeof BookedRideState>;

export const BookedRideStatus = z.object({
  orderId: z.string(),
  state: BookedRideState,
  confirmBy: z.coerce.date().nullable(),
  searchAt: z.coerce.date(),
  driver: z
    .object({
      /** First name (logged vault read); null when he set none. */
      firstName: z.string().nullable(),
      /** His approved main photo, signed and short-lived; null → the app draws his initial. */
      photoUrl: z.string().nullable(),
    })
    .nullable(),
});
export type BookedRideStatus = z.infer<typeof BookedRideStatus>;

export const BookedRideInput = z.object({ orderId: z.string().min(1) });
export type BookedRideInput = z.infer<typeof BookedRideInput>;
