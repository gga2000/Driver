import { describe, expect, it } from 'vitest';
import type { BoardSeat, BookingView, DemandBucket, DepartureCard, IntercitySeatId } from '@driver/contracts';
import { createT } from '@driver/i18n';
import {
  activeBooking,
  blockedReason,
  boardSummary,
  bookingHref,
  cancelRule,
  carAvailable,
  clockCountdown,
  clockLabel,
  windowLabel,
  compareDepartures,
  demandBanner,
  demandWindows,
  depositFor,
  doorFeeEstimate,
  endpoints,
  fillTone,
  flip,
  groupBoard,
  holdCountdown,
  isBoardingOpen,
  labelWindow,
  maxSeatsFor,
  minutesUntil,
  openPosts,
  pickupPointsInOrder,
  pruneSelection,
  quoteSelection,
  requestHourAvailable,
  requestWhen,
  rowOptions,
  suggestDirection,
  toSeatMap,
  waitingWithMe,
  publicPlaceName,
} from './logic';

describe('publicPlaceName (audit C-16)', () => {
  it('never shows customers the "(مسودة)" draft marker', () => {
    expect(publicPlaceName('جسر ديالى (مسودة)')).toBe('جسر ديالى');
    expect(publicPlaceName('كراج الكوت ( مسودة )')).toBe('كراج الكوت');
    expect(publicPlaceName('كراج النهضة')).toBe('كراج النهضة');
  });
});

const MIN = 60_000;
/** 2026-10-03 12:00 Baghdad (09:00 UTC). */
const NOON = new Date('2026-10-03T09:00:00Z');
const at = (min: number) => new Date(NOON.getTime() + min * MIN);
const tAr = createT('ar-IQ');

const GARAGES = [
  { id: 'mp_garage_souq', cityId: 'aziziyah', nameAr: 'كراج السوق', lat: 32.9062, lng: 45.0612 },
  { id: 'mp_garage_bab2', cityId: 'aziziyah', nameAr: 'كراج البوابة ٢', lat: 32.9088, lng: 45.0648 },
  { id: 'mp_garage_bab1', cityId: 'aziziyah', nameAr: 'كراج البوابة ١', lat: 32.9032, lng: 45.0578 },
  { id: 'mp_garage_nahdha', cityId: 'baghdad', nameAr: 'كراج النهضة', lat: 33.3344, lng: 44.4165 },
  { id: 'mp_garage_kut', cityId: 'kut', nameAr: 'كراج الكوت', lat: 32.5126, lng: 45.8189 },
];

function seats(layout: 4 | 6 | 7, states: Partial<Record<IntercitySeatId, Partial<BoardSeat>>> = {}): BoardSeat[] {
  const ids: Record<4 | 6 | 7, IntercitySeatId[]> = {
    4: ['front', 'back_left', 'back_middle', 'back_right'],
    6: ['front', 'middle_left', 'middle_right', 'rear_left', 'rear_middle', 'rear_right'],
    7: ['front', 'middle_left', 'middle_middle', 'middle_right', 'rear_left', 'rear_middle', 'rear_right'],
  };
  return ids[layout].map((id) => ({ id, state: 'free', premiumIqd: id === 'front' ? 2000 : 0, blocked: null, ...states[id] }));
}

function dep(over: Partial<DepartureCard> & { id: string }): DepartureCard {
  const s = over.seats ?? seats(4);
  const free = s.filter((x) => x.state === 'free').length;
  return {
    corridorId: 'aziziyah_baghdad',
    direction: 'to_aziziyah',
    garageId: 'mp_garage_nahdha',
    fromCityId: 'baghdad',
    toCityId: 'aziziyah',
    driverId: 'drv_1',
    vehicle: { kind: 'saloon', layout: 4, plate: '12345 بغداد', modelKey: null, model: null, color: null, noSmoking: false, bigBags: false },
    departAt: at(60),
    latestDepartureAt: at(105),
    state: 'scheduled',
    familyOnly: false,
    seatPriceIqd: 10_000,
    frontPremiumIqd: 2_000,
    fill: { seatsTotal: s.length, booked: s.length - free, held: 0, walkUps: 0, walkUpsCounted: 0, filled: s.length - free, free },
    frontSeat: 'free',
    doorPickupsLeft: 2,
    meetingPoints: [],
    ...over,
    seats: s,
  };
}

function booking(over: Partial<BookingView> & { id: string }): BookingView {
  return {
    departureId: 'dep_1',
    riderId: 'me',
    state: 'booked',
    origin: 'rider',
    seatIds: ['back_left'],
    travellingAs: 'rijal',
    seatPriceIqd: 10_000,
    frontPremiumIqd: 0,
    pickupFeeIqd: 0,
    totalIqd: 10_000,
    payment: 'cash',
    prepaid: false,
    prepayRail: 'cash_reservation',
    heldUntil: null,
    pin: '1234',
    pickup: { kind: 'garage', meetingPointId: null, nameAr: null, lat: 0, lng: 0, note: null, feeIqd: 0, status: 'accepted', detourMin: null },
    largeBags: false,
    movedToBookingId: null,
    movedFromBookingId: null,
    checkedInAt: null,
    lateMinutes: null,
    departure: {
      id: 'dep_1',
      corridorId: 'aziziyah_baghdad',
      direction: 'to_aziziyah',
      garageId: 'mp_garage_nahdha',
      departAt: at(60),
      latestDepartureAt: at(105),
      state: 'scheduled',
      vehicle: { kind: 'saloon', layout: 4, plate: 'x', modelKey: null, model: null, color: null, noSmoking: false, bigBags: false },
      driverId: 'drv_1',
    },
    createdAt: NOON,
    completedAt: null,
    rating: null,
    pointsEarned: null,
    ...over,
  };
}

describe('corridor and direction', () => {
  it('names the two ends of a run', () => {
    expect(endpoints('baghdad', 'to_aziziyah')).toEqual({ from: 'baghdad', to: 'aziziyah' });
    expect(endpoints('kut', 'from_aziziyah')).toEqual({ from: 'aziziyah', to: 'kut' });
    expect(flip('to_aziziyah')).toBe('from_aziziyah');
  });
  it('suggests the way back when the last fix is near a Baghdad garage', () => {
    expect(suggestDirection({ lat: 33.31, lng: 44.4 }, GARAGES)).toEqual({ direction: 'to_aziziyah', cityId: 'baghdad' });
    expect(suggestDirection({ lat: 32.905, lng: 45.06 }, GARAGES)).toEqual({ direction: 'from_aziziyah', cityId: 'aziziyah' });
    expect(suggestDirection({ lat: 32.52, lng: 45.81 }, GARAGES)?.cityId).toBe('kut');
  });
  it('keeps the default without a fix or far from every garage (web, Basra)', () => {
    expect(suggestDirection(null, GARAGES)).toBeNull();
    expect(suggestDirection({ lat: 30.5, lng: 47.8 }, GARAGES)).toBeNull();
  });
});

describe('garage board grouping and sorting', () => {
  it('groups by the origin side in board order, with empty garages kept', () => {
    const deps = [
      dep({ id: 'b', garageId: 'mp_garage_bab2', fromCityId: 'aziziyah', departAt: at(30) }),
      dep({ id: 'a', garageId: 'mp_garage_bab1', fromCityId: 'aziziyah', departAt: at(90) }),
      dep({ id: 'n', garageId: 'mp_garage_nahdha', departAt: at(10) }),
    ];
    const g = groupBoard(deps, GARAGES, 'aziziyah', NOON);
    expect(g.map((x) => x.garage.id)).toEqual(['mp_garage_bab1', 'mp_garage_bab2', 'mp_garage_souq']);
    expect(g.map((x) => x.departures.map((d) => d.id))).toEqual([['a'], ['b'], []]);
    expect(groupBoard(deps, GARAGES, 'baghdad', NOON).map((x) => x.garage.id)).toEqual(['mp_garage_nahdha']);
  });
  it('sorts earliest first, the fuller car first at the same time', () => {
    const emptyish = dep({ id: 'e', departAt: at(30) });
    const fuller = dep({ id: 'f', departAt: at(30), seats: seats(4, { front: { state: 'taken' }, back_left: { state: 'taken' } }) });
    const later = dep({ id: 'l', departAt: at(20) });
    expect([emptyish, fuller, later].sort(compareDepartures).map((d) => d.id)).toEqual(['l', 'f', 'e']);
  });
  it('drops runs past their hard latest time and ones no longer bookable', () => {
    const deps = [
      dep({ id: 'gone', latestDepartureAt: at(-1) }),
      dep({ id: 'left', state: 'departed' }),
      dep({ id: 'boarding', state: 'boarding' }),
    ];
    expect(groupBoard(deps, GARAGES, 'baghdad', NOON)[0]!.departures.map((d) => d.id)).toEqual(['boarding']);
  });
  it('summarises cars with a free seat for the home card', () => {
    const full = dep({ id: 'full', departAt: at(5), seats: seats(4, { front: { state: 'taken' }, back_left: { state: 'taken' }, back_middle: { state: 'taken' }, back_right: { state: 'walkup' } }) });
    const s = boardSummary([dep({ id: 'x', departAt: at(40) }), full, dep({ id: 'y', departAt: at(20) })], NOON);
    expect(s.count).toBe(2);
    expect(s.next?.id).toBe('y');
  });
  it('fill badge tones', () => {
    expect(fillTone({ free: 0, seatsTotal: 4 })).toBe('full');
    expect(fillTone({ free: 1, seatsTotal: 4 })).toBe('last');
    expect(fillTone({ free: 2, seatsTotal: 4 })).toBe('filling');
    expect(fillTone({ free: 5, seatsTotal: 7 })).toBe('open');
  });
  it('boarding opens at T−30 and minutes count up', () => {
    expect(isBoardingOpen(at(30), NOON)).toBe(true);
    expect(isBoardingOpen(at(31), NOON)).toBe(false);
    expect(minutesUntil(at(12.5), NOON)).toBe(13);
    expect(minutesUntil(at(-3), NOON)).toBe(0);
  });
});

describe('seats', () => {
  const s = seats(4, { front: { state: 'taken' }, back_left: { state: 'taken' }, back_middle: { blocked: 'adjacency' }, back_right: { state: 'taken' } });
  it('maps board seats onto the SeatMap with premium and blocked marks', () => {
    const m = toSeatMap(seats(4, { back_middle: { blocked: 'family_only' } }));
    expect(m.find((x) => x.id === 'front')).toEqual({ id: 'front', state: 'free', premium: 2000 });
    expect(m.find((x) => x.id === 'back_middle')).toEqual({ id: 'back_middle', state: 'free', blocked: true });
    expect(blockedReason(s, 'back_middle')).toBe('adjacency');
  });
  it('drops picks that stopped being selectable', () => {
    expect(pruneSelection(['back_middle', 'front'], s)).toEqual([]);
    expect(pruneSelection(['back_right'], seats(4))).toEqual(['back_right']);
  });
  it('offers a whole row only when every seat in it is free, and the car only when empty', () => {
    expect(rowOptions(4, seats(4), false, 'rijal')).toEqual([{ row: 'back', seatIds: ['back_left', 'back_middle', 'back_right'], available: true }]);
    expect(rowOptions(4, s, false, 'rijal')[0]!.available).toBe(false);
    expect(rowOptions(7, seats(7), true, 'nisa').every((r) => !r.available)).toBe(true);
    expect(carAvailable(seats(6), false, 'rijal')).toBe(true);
    expect(carAvailable(seats(6), true, 'rijal')).toBe(false);
    expect(carAvailable(s, false, 'aila')).toBe(false);
  });
  it('lets a family take the car, others up to four', () => {
    expect(maxSeatsFor('aila', 7)).toBe(7);
    expect(maxSeatsFor('rijal', 7)).toBe(4);
    expect(maxSeatsFor('nisa', 4)).toBe(4);
  });
  it('quotes seats, front premium and pickup', () => {
    expect(quoteSelection(['front', 'back_left'], { seatPriceIqd: 10_000, frontPremiumIqd: 2_000 }, 1_000)).toEqual({
      seats: 2,
      seatPriceIqd: 10_000,
      baseIqd: 20_000,
      frontIqd: 2_000,
      pickupIqd: 1_000,
      totalIqd: 23_000,
    });
    expect(quoteSelection([], { seatPriceIqd: 10_000, frontPremiumIqd: 2_000 }, 1_000).totalIqd).toBe(0);
  });
  it('prices the door pickup like the server (1,000 + 500 per km past 2 km, none past 10 km)', () => {
    const g = { lat: 32.9032, lng: 45.0578 };
    expect(doorFeeEstimate({ lat: 32.9062, lng: 45.0612 }, g)).toBe(1000);
    expect(doorFeeEstimate({ lat: 32.94, lng: 45.0578 }, g)).toBe(2500); // ~4.1 km → 3 started km past 2 → 1,000 + 1,500
    expect(doorFeeEstimate({ lat: 33.1, lng: 45.0578 }, g)).toBeNull();
  });
  it('lists on-the-way points in road order without ones at the destination', () => {
    const nahdha = { lat: 33.3344, lng: 44.4165 };
    const aziziyah = [{ lat: 32.9032, lng: 45.0578 }];
    const pts = [
      { id: 'north_exit', lat: 32.9455, lng: 45.0296 },
      { id: 'madain', lat: 33.0985, lng: 44.5802 },
      { id: 'diyala', lat: 33.2348, lng: 44.5231 },
    ];
    expect(pickupPointsInOrder(pts, nahdha, aziziyah).map((p) => p.id)).toEqual(['diyala', 'madain']);
    expect(pickupPointsInOrder(pts, aziziyah[0]!, [nahdha]).map((p) => p.id)).toEqual(['north_exit', 'madain', 'diyala']);
  });
});

describe('booking state helpers', () => {
  it('pins a live hold first, else the next booked trip', () => {
    const held = booking({ id: 'h', state: 'held', heldUntil: at(5) });
    const lapsed = booking({ id: 'x', state: 'held', heldUntil: at(-1) });
    const soon = booking({ id: 's', departure: { ...booking({ id: 'q' }).departure, departAt: at(20) } });
    const later = booking({ id: 'l' });
    const done = booking({ id: 'd', state: 'completed' });
    expect(activeBooking([later, soon, held, done], NOON)?.id).toBe('h');
    expect(activeBooking([later, soon, lapsed, done], NOON)?.id).toBe('s');
    expect(activeBooking([done], NOON)).toBeNull();
  });
  it('opens the pay step while held and the pass once booked', () => {
    expect(bookingHref({ id: 'b1', state: 'held' })).toBe('/rajaa/booking/b1');
    expect(bookingHref({ id: 'b1', state: 'booked' })).toBe('/rajaa/pass/b1');
  });
  it('states the cancel rule the server applies', () => {
    expect(cancelRule(booking({ id: 'h', state: 'held' }), NOON)).toEqual({ kind: 'hold', canCancel: true });
    expect(cancelRule(booking({ id: 'c' }), at(59))).toEqual({ kind: 'cash', canCancel: true });
    const prepaid = booking({ id: 'p', prepaid: true, payment: 'wallet', prepayRail: 'wallet' });
    expect(cancelRule(prepaid, at(29))).toEqual({ kind: 'prepaid', canCancel: true, until: at(30) });
    expect(cancelRule(prepaid, at(30)).canCancel).toBe(false);
    expect(cancelRule({ ...prepaid, origin: 'moved' }, at(50)).kind).toBe('cash');
    expect(cancelRule(booking({ id: 'in', state: 'checked_in' }), NOON).canCancel).toBe(false);
    expect(cancelRule(booking({ id: 'gone', departure: { ...booking({ id: 'q' }).departure, state: 'departed' } }), NOON).canCancel).toBe(false);
  });
});

describe('hold countdown', () => {
  it('counts the 10-minute hold down against heldUntil', () => {
    const h = holdCountdown(at(10), NOON);
    expect(h).toMatchObject({ label: '10:00', expired: false, urgent: false });
    expect(h.elapsedFraction).toBe(0);
    expect(holdCountdown(at(10), at(4.5)).label).toBe('5:30');
    expect(holdCountdown(at(10), at(9.5))).toMatchObject({ label: '0:30', urgent: true });
    expect(holdCountdown(at(10), at(11))).toMatchObject({ label: '0:00', expired: true, elapsedFraction: 1 });
  });
  it('rounds partial seconds up and never shows more than the hold', () => {
    expect(clockCountdown(61_001)).toBe('1:02');
    expect(holdCountdown(at(15), NOON).label).toBe('10:00');
  });
});

describe('demand windows', () => {
  it('builds هسة / خلال ساعة / 4–6 / الليلة on Baghdad time', () => {
    const w = demandWindows(at(2)); // 12:02 Baghdad
    expect(w.map((x) => x.id)).toEqual(['now', 'hour', 'afternoon', 'tonight']);
    expect(w[0]).toMatchObject({ start: at(2), end: at(35), available: true });
    expect(w[1]).toMatchObject({ start: at(2), end: at(65) });
    expect(w[2]).toMatchObject({ start: at(240), end: at(360), available: true });
    expect(w[3]).toMatchObject({ start: at(360), end: at(720), available: true });
  });
  it('starts a window under way now and disables one that is over', () => {
    const w = demandWindows(at(5 * 60 + 15)); // 17:15
    expect(w[2]).toMatchObject({ start: at(5 * 60 + 15), end: at(360), available: true });
    const late = demandWindows(at(7 * 60)); // 19:00
    expect(late[2]!.available).toBe(false);
    expect(late[3]).toMatchObject({ start: at(7 * 60), available: true });
  });
  it('keeps every window inside the server rules (ends ahead, ≤ 12 h)', () => {
    for (const w of demandWindows(at(0)).filter((x) => x.available)) {
      expect(w.end.getTime()).toBeGreaterThan(NOON.getTime());
      expect(w.end.getTime() - w.start.getTime()).toBeLessThanOrEqual(12 * 60 * MIN);
    }
  });
  it('labels windows with the part of day (R-06)', () => {
    expect(windowLabel(tAr, at(240), at(360))).toBe('بين 4 و 6 العصر');
    expect(windowLabel(tAr, at(480), at(600))).toBe('بين 8 و 10 بالليل');
    expect(windowLabel(tAr, at(5 * 60 + 52), at(6 * 60 + 53))).toBe('بين 5:50 العصر و 6:55 المسا');
    expect(clockLabel(at(-5 * 60 + 5))).toBe('7:05 ص');
    expect(labelWindow(at(3), at(62))).toEqual({ start: at(0), end: at(65) });
  });
});

describe('demand banner and waiting count', () => {
  const bucket = (o: Partial<DemandBucket>): DemandBucket => ({
    garageId: null,
    windowStart: at(240),
    windowEnd: at(360),
    postedSeats: 1,
    claimedSeats: 0,
    posts: 1,
    ...o,
  });
  it('sums posts per window across garages and picks the busiest', () => {
    const b = demandBanner(
      [
        bucket({ posts: 3, postedSeats: 4 }),
        bucket({ garageId: 'mp_garage_nahdha', posts: 4, postedSeats: 4 }),
        bucket({ windowStart: at(30), windowEnd: at(90), posts: 5, postedSeats: 5 }),
      ],
      NOON,
    );
    expect(b).toMatchObject({ posts: 7, seats: 8, windowStart: at(240) });
  });
  it('ignores windows that ended and claimed-only buckets', () => {
    expect(demandBanner([bucket({ windowEnd: at(-1), posts: 9 }), bucket({ postedSeats: 0, claimedSeats: 3, posts: 3 })], NOON)).toBeNull();
  });
  it('estimates open posts when some were claimed', () => {
    expect(openPosts({ posts: 4, postedSeats: 2, claimedSeats: 2 })).toBe(2);
    expect(openPosts({ posts: 4, postedSeats: 0, claimedSeats: 4 })).toBe(0);
  });
  it('counts the others whose window overlaps mine', () => {
    const mine = { windowStart: at(0), windowEnd: at(60) };
    const buckets = [
      bucket({ windowStart: at(0), windowEnd: at(60), posts: 7, postedSeats: 7 }),
      bucket({ windowStart: at(1), windowEnd: at(61), posts: 1, postedSeats: 1 }), // mine
      bucket({ windowStart: at(240), windowEnd: at(360), posts: 9, postedSeats: 10 }),
    ];
    expect(waitingWithMe(mine, buckets)).toBe(7);
    expect(waitingWithMe(mine, [bucket({ windowStart: at(1), windowEnd: at(61) })])).toBe(0);
  });
});

describe('request board', () => {
  it('deposit is 20 % rounded up to 500, at least 5,000, never above the price', () => {
    expect(depositFor(45_000)).toBe(9_000);
    expect(depositFor(47_300)).toBe(9_500);
    expect(depositFor(20_000)).toBe(5_000);
    expect(depositFor(3_000)).toBe(3_000);
  });
  it('builds the trip time from day and hour chips on Baghdad time', () => {
    expect(requestWhen('today', 16, NOON)).toEqual(at(240));
    expect(requestWhen('tomorrow', 8, NOON)).toEqual(at(20 * 60));
    expect(requestHourAvailable('today', 8, NOON)).toBe(false);
    expect(requestHourAvailable('today', 16, NOON)).toBe(true);
    expect(requestHourAvailable('tomorrow', 8, NOON)).toBe(true);
  });
});
