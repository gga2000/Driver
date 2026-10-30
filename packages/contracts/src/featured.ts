/**
 * «مميّز» (Ali, 2026-10-12: «Yes, now», then the date stamp with one at the top): a restaurant on the
 * featured commission tier (15 %) is marked as featured, and one featured restaurant sits first in the
 * plain food list. Only an open one: a closed or paused kitchen never moves up. Search, «أحسن 3» and a
 * sort the customer picks (fastest, top rated) keep their own order. With several featured kitchens
 * open, the one at the top changes once a day (Baghdad's day), so none owns the seat. Pure, shared by
 * the server's list and the app's default sort, so both put the same kitchen first.
 */

/** Baghdad is UTC+3 all year (no daylight saving). */
const DAY_OFFSET_MS = 3 * 3_600_000;

/** Days since 1970 on Baghdad's calendar: the seat turns over at local midnight. */
export function featuredDay(at: Date): number {
  return Math.floor((at.getTime() + DAY_OFFSET_MS) / 86_400_000);
}

/** The list with today's featured kitchen moved to the top; the rest keep their order. */
export function featuredFirst<T extends { id: string; open: boolean; featured?: boolean | undefined }>(list: readonly T[], at: Date): T[] {
  const seats = list.filter((r) => r.open && r.featured === true).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (seats.length === 0) return [...list];
  const first = seats[featuredDay(at) % seats.length]!;
  return [first, ...list.filter((r) => r !== first)];
}
