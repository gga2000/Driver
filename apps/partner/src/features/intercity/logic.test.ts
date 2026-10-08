import { describe, expect, it } from 'vitest';
import { windowText } from './labels';
import type { DemandBucket, DriverBookingRow, DriverDepartureView } from '@driver/contracts';
import {
  boardedSeats,
  clampDepart,
  clampOffer,
  clockLabel,
  dayOffset,
  dayPeriod,
  departBlockerNote,
  departReadiness,
  depositFor,
  fullCarEarnings,
  garageCell,
  legendStates,
  walkUpCash,
  manifestOrder,
  meterMoney,
  minutesUntil,
  nextSlot,
  pickupRoute,
  pinPress,
  privateRideNet,
  riderStatus,
  seatOccupants,
  splitDepartures,
  suggestedDepart,
  stepExtraHour,
  suggestedOffer,
  windowLabel,
} from './logic';

// 2026-10-03 19:00 UTC = 22:00 Baghdad.
const NOW = new Date('2026-10-03T19:00:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
const GARAGE = { lat: 32.9032, lng: 45.0578 };

function row(over: Partial<DriverBookingRow> & { bookingId: string }): DriverBookingRow {
  return {
    riderId: `r_${over.bookingId}`,
    seatIds: ['back_left'],
    state: 'booked',
    travellingAs: 'rijal',
    payment: 'wallet',
    prepaid: true,
    prepayRail: 'wallet',
    totalIqd: 10_000,
    pickup: { kind: 'garage', meetingPointId: null, nameAr: 'كراج البوابة ١', lat: GARAGE.lat, lng: GARAGE.lng, note: null, feeIqd: 0, status: 'accepted', detourMin: null, agreementId: null },
    dropoff: null,
    largeBags: false,
    atGarage: false,
    checkedInAt: null,
    meterMinutes: null,
    canNoShow: false,
    taxiDueAt: null,
    seatHeld: false,
    ...over,
  };
}

describe('clock and windows (Baghdad time)', () => {
  it('labels 12-hour clocks, day parts and windows in Baghdad time', () => {
    expect(clockLabel(NOW)).toBe('10:00 م');
    expect(dayPeriod(NOW)).toBe('night');
    expect(dayPeriod(new Date('2026-10-04T04:30:00Z'))).toBe('morning');
    expect(windowLabel(at(60), at(120))).toBe('11:00 م–12:00 ص');
    // On screen the start sits on the right (right-to-left isolate), held on one line by word joiners.
    expect(windowText(at(60), at(120))).toBe('\u206711:00 م\u2060–\u206012:00 ص\u2069');
    expect(dayOffset(at(180), NOW)).toBe(1);
    expect(minutesUntil(at(-12), NOW)).toBe(-12);
  });

  it('announce times land on the quarter hour, inside what the server accepts', () => {
    expect(nextSlot(new Date('2026-10-03T19:07:00Z'), 30).toISOString()).toBe('2026-10-03T19:45:00.000Z');
    expect(clampDepart(at(-60), NOW).getTime()).toBeGreaterThanOrEqual(at(5).getTime());
    expect(clampDepart(at(60 * 72), NOW).getTime()).toBe(at(60 * 48).getTime());
  });

  it('suggests the busiest open demand window, else 45 minutes out', () => {
    const b = (start: number, posted: number, claimed = 0): DemandBucket => ({ garageId: null, windowStart: at(start), windowEnd: at(start + 60), postedSeats: posted, claimedSeats: claimed, posts: 1 });
    expect(suggestedDepart([b(60, 3), b(120, 12), b(180, 12, 12)], NOW)).toEqual(at(120));
    expect(suggestedDepart([], NOW)).toEqual(nextSlot(NOW, 45));
  });
});

describe('money', () => {
  it('states a full car and what the driver keeps (seat 10 %, front extra 25 %)', () => {
    expect(fullCarEarnings(4, 10_000, 2_000)).toEqual({ grossIqd: 42_000, netIqd: 37_500 });
  });

  it('late meter: grace 5 min, 1,000 per started 10 min to the driver, capped at 20', () => {
    expect(meterMoney(null)).toMatchObject({ blocks: 0, toDriverIqd: 0 });
    expect(meterMoney(4)).toMatchObject({ blocks: 0, graceLeftMin: 1 });
    expect(meterMoney(12)).toMatchObject({ blocks: 1, toDriverIqd: 1_000 });
    expect(meterMoney(16)).toMatchObject({ blocks: 2, toDriverIqd: 2_000 });
    expect(meterMoney(45)).toMatchObject({ blocks: 2, atCap: true });
  });

  it('request-board offers: steps of 1,000, a stranded cap, the deposit and the 8 % take', () => {
    expect(clampOffer(24_400, null)).toBe(24_000);
    expect(clampOffer(15_000, 10_000)).toBe(10_000);
    expect(suggestedOffer({ priceCapIqd: 10_000, seats: 1, privateCar: true })).toBe(10_000);
    expect(suggestedOffer({ priceCapIqd: null, seats: 2, privateCar: false })).toBe(20_000);
    // p2: the middle of the usual range from real trips, rounded to 1,000.
    expect(suggestedOffer({ priceCapIqd: null, seats: 2, privateCar: true, usualRange: { lowIqd: 30_000, highIqd: 37_000 } })).toBe(34_000);
    expect(depositFor(25_000)).toBe(5_000);
    expect(depositFor(45_000)).toBe(9_000);
    expect(depositFor(36_000)).toBe(7_500);
    expect(privateRideNet(25_000)).toBe(23_000);
  });
});

describe('the departure', () => {
  const dep = {
    seats: [
      { id: 'front', state: 'taken', premiumIqd: 2_000, blocked: null },
      { id: 'back_left', state: 'taken', premiumIqd: 0, blocked: null },
      { id: 'back_middle', state: 'free', premiumIqd: 0, blocked: null },
      { id: 'back_right', state: 'walkup', premiumIqd: 0, blocked: null },
    ],
    walkUps: [{ seatId: 'back_right', travellingAs: 'rijal' }],
    bookings: [row({ bookingId: 'b1', seatIds: ['front'], state: 'checked_in' }), row({ bookingId: 'b2', meterMinutes: 9 }), row({ bookingId: 'b3', seatIds: [], state: 'no_show' })],
  } as unknown as DriverDepartureView;

  it('maps every seat to its rider by first name, walk-ups and free seats', () => {
    const occ = seatOccupants(dep, [{ bookingId: 'b1', riderId: 'r_b1', firstName: 'زهراء' }]);
    expect(occ.get('front')).toMatchObject({ kind: 'rider', firstName: 'زهراء', status: 'checked_in' });
    expect(occ.get('back_left')).toMatchObject({ kind: 'rider', firstName: null, status: 'late' });
    expect(occ.get('back_middle')).toMatchObject({ kind: 'free' });
    expect(occ.get('back_right')).toMatchObject({ kind: 'walkup', travellingAs: 'rijal' });
  });

  it('counts boarded seats, not bookings (one booking can hold two seats)', () => {
    const bookings = [
      row({ bookingId: 'z', seatIds: ['front'], state: 'checked_in' }),
      row({ bookingId: 'm', seatIds: ['rear_left', 'rear_middle'], state: 'checked_in' }),
      row({ bookingId: 'h', seatIds: ['middle_left'] }),
      row({ bookingId: 'a', seatIds: [], state: 'no_show' }),
    ];
    expect(boardedSeats(bookings)).toBe(3);
    expect(boardedSeats([])).toBe(0);
  });

  it('rider status and manifest order: the late and pending first, no-shows last', () => {
    expect(riderStatus(row({ bookingId: 'x', state: 'held' }))).toBe('held');
    expect(riderStatus(row({ bookingId: 'x', atGarage: true }))).toBe('at_garage');
    const door = row({ bookingId: 'd', pickup: { ...row({ bookingId: 'q' }).pickup, kind: 'door', status: 'pending' } });
    expect(riderStatus(door)).toBe('pickup_pending');
    expect(manifestOrder([...dep.bookings, door]).map((b) => b.bookingId)).toEqual(['b2', 'd', 'b1', 'b3']);
  });

  it('"انطلقنا" opens only without blockers, and says what blocks it', () => {
    expect(departReadiness({ state: 'boarding', departBlockers: [] }).canDepart).toBe(true);
    const r = departReadiness({
      state: 'boarding',
      departBlockers: [
        { bookingId: 'a', reason: 'not_checked_in' },
        { bookingId: 'b', reason: 'not_checked_in' },
        { bookingId: 'c', reason: 'pickup_pending' },
        { bookingId: null, reason: 'too_early_not_full' },
      ],
    });
    expect(r).toEqual({ canDepart: false, notCheckedIn: 2, pickupPending: 1, tooEarly: true });
    expect(departReadiness({ state: 'departed', departBlockers: [] }).canDepart).toBe(false);
  });

  it('garage mode: the slide names the first blocker ("3 ركاب بعدهم"), then the pickup, then the time', () => {
    expect(departBlockerNote({ canDepart: false, notCheckedIn: 3, pickupPending: 1, tooEarly: true })).toEqual({ kind: 'riders', n: 3 });
    expect(departBlockerNote({ canDepart: false, notCheckedIn: 0, pickupPending: 1, tooEarly: true })).toEqual({ kind: 'pickup' });
    expect(departBlockerNote({ canDepart: false, notCheckedIn: 0, pickupPending: 0, tooEarly: true })).toEqual({ kind: 'early' });
    expect(departBlockerNote({ canDepart: true, notCheckedIn: 0, pickupPending: 0, tooEarly: false })).toBeNull();
  });

  it('garage mode: a walk-up pays the server seat price plus that seat\'s premium', () => {
    const d = { seatPriceIqd: 10_000, seats: dep.seats };
    expect(walkUpCash(d, 'front')).toBe(12_000);
    expect(walkUpCash(d, 'back_middle')).toBe(10_000);
  });

  it('garage mode: three seat columns fit the phone (360 and 390 wide), capped on tablets', () => {
    expect(garageCell(390)).toEqual({ w: 104, h: 100 });
    const small = garageCell(360);
    expect(small.w * 3 + 8 * 2 + 14 * 2).toBeLessThanOrEqual(360 - 32);
    expect(garageCell(1280).w).toBe(124);
  });

  it('garage mode: the legend lists only the states on the map, in a fixed order', () => {
    expect(legendStates(seatOccupants(dep, []))).toEqual(['checked_in', 'late', 'walkup', 'free']);
  });

  it('pickup run: garage, accepted doors nearest first, then meeting points by distance', () => {
    const base = row({ bookingId: 'g' }).pickup;
    const far = row({ bookingId: 'far', pickup: { ...base, kind: 'door', lat: 32.88, lng: 45.07, status: 'accepted' } });
    const near = row({ bookingId: 'near', pickup: { ...base, kind: 'door', lat: 32.90, lng: 45.06, status: 'accepted' } });
    const pending = row({ bookingId: 'pend', pickup: { ...base, kind: 'door', lat: 32.9, lng: 45.05, status: 'pending' } });
    const mp = row({ bookingId: 'mp', pickup: { ...base, kind: 'meeting_point', meetingPointId: 'mp_x', nameAr: 'مفرق المدائن', lat: 33.0985, lng: 44.5802 } });
    const route = pickupRoute(GARAGE, [mp, far, pending, near, row({ bookingId: 'g' })]);
    expect(route.map((s) => s.key)).toEqual(['garage', 'door:near', 'door:far', 'mp:mp_x']);
    expect(route[0]!.bookings.map((b) => b.bookingId)).toEqual(['g']);
    expect(route[1]!.legKm).toBeGreaterThan(0);
  });

  it('my departures: live by time; past only when they ran or were cancelled', () => {
    const d = (id: string, state: DriverDepartureView['state'], min: number, departed = false) => ({ id, state, departAt: at(min), departedAt: departed ? at(min) : null }) as unknown as DriverDepartureView;
    const { live, past } = splitDepartures([d('b', 'scheduled', 200), d('a', 'boarding', -10), d('c', 'arrived', -300, true), d('closed', 'closed', -100), d('x', 'cancelled_low_fill', -50)], NOW);
    expect(live.map((x) => x.id)).toEqual(['a', 'b']);
    expect(past.map((x) => x.id)).toEqual(['x', 'c']);
  });
});

describe('PIN pad', () => {
  it('types up to four digits and deletes', () => {
    expect(['1', '2', '3', '4', '5'].reduce(pinPress, '')).toBe('1234');
    expect(pinPress('12', 'back')).toBe('1');
    expect(pinPress('12', 'x')).toBe('12');
  });
});

describe('extra waiting hour price (w1)', () => {
  it('starts unset; plus sets 1,000, minus sets free; steps by 1,000 between 0 and 50,000', () => {
    expect(stepExtraHour(null, 1)).toBe(1_000);
    expect(stepExtraHour(null, -1)).toBe(0);
    expect(stepExtraHour(5_000, 1)).toBe(6_000);
    expect(stepExtraHour(0, -1)).toBe(0);
    expect(stepExtraHour(50_000, 1)).toBe(50_000);
  });
});
