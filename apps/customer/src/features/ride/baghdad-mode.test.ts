import { describe, expect, it } from 'vitest';
import type { BookingView, DepartureCard, IntercityNetwork } from '@driver/contracts';
import { baghdadModeState, BAGHDAD_MODE_AHEAD_H, boardUntil, carsBack, corridorBack, seatBack, type BaghdadModeInput } from './baghdad-mode';

const NOW = new Date('2026-10-07T12:00:00Z');
const MIN = 60_000;
const at = (min: number) => new Date(NOW.getTime() + min * MIN);

const NETWORK = {
  garages: [
    { id: 'mp_garage_nahdha', cityId: 'baghdad', nameAr: 'كراج النهضة', nameEn: 'Nahdha garage', lat: 33.3344, lng: 44.4165, geofenceM: 150, draft: false },
    { id: 'mp_garage_kut', cityId: 'kut', nameAr: 'كراج الكوت (مسودة)', nameEn: 'Kut garage', lat: 32.5126, lng: 45.8189, geofenceM: 150, draft: true },
    { id: 'mp_garage_bab1', cityId: 'aziziyah', nameAr: 'كراج البوابة 1', nameEn: 'Gate 1 garage', lat: 32.9032, lng: 45.0578, geofenceM: 150, draft: false },
  ],
  corridors: [
    { id: 'aziziyah_baghdad', cityId: 'baghdad', primary: true },
    { id: 'aziziyah_kut', cityId: 'kut', primary: false },
  ],
} as unknown as IntercityNetwork;

function dep(over: Partial<DepartureCard> & { free?: number } = {}): DepartureCard {
  const { free = 3, ...rest } = over;
  return {
    id: 'dep_1',
    corridorId: 'aziziyah_baghdad',
    direction: 'to_aziziyah',
    garageId: 'mp_garage_nahdha',
    fromCityId: 'baghdad',
    toCityId: 'aziziyah',
    driverId: 'drv_1',
    vehicle: { kind: 'saloon', layout: 4, plate: '12345 بغداد', modelKey: null, model: null, color: null, ac: false, noSmoking: false, bigBags: false },
    departAt: at(30),
    latestDepartureAt: at(75),
    state: 'scheduled',
    familyOnly: false,
    seatPriceIqd: 15_000,
    frontPremiumIqd: 2_000,
    seats: [],
    fill: { seatsTotal: 4, booked: 4 - free, held: 0, walkUps: 0, walkUpsCounted: 0, filled: 4 - free, free },
    frontSeat: 'taken',
    doorPickupsLeft: 0,
    meetingPoints: [],
    ...rest,
  };
}

function booking(over: { state?: BookingView['state']; departAt?: Date; direction?: 'to_aziziyah' | 'from_aziziyah'; corridorId?: string; depState?: BookingView['departure']['state']; heldUntil?: Date | null } = {}): BookingView {
  const departAt = over.departAt ?? at(40);
  return {
    id: 'bk_1',
    departureId: 'dep_9',
    riderId: 'p_1',
    state: over.state ?? 'booked',
    seatIds: ['back_right'],
    heldUntil: over.heldUntil ?? null,
    departure: {
      id: 'dep_9',
      corridorId: over.corridorId ?? 'aziziyah_baghdad',
      direction: over.direction ?? 'to_aziziyah',
      garageId: 'mp_garage_nahdha',
      departAt,
      latestDepartureAt: new Date(departAt.getTime() + 45 * MIN),
      state: over.depState ?? 'scheduled',
    },
  } as unknown as BookingView;
}

const input = (over: Partial<BaghdadModeInput> = {}): BaghdadModeInput => ({
  cityId: 'baghdad',
  network: NETWORK,
  board: { data: [dep()], isError: false },
  bookings: [],
  online: true,
  now: NOW,
  ...over,
});

describe('Baghdad mode (ride idea n9)', () => {
  it('picks the corridor home from the city', () => {
    expect(corridorBack(NETWORK, 'baghdad')).toBe('aziziyah_baghdad');
    expect(corridorBack(NETWORK, 'kut')).toBe('aziziyah_kut');
    expect(corridorBack(NETWORK, 'aziziyah')).toBeNull();
    expect(corridorBack(undefined, 'baghdad')).toBeNull();
  });

  it('lists open cars back with a free seat, earliest first, today apart from later', () => {
    const cars = carsBack(
      [
        dep({ id: 'late', departAt: at(90) }),
        dep({ id: 'full', departAt: at(10), free: 0 }),
        dep({ id: 'gone', departAt: at(-60), latestDepartureAt: at(-15) }),
        dep({ id: 'cancelled', state: 'cancelled_low_fill' }),
        dep({ id: 'out', direction: 'from_aziziyah' }),
        dep({ id: 'soon', departAt: at(20) }),
        dep({ id: 'tomorrow', departAt: at(19 * 60), latestDepartureAt: at(19 * 60 + 45) }),
      ],
      NETWORK,
      NOW,
    );
    expect(cars.today.map((c) => c.departureId)).toEqual(['soon', 'late']);
    expect(cars.later.map((c) => c.departureId)).toEqual(['tomorrow']);
    expect(cars.today[0]).toMatchObject({ garageNameAr: 'كراج النهضة', free: 3, seatPriceIqd: 15_000, corridorId: 'aziziyah_baghdad' });
  });

  it('is hidden outside a far city or without a corridor home', () => {
    expect(baghdadModeState(input({ cityId: null }))).toEqual({ kind: 'hidden' });
    expect(baghdadModeState(input({ cityId: 'aziziyah' }))).toEqual({ kind: 'hidden' });
  });

  it('shows the next car and the one after', () => {
    const s = baghdadModeState(input({ board: { data: [dep({ id: 'b', departAt: at(70) }), dep({ id: 'a' }), dep({ id: 'c', departAt: at(120) })], isError: false } }));
    expect(s.kind).toBe('next');
    if (s.kind !== 'next') return;
    expect(s.next.departureId).toBe('a');
    expect(s.after?.departureId).toBe('b');
  });

  it('says when nothing goes back, naming the first car announced later when there is one', () => {
    expect(baghdadModeState(input({ board: { data: [], isError: false } }))).toEqual({ kind: 'empty', cityId: 'baghdad', corridorId: 'aziziyah_baghdad', announced: null, offline: false });
    const s = baghdadModeState(input({ board: { data: [dep({ id: 'morning', departAt: at(20 * 60), latestDepartureAt: at(20 * 60 + 45) })], isError: false } }));
    expect(s.kind === 'empty' && s.announced?.departureId).toBe('morning');
  });

  it('leads with his own seat on a car back today', () => {
    const s = baghdadModeState(input({ bookings: [booking()] }));
    expect(s).toMatchObject({ kind: 'booked', seat: { bookingId: 'bk_1', state: 'booked', garageNameAr: 'كراج النهضة', seatIds: ['back_right'] } });
    // Even before the board answers.
    expect(baghdadModeState(input({ bookings: [booking()], board: { data: undefined, isError: false } })).kind).toBe('booked');
    // On the road it stays (the n10 switch matters most then).
    expect(baghdadModeState(input({ bookings: [booking({ state: 'checked_in', departAt: at(-30), depState: 'departed' })] })).kind).toBe('booked');
  });

  it('ignores seats that are not his way back today', () => {
    expect(seatBack([booking({ direction: 'from_aziziyah' })], 'aziziyah_baghdad', NETWORK, NOW)).toBeNull();
    expect(seatBack([booking({ corridorId: 'aziziyah_kut' })], 'aziziyah_baghdad', NETWORK, NOW)).toBeNull();
    expect(seatBack([booking({ departAt: at(13 * 60) })], 'aziziyah_baghdad', NETWORK, NOW)).toBeNull();
    expect(seatBack([booking({ state: 'cancelled' })], 'aziziyah_baghdad', NETWORK, NOW)).toBeNull();
    expect(seatBack([booking({ state: 'held', heldUntil: at(-1) })], 'aziziyah_baghdad', NETWORK, NOW)).toBeNull();
    expect(seatBack([booking({ state: 'held', heldUntil: at(8) })], 'aziziyah_baghdad', NETWORK, NOW)?.state).toBe('held');
  });

  it('waits: loading, the error with its retry, offline; keeps the cars when the net drops', () => {
    expect(baghdadModeState(input({ board: { data: undefined, isError: false } })).kind).toBe('loading');
    expect(baghdadModeState(input({ board: { data: undefined, isError: true } })).kind).toBe('error');
    expect(baghdadModeState(input({ board: { data: undefined, isError: false }, online: false })).kind).toBe('offline');
    expect(baghdadModeState(input({ online: false }))).toMatchObject({ kind: 'next', offline: true });
  });

  it('reads the board to a fixed hour mark ahead', () => {
    const until = boardUntil(new Date('2026-10-07T12:20:00Z'));
    expect(until.toISOString()).toBe(new Date(Date.parse('2026-10-07T13:00:00Z') + BAGHDAD_MODE_AHEAD_H * 3_600_000).toISOString());
    expect(boardUntil(new Date('2026-10-07T12:50:00Z')).getTime()).toBe(until.getTime());
  });
});
