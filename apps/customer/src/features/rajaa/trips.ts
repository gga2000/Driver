import type { BookingState, BookingView } from '@driver/contracts';
import { baghdadDay, dayKey, type HistorySection } from '@/features/orders/history';

/**
 * الرجعة trips in طلباتي (joy r4, audit W-01): the item people reopen most — the boarding pass — was
 * missing from "my orders". Upcoming seats are pinned in «رحلاتك الجاية» above everything; past seats
 * sit in the day sections next to the food orders, each opening its pass (or kept stub).
 */

const UPCOMING: ReadonlySet<BookingState> = new Set(['booked', 'checked_in']);
/** Moved bookings live on as their new booking; lapsed holds were never trips. */
const PAST: ReadonlySet<BookingState> = new Set(['completed', 'no_show', 'cancelled_by_rider', 'cancelled']);

/** Booked and boarding seats (and a hold still running), soonest first. */
export function upcomingTrips(bookings: readonly BookingView[], now: Date): BookingView[] {
  return bookings
    .filter((b) => UPCOMING.has(b.state) || (b.state === 'held' && b.heldUntil !== null && b.heldUntil.getTime() > now.getTime()))
    .sort((a, b) => a.departure.departAt.getTime() - b.departure.departAt.getTime());
}

export function pastTrips(bookings: readonly BookingView[]): BookingView[] {
  return bookings.filter((b) => PAST.has(b.state));
}

export type HistoryItem<R> = { kind: 'order'; row: R } | { kind: 'trip'; booking: BookingView };

/**
 * The orders' day sections with the past seats folded in by the Baghdad day they left: a day that has
 * only a trip gets its own section, in date order (newest first). The running section stays on top.
 */
export function withTrips<R extends { order: { placedAt: Date } }>(sections: readonly HistorySection<R>[], trips: readonly BookingView[], now: Date): HistorySection<HistoryItem<R>>[] {
  type Item = HistoryItem<R>;
  const at = (i: Item) => (i.kind === 'order' ? i.row.order.placedAt : i.booking.departure.departAt);
  const out: HistorySection<Item>[] = sections.map((s) => ({ ...s, rows: s.rows.map((row): Item => ({ kind: 'order', row })) }));
  for (const booking of trips) {
    const id = String(baghdadDay(booking.departure.departAt));
    const found = out.find((s) => !s.running && s.id === id);
    if (found) found.rows.push({ kind: 'trip', booking });
    else out.push({ id, running: false, day: dayKey(booking.departure.departAt, now), rows: [{ kind: 'trip', booking }] });
  }
  for (const s of out) if (!s.running) s.rows.sort((a, b) => at(b).getTime() - at(a).getTime());
  return out.sort((a, b) => (a.running ? -1 : b.running ? 1 : Number(b.id) - Number(a.id)));
}
