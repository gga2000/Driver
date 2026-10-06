import { z } from 'zod';

/**
 * The الرجعة boarding pass on the lock screen, kept current while the app is closed (customer audit
 * d-8 follow-up): on each boarding moment the server sends the rider a data-only push carrying what
 * the Android ongoing card should say, and the app re-posts the card from it without a network call.
 * Push data is flat strings (FCM / Expo), so this is the one place that encodes and decodes it; the
 * API's notify module writes it, `apps/customer/src/features/rajaa/lockscreen/` reads it.
 *
 *   boarding  the car is loading at the garage, or on its way to his meeting point (with its distance)
 *   on_board  the driver checked him in
 *   on_road   the car left with him
 *   arrived   the trip is over (the fare)
 *   gone      cancelled, moved to another car, no-show: the card is removed
 */
export const RAJAA_PASS_PUSH_KIND = 'rajaa_pass_update';

export const RajaaPassPushPhase = z.enum(['boarding', 'on_board', 'on_road', 'arrived', 'gone']);
export type RajaaPassPushPhase = z.infer<typeof RajaaPassPushPhase>;

export const RajaaPassPush = z.object({
  kind: z.literal(RAJAA_PASS_PUSH_KIND),
  bookingId: z.string().min(1),
  phase: RajaaPassPushPhase,
  /** When the car leaves (ISO), for the time and the countdown. */
  departAt: z.coerce.date(),
  /** Where he boards: the garage, or his meeting point's public name. */
  stop: z.string(),
  /** How he boards (the card's «أني بالكراج» / «أني بنقطة الصعود» button; none for a door pickup). */
  pickupKind: z.enum(['garage', 'meeting_point', 'door']),
  /** The city the car goes to ("العزيزية"). */
  toCity: z.string(),
  seatIds: z.array(z.string()),
  /** His boarding PIN (it stays visible on the lock screen by design, Ali 2026-10-06). */
  pin: z.string(),
  /** The car's distance from his stop in km when it was known, while boarding. */
  carKm: z.number().min(0).nullable(),
  /** The fare, for «وصلت بالسلامة». */
  fareIqd: z.number().int().min(0),
  /** When the server sent it: an older push never replaces a newer card. */
  sentAt: z.coerce.date(),
});
export type RajaaPassPush = z.infer<typeof RajaaPassPush>;

/** The push `data` (all strings). */
export function encodeRajaaPassPush(p: RajaaPassPush): Record<string, string> {
  return {
    kind: p.kind,
    bookingId: p.bookingId,
    phase: p.phase,
    departAt: p.departAt.toISOString(),
    stop: p.stop,
    pickupKind: p.pickupKind,
    toCity: p.toCity,
    seatIds: p.seatIds.join(','),
    pin: p.pin,
    carKm: p.carKm === null ? '' : p.carKm.toFixed(1),
    fareIqd: String(p.fareIqd),
    sentAt: p.sentAt.toISOString(),
  };
}

/** Reads a push's `data` back; null when it is not a pass update or is malformed. */
export function decodeRajaaPassPush(data: Record<string, unknown> | null | undefined): RajaaPassPush | null {
  if (!data || data['kind'] !== RAJAA_PASS_PUSH_KIND) return null;
  const s = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : '');
  const km = s('carKm');
  const parsed = RajaaPassPush.safeParse({
    kind: data['kind'],
    bookingId: s('bookingId'),
    phase: s('phase'),
    departAt: s('departAt'),
    stop: s('stop'),
    pickupKind: s('pickupKind'),
    toCity: s('toCity'),
    seatIds: s('seatIds') ? s('seatIds').split(',') : [],
    pin: s('pin'),
    carKm: km === '' ? null : Number(km),
    fareIqd: Number(s('fareIqd')),
    sentAt: s('sentAt'),
  });
  if (!parsed.success || Number.isNaN(parsed.data.departAt.getTime()) || Number.isNaN(parsed.data.sentAt.getTime())) return null;
  return parsed.data;
}

/**
 * Which pass update a boarding event means for one booking (by its state after the event), or null
 * when it means none. Departure-wide events reach every booking on the car; seat events their own.
 */
export function rajaaPassPhaseFor(eventType: string, bookingState: string): RajaaPassPushPhase | null {
  switch (eventType) {
    case 'departure.boarding':
    case 'departure.driver_left_garage':
      return bookingState === 'booked' ? 'boarding' : null;
    case 'seat.checked_in':
      return bookingState === 'checked_in' ? 'on_board' : null;
    case 'departure.departed':
      return bookingState === 'checked_in' ? 'on_road' : null;
    case 'departure.arrived':
      return bookingState === 'completed' ? 'arrived' : null;
    case 'seat.cancelled':
    case 'seat.moved':
    case 'seat.no_show':
    case 'departure.cancelled':
      return 'gone';
    default:
      return null;
  }
}

/** The boarding events that send a pass update (the notify module subscribes to these). */
export const RAJAA_PASS_EVENTS = ['departure.boarding', 'departure.driver_left_garage', 'seat.checked_in', 'departure.departed', 'departure.arrived', 'seat.cancelled', 'seat.moved', 'seat.no_show', 'departure.cancelled'] as const;
