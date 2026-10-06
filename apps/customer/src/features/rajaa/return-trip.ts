import type { BookingView, IntercityDirection } from '@driver/contracts';
import { flip } from './logic';

const WEEK_MS = 7 * 86_400_000;
const MIN_MS = 60_000;
/** A return closer than this to now is no plan: the next week's same day is offered instead. */
const LEAD_MIN = 60;
/** The board window around the return time: an hour before, two after (cars leave "or when full"). */
export const RETURN_WINDOW = { beforeMin: 60, afterMin: 120 } as const;

export interface ReturnTrip {
  corridorId: string;
  direction: IntercityDirection;
  /** The same weekday and clock time as the trip just taken, the next time it comes round. */
  at: Date;
}

/**
 * «احجز رجعتك» (joy r2, audit R-04): the reverse direction on the same corridor, preset to the same
 * weekday and time as the trip that just arrived (riders keep a weekly rhythm: Baghdad on Saturday,
 * home on Thursday at the same hour). The board then opens on that window.
 */
export function returnTrip(b: { departure: Pick<BookingView['departure'], 'corridorId' | 'direction' | 'departAt'> }, now: Date): ReturnTrip {
  let at = b.departure.departAt.getTime() + WEEK_MS;
  while (at < now.getTime() + LEAD_MIN * MIN_MS) at += WEEK_MS;
  return { corridorId: b.departure.corridorId, direction: flip(b.departure.direction), at: new Date(at) };
}

/** The board's read window for a preset time (null = the default "from now"). */
export function presetWindow(at: Date | null): { from: Date; to: Date } | null {
  if (!at || Number.isNaN(at.getTime())) return null;
  return { from: new Date(at.getTime() - RETURN_WINDOW.beforeMin * MIN_MS), to: new Date(at.getTime() + RETURN_WINDOW.afterMin * MIN_MS) };
}
