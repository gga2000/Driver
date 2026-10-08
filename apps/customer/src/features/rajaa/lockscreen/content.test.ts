import { describe, expect, it } from 'vitest';
import type { BoardingPass, BookingView } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { passBooking, passCard, passCardKey, passNotificationId, passPhase, passShowAt } from './content';

const t = createT('ar-IQ');
const strip = (s: string) => s.replace(/[⁦⁩]/g, '');
// 2026-10-05 16:00Z = 7:00 م in Aziziyah; the car leaves at 7:30 م.
const NOW = new Date('2026-10-05T16:00:00Z');
const DEPART = new Date('2026-10-05T16:30:00Z');
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

function booking(over: Partial<BookingView> = {}, dep: Partial<BookingView['departure']> = {}): BookingView {
  return {
    id: 'bk1',
    departureId: 'dp1',
    riderId: 'r1',
    state: 'booked',
    origin: 'rider',
    seatIds: ['back_middle'],
    travellingAs: 'rijal',
    seatPriceIqd: 10_000,
    frontPremiumIqd: 0,
    pickupFeeIqd: 0,
    totalIqd: 10_000,
    payment: 'wallet',
    prepaid: true,
    prepayRail: 'wallet',
    heldUntil: null,
    pin: '5481',
    pickup: { kind: 'garage', meetingPointId: null, nameAr: null, lat: 33.3, lng: 44.4, note: null, feeIqd: 0, status: 'accepted', detourMin: null },
    largeBags: false,
    movedToBookingId: null,
    movedFromBookingId: null,
    checkedInAt: null,
    lateMinutes: null,
    departure: { id: 'dp1', corridorId: 'aziziyah_baghdad', direction: 'to_aziziyah', garageId: 'mp_garage_nahdha', departAt: DEPART, latestDepartureAt: new Date(DEPART.getTime() + 40 * 60_000), state: 'scheduled', vehicle: { kind: 'saloon', layout: 4, plate: '12345 بغداد' }, driverId: 'd1', ...dep },
    createdAt: min(-120),
    ...over,
  } as BookingView;
}

const pass = (over: Partial<BoardingPass> = {}) => ({ pin: '5481', car: null, myStop: { lat: 33.3, lng: 44.4 }, ...over }) as unknown as BoardingPass;
const input = (b: BookingView, now: Date, p: BoardingPass | null = null) => ({ booking: b, pass: p, stopName: 'كراج النهضة', toCity: 'العزيزية', amount: (n: number) => n.toLocaleString('en-US'), now });

describe('lock-screen boarding pass (customer d-8)', () => {
  it('is scheduled for T−30 and stays off the screen before it', () => {
    expect(passShowAt(booking())).toEqual(new Date('2026-10-05T16:00:00Z'));
    expect(passPhase(booking(), min(-1))).toBe('none');
    expect(passCard(input(booking(), min(-1)), t)).toBeNull();
  });

  it('from T−30: time, garage, seat and PIN, sticky, with the countdown and "أني بالكراج"', () => {
    const c = passCard(input(booking(), min(5)), t)!;
    expect(c).toMatchObject({ id: passNotificationId('bk1'), phase: 'upcoming', sticky: true, imHere: 'garage', deepLink: 'driver://rajaa/pass/bk1' });
    expect(c.title).toBe('تطلع 7:30 م من كراج النهضة');
    expect(c.body).toBe('مقعدك ورا نص · الرمز 5481');
    expect(c.sub).toBe('بعد 25 دقيقة');
  });

  it('updates when the car is boarding: the car\'s distance replaces the countdown', () => {
    const b = booking({}, { state: 'boarding' });
    const c = passCard(input(b, min(20), pass({ car: { lat: 33.309, lng: 44.4, at: min(20) } })), t)!;
    expect(c.phase).toBe('boarding');
    expect(c.title).toBe('السيارة دا تحمّل بـ كراج النهضة');
    expect(c.sub).toBe('السيارة على بعد 1.0 كم');
    // A rider at a meeting point gets "أني بنقطة الصعود"; a door pickup no action.
    expect(passCard(input(booking({ pickup: { ...b.pickup, kind: 'meeting_point', nameAr: 'جسر ديالى' } }), min(5)), t)!.imHere).toBe('point');
    expect(passCard(input(booking({ pickup: { ...b.pickup, kind: 'door' } }), min(5)), t)!.imHere).toBeNull();
  });

  it('on board, then on the road, then "وصلت بالسلامة" with the fare (dismissible)', () => {
    const on = passCard(input(booking({ state: 'checked_in' }, { state: 'boarding' }), min(28)), t)!;
    expect(on).toMatchObject({ phase: 'on_board', title: 'صعدت · تطلع 7:30 م', body: 'مقعدك ورا نص', sticky: true, imHere: null });
    const road = passCard(input(booking({ state: 'checked_in' }, { state: 'departed' }), min(50)), t)!;
    expect(road).toMatchObject({ phase: 'on_road', title: 'بالطريق لـ العزيزية', sub: null });
    // r6: with the arrival known, the third line says when.
    const arriving = passCard({ ...input(booking({ state: 'checked_in' }, { state: 'departed' }), min(50)), arriveAt: min(150) }, t)!;
    expect(strip(arriving.sub ?? '')).toMatch(/^توصل حوالي \d{1,2}:\d{2}/);
    const done = passCard(input(booking({ state: 'completed' }, { state: 'arrived' }), min(150)), t)!;
    expect(done).toMatchObject({ phase: 'arrived', title: 'وصلت بالسلامة', sticky: false });
    expect(strip(done.body)).toBe('الأجرة 10,000 دينار');
  });

  it('goes away when the seat is gone: cancelled, moved, no-show, or the car left without him', () => {
    for (const state of ['cancelled_by_rider', 'moved', 'no_show', 'expired', 'held'] as const) expect(passPhase(booking({ state }), min(5))).toBe('gone');
    expect(passPhase(booking({}, { state: 'departed' }), min(40))).toBe('gone');
    expect(passPhase(booking({}, { state: 'cancelled_low_fill' }), min(5))).toBe('gone');
  });

  it('follows the next live booking, else a trip that just arrived', () => {
    const later = booking({ id: 'bk2' }, { departAt: min(240) });
    const now = booking();
    expect(passBooking([later, now], min(5))?.id).toBe('bk1');
    expect(passBooking([booking({ id: 'old', state: 'completed' }, { departAt: min(-90) })], NOW)?.id).toBe('old');
    expect(passBooking([booking({ id: 'old', state: 'completed' }, { departAt: min(-8 * 60) })], NOW)).toBeNull();
    expect(passBooking([booking({ state: 'cancelled_by_rider' })], NOW)).toBeNull();
  });

  it('an unchanged card is not posted twice', () => {
    const a = passCard(input(booking(), min(5)), t);
    expect(passCardKey(a)).toBe(passCardKey(passCard(input(booking(), min(5)), t)));
    expect(passCardKey(a)).not.toBe(passCardKey(passCard(input(booking(), min(6)), t)));
    expect(passCardKey(null)).toBe('');
  });
});
