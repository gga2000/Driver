import type { BookingState, OrderFirsts } from '@driver/contracts';

/**
 * «أول مرة» (joy g8, delight strategy B1): three firsts get one crafted moment each, once in a
 * lifetime — the first meal delivered, the first tuktuk ride, the first الرجعة seat. The server names
 * which order was the first (`orders.firsts`); for seats the earliest real booking is the first. The
 * phone remembers it played. On a quiet day (mourning, set in the Console) nothing plays.
 */
export type FirstKind = 'food' | 'tuktuk' | 'rajaa';

/** Which first this order is, if any. */
export function firstKindForOrder(orderId: string, firsts: OrderFirsts | null | undefined): Exclude<FirstKind, 'rajaa'> | null {
  if (!firsts) return null;
  if (firsts.foodOrderId === orderId) return 'food';
  if (firsts.tuktukOrderId === orderId) return 'tuktuk';
  return null;
}

/** A seat that was really taken (not a hold that lapsed, not cancelled). */
const SEATED: ReadonlySet<BookingState> = new Set<BookingState>(['booked', 'checked_in', 'completed']);

/** The person's first الرجعة seat: the earliest booking that became a real seat. */
export function firstSeatId(bookings: ReadonlyArray<{ id: string; state: BookingState; createdAt: Date }>): string | null {
  return [...bookings].filter((b) => SEATED.has(b.state)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.id ?? null;
}

/** It plays when this is a first, it never played on this phone, and today allows celebrations. */
export function firstMomentPlays(i: { kind: FirstKind | null; seen: boolean; celebrations: boolean }): boolean {
  return i.kind !== null && !i.seen && i.celebrations;
}

export function firstSeenKey(kind: FirstKind): string {
  return `driver.customer.first.${kind}`;
}
