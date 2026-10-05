/**
 * The الرجعة boarding pass outside the app (customer audit d-8): what the Android ongoing (sticky)
 * notification says at each moment of the trip. Pure: no React Native, unit-tested; the native module
 * (`ongoing.native.ts`) only shows what this returns.
 *
 *   none      before T−30            nothing on screen (a notification is scheduled for T−30)
 *   upcoming  T−30 → boarding        "تطلع 7:30 م من كراج النهضة" · "مقعدك ورا نص · الرمز 5481" · "بعد 25 دقيقة"
 *   boarding  the car is loading     "السيارة دا تحمّل بـ كراج النهضة" · seat, PIN · "السيارة على بعد 1.0 كم"
 *   on_board  checked in             "صعدت · تطلع 7:30 م" · "مقعدك ورا نص"
 *   on_road   departed with him      "بالطريق لـ العزيزية" · "مقعدك ورا نص"
 *   arrived   completed              "وصلت بالسلامة" · "الأجرة 10,000 دينار" (dismissible, not sticky)
 *   gone      cancelled, moved, no-show, held, left without him: the notification is removed
 *
 * iOS: a Live Activity needs a native widget extension (follow-up); this module serves Android only.
 */
import type { BookingView, BoardingPass } from '@driver/contracts';
import { formatClock, formatDuration, type MessageKey } from '@driver/i18n';

export type PassPhase = 'none' | 'upcoming' | 'boarding' | 'on_board' | 'on_road' | 'arrived' | 'gone';

/** The pass reaches the lock screen 30 minutes before the car leaves (when boarding opens). */
export const PASS_LEAD_MIN = 30;
/** A completed trip is still followed (for its "وصلت بالسلامة") this long after the departure time. */
export const ARRIVED_FOLLOW_H = 6;
const MIN = 60_000;

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface PassCard {
  /** One notification per booking: updates replace it in place. */
  id: string;
  bookingId: string;
  phase: Exclude<PassPhase, 'none' | 'gone'>;
  title: string;
  body: string;
  /** Third line (Android sub text): the countdown or the car's distance. */
  sub: string | null;
  /** Ongoing: can't be swiped away while the trip is live. */
  sticky: boolean;
  /** "أني بالكراج" / "أني بنقطة الصعود" while he can still check in. */
  imHere: 'garage' | 'point' | null;
  deepLink: string;
}

export function passNotificationId(bookingId: string): string {
  return `rajaa-pass-${bookingId}`;
}

export function passShowAt(b: Pick<BookingView, 'departure'>): Date {
  return new Date(b.departure.departAt.getTime() - PASS_LEAD_MIN * MIN);
}

export function passPhase(b: Pick<BookingView, 'state' | 'departure'>, now: Date): PassPhase {
  const dep = b.departure;
  if (b.state === 'completed') return 'arrived';
  if (b.state === 'checked_in') return dep.state === 'departed' ? 'on_road' : dep.state === 'arrived' || dep.state === 'closed' ? 'arrived' : 'on_board';
  if (b.state !== 'booked') return 'gone';
  if (dep.state !== 'scheduled' && dep.state !== 'boarding') return 'gone';
  if (now.getTime() < passShowAt(b).getTime()) return 'none';
  return dep.state === 'boarding' ? 'boarding' : 'upcoming';
}

/**
 * Which booking the lock screen follows: the next live one (booked or on board, soonest first), else
 * one that arrived within the last half hour (its "وصلت بالسلامة").
 */
export function passBooking(bookings: readonly BookingView[], now: Date): BookingView | null {
  const live = bookings
    .filter((b) => (b.state === 'booked' || b.state === 'checked_in') && passPhase(b, now) !== 'gone')
    .sort((a, b) => a.departure.departAt.getTime() - b.departure.departAt.getTime());
  if (live[0]) return live[0];
  const recent = bookings.filter((b) => b.state === 'completed' && now.getTime() - b.departure.departAt.getTime() < ARRIVED_FOLLOW_H * 3600_000);
  return recent.sort((a, b) => b.departure.departAt.getTime() - a.departure.departAt.getTime())[0] ?? null;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PassCardInput {
  booking: BookingView;
  /** The live boarding pass (PIN, car); null before it loads. */
  pass: BoardingPass | null;
  /** "كراج النهضة" (or the meeting point's name when he boards on the way). */
  stopName: string;
  /** The city the car is going to ("العزيزية"). */
  toCity: string;
  /** "1,500"-style amount for the fare line (the app's money formatter). */
  amount: (iqd: number) => string;
  now: Date;
}

/** What the notification says now, or null when there should be none (before T−30, or gone). */
export function passCard(input: PassCardInput, t: T): PassCard | null {
  const { booking: b, pass, now } = input;
  const phase = passPhase(b, now);
  if (phase === 'none' || phase === 'gone') return null;
  const time = formatClock(b.departure.departAt);
  const seat = b.seatIds.map((id) => t(`seat.${id}` as MessageKey)).join('، ');
  const pin = pass?.pin ?? b.pin ?? '';
  const base = { id: passNotificationId(b.id), bookingId: b.id, phase, deepLink: `driver://rajaa/pass/${b.id}` } as const;
  const point = b.pickup.kind !== 'garage';
  const imHere = b.state === 'booked' && b.pickup.kind !== 'door' ? (point ? 'point' : 'garage') : null;
  const passBody = pin ? t('rajaa.lock_pass_body', { seat, pin }) : t('rajaa.lock_seat_body', { seat });

  if (phase === 'upcoming' || phase === 'boarding') {
    const left = b.departure.departAt.getTime() - now.getTime();
    const countdown = left >= MIN ? t('departure_time.in', { duration: formatDuration(left) }) : t('departure_time.now');
    const car = pass?.car ? km(pass.car, pass.myStop) : null;
    return {
      ...base,
      title: phase === 'boarding' ? t('rajaa.lock_boarding_title', { garage: input.stopName }) : t('rajaa.lock_upcoming_title', { time, garage: input.stopName }),
      body: passBody,
      sub: phase === 'boarding' && car !== null ? t('rajaa.lock_car_km', { km: car.toFixed(1) }) : countdown,
      sticky: true,
      imHere,
    };
  }
  if (phase === 'on_board') return { ...base, title: t('rajaa.lock_checked_in_title', { time }), body: t('rajaa.lock_seat_body', { seat }), sub: null, sticky: true, imHere: null };
  if (phase === 'on_road') return { ...base, title: t('rajaa.lock_on_road_title', { city: input.toCity }), body: t('rajaa.lock_seat_body', { seat }), sub: null, sticky: true, imHere: null };
  return { ...base, title: t('rajaa.lock_arrived_title'), body: t('rajaa.lock_arrived_body', { amount: input.amount(b.totalIqd) }), sub: null, sticky: false, imHere: null };
}

/** Same words, same notification: the module skips re-posting an unchanged card. */
export function passCardKey(c: PassCard | null): string {
  return c ? [c.id, c.phase, c.title, c.body, c.sub ?? '', c.sticky ? 1 : 0, c.imHere ?? ''].join('|') : '';
}
