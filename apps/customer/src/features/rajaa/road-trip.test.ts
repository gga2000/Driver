import { describe, expect, it } from 'vitest';
import { intercityRoad } from '@driver/map/pieces/road';
import { bearingAhead, bookingRoadTrip, offRoadM, pointAt, roadForCities, roadKeyOf, roadTrip, sharedRoadTrip, stripBounds, type TripPoint } from './road-trip';
import { roadWords, timelineStops } from './road-words';

const MIN = 60_000;
const baghdad = intercityRoad('bab1', 'baghdad', 'from_aziziyah');
const at = (m: number) => {
  const [lng, lat] = pointAt(baghdad, m);
  return { lat, lng };
};
const departAt = new Date('2026-10-12T04:00:00Z');
const names = (stops: readonly { name: string }[]) => stops.map((s) => s.name);
/** The corridor's draft checkpoints (intercity.config.ts): north Aziziyah and Madain sit off the fast road. */
const CHECKPOINTS: TripPoint[] = [
  { id: 'cp_north', kind: 'checkpoint', name: 'سيطرة الشمالية', lat: 32.948, lng: 45.024 },
  { id: 'cp_madain', kind: 'checkpoint', name: 'سيطرة المدائن', lat: 33.101, lng: 44.585 },
  { id: 'cp_diyala', kind: 'checkpoint', name: 'سيطرة جسر ديالى', lat: 33.233, lng: 44.52 },
];
/** On the road `m` metres, having left at the corridor's pace (120 min for the whole road). */
const onRoad = (m: number, opts: { lateBy?: number; points?: TripPoint[] } = {}) => {
  const now = new Date('2026-10-12T05:30:00Z');
  const departedAt = new Date(now.getTime() - (m / baghdad.totalM) * 120 * MIN - (opts.lateBy ?? 0) * MIN);
  return { now, departedAt, trip: roadTrip({ road: baghdad, startName: 'كراج البوابة 1', points: opts.points ?? CHECKPOINTS, departAt, departedAt, travelMin: 120, car: at(m), now }) };
};

describe('which road (N13)', () => {
  it('leaves from the trip’s own garage at home', () => {
    expect(roadKeyOf({ garageId: 'mp_garage_bab1', cityId: 'baghdad', direction: 'from_aziziyah' })).toEqual({ garage: 'bab1', city: 'baghdad', direction: 'from_aziziyah' });
    expect(roadKeyOf({ garageId: 'mp_garage_souq', cityId: 'baghdad', direction: 'from_aziziyah' })?.garage).toBe('souq');
    expect(roadKeyOf({ garageId: 'mp_garage_bab2', cityId: 'kut', direction: 'from_aziziyah' })?.garage).toBe('bab2');
  });
  it('a garage we have no road for, or a trip back: each city’s own garage at home', () => {
    expect(roadKeyOf({ garageId: 'mp_garage_new', cityId: 'kut', direction: 'from_aziziyah' })?.garage).toBe('bab2');
    expect(roadKeyOf({ garageId: 'mp_garage_nahdha', cityId: 'baghdad', direction: 'to_aziziyah' })).toEqual({ garage: 'bab1', city: 'baghdad', direction: 'to_aziziyah' });
    expect(roadKeyOf({ garageId: 'mp_garage_kut', cityId: 'kut', direction: 'to_aziziyah' })?.garage).toBe('bab2');
  });
  it('no road for a city we have none for', () => {
    expect(roadKeyOf({ garageId: 'mp_garage_bab1', cityId: 'najaf', direction: 'from_aziziyah' })).toBeNull();
    expect(roadForCities('aziziyah', 'najaf')).toBeNull();
  });
  it('the share page knows only the cities: the way and the garage follow from them', () => {
    const out = roadForCities('aziziyah', 'kut')!;
    expect([out.garage, out.city, out.direction]).toEqual(['bab2', 'kut', 'from_aziziyah']);
    const back = roadForCities('baghdad', 'aziziyah')!;
    expect([back.garage, back.city, back.direction]).toEqual(['bab1', 'baghdad', 'to_aziziyah']);
    // the way back passes the towns the other way round and ends at home
    expect(names(back.towns.map((t) => ({ name: t.nameAr })))).toEqual(['الزعفرانية', 'جسر ديالى', 'بسماية', 'الوحدة', 'الحفرية', 'العزيزية']);
  });
});

describe('the road’s geometry', () => {
  it('points along it run from the garage to the city', () => {
    expect(pointAt(baghdad, 0)).toEqual(baghdad.path[0]);
    expect(pointAt(baghdad, baghdad.totalM)).toEqual(baghdad.path[baghdad.path.length - 1]);
    expect(offRoadM(baghdad.path, pointAt(baghdad, 30_000))).toBeLessThan(5);
  });
  it('Baghdad is north-west of Aziziyah: the window looks that way', () => {
    const b = bearingAhead(baghdad, 52_000);
    expect(b).toBeGreaterThan(270);
    expect(b).toBeLessThan(360);
  });
  it('the strip frames about 20 km around the car, and the first 20 km before it leaves', () => {
    const [[w, s], [e, n]] = stripBounds(baghdad, 52_000);
    const car = at(52_000);
    expect(car.lng).toBeGreaterThanOrEqual(w);
    expect(car.lng).toBeLessThanOrEqual(e);
    expect(car.lat).toBeGreaterThanOrEqual(s);
    expect(car.lat).toBeLessThanOrEqual(n);
    const [[w0], [e0]] = stripBounds(baghdad, null);
    expect(baghdad.path[0]![0]).toBeGreaterThanOrEqual(w0);
    expect(baghdad.path[0]![0]).toBeLessThanOrEqual(e0);
  });
});

describe('the trip on the road (N13)', () => {
  it('before the car leaves: every town in passing order, timed from the announced time', () => {
    const trip = roadTrip({ road: baghdad, startName: 'كراج البوابة 1', points: CHECKPOINTS, departAt, travelMin: 120, car: null, now: new Date('2026-10-12T03:30:00Z') });
    expect(names(trip.stops)).toEqual(['كراج البوابة 1', 'الحفرية', 'الوحدة', 'بسماية', 'جسر ديالى', 'الزعفرانية', 'بغداد']);
    expect(trip.stops[0]!.at.toISOString()).toBe(departAt.toISOString());
    expect(trip.arriveAt.toISOString()).toBe('2026-10-12T06:00:00.000Z');
    // a town halfway along the road is an hour in
    const wahda = trip.stops.find((s) => s.name === 'الوحدة')!;
    expect((wahda.at.getTime() - departAt.getTime()) / MIN).toBeCloseTo((wahda.m / baghdad.totalM) * 120, 2);
    expect(trip.stops.every((s) => !s.passed)).toBe(true);
    expect([trip.carM, trip.lastPassed, trip.pace]).toEqual([null, null, null]);
    expect(trip.next?.name).toBe('الحفرية');
  });
  it('a late car counts from now, not from the time that passed', () => {
    const now = new Date('2026-10-12T04:20:00Z');
    const trip = roadTrip({ road: baghdad, startName: 'g', points: [], departAt, travelMin: 120, car: null, now });
    expect(trip.arriveAt.toISOString()).toBe('2026-10-12T06:20:00.000Z');
  });
  it('checkpoints on the road stay (one at a town is that town’s note); ones off it are left out', () => {
    const { trip } = onRoad(10_000);
    expect(trip.stops.some((s) => s.id === 'cp_madain')).toBe(false);
    expect(trip.stops.find((s) => s.name === 'جسر ديالى')?.checkpoint).toBe(true);
    expect(trip.stops.filter((s) => s.kind === 'checkpoint').every((s) => offRoadM(baghdad.path, [at(s.m).lng, at(s.m).lat]) < 5)).toBe(true);
  });
  it('the rider’s own stop always shows, at its place along the road', () => {
    const stop: TripPoint = { id: 'my_stop', kind: 'my_stop', name: 'مفرق المدائن', lat: 33.0985, lng: 44.5802 };
    const { trip } = onRoad(10_000, { points: [stop] });
    const i = trip.stops.findIndex((s) => s.id === 'my_stop');
    expect(i).toBeGreaterThan(0);
    expect(trip.stops[i - 1]!.m).toBeLessThanOrEqual(trip.stops[i]!.m);
    expect(trip.stops[i + 1]!.m).toBeGreaterThanOrEqual(trip.stops[i]!.m);
  });
  it('on the road: the towns behind are passed, the next one is ahead, times from where the car is', () => {
    const { now, departedAt, trip } = onRoad(52_000);
    expect(trip.carM).toBeCloseTo(52_000, -2);
    expect(names(trip.stops.filter((s) => s.passed))).toEqual(['كراج البوابة 1', 'الحفرية', 'الوحدة', 'بسماية']);
    expect(trip.lastPassed?.name).toBe('بسماية');
    expect(trip.next?.name).toBe('جسر ديالى');
    const left = ((baghdad.totalM - trip.carM!) / baghdad.totalM) * 120;
    expect(trip.minutesLeft).toBe(Math.ceil(left));
    expect(trip.nextInMin).toBe(Math.max(1, Math.ceil(((trip.next!.m - trip.carM!) / baghdad.totalM) * 120)));
    // behind the car: the garage reads the time it really left
    expect(trip.stops[0]!.at.getTime()).toBe(departedAt.getTime());
    expect(trip.stops.find((s) => s.name === 'بسماية')!.at.getTime()).toBeLessThan(now.getTime());
  });
  it('a town the car is at counts as reached: the next one shows', () => {
    const basmaya = baghdad.towns.find((t) => t.nameAr === 'بسماية')!;
    const { trip } = onRoad(basmaya.m - 100);
    expect(trip.next?.name).toBe('جسر ديالى');
  });
  it('how the road is going is said only when the car’s own pace says it', () => {
    expect(onRoad(52_000).trip.pace).toBe('moving');
    expect(onRoad(52_000, { lateBy: 60 }).trip.pace).toBe('slow');
    // a little slow: nothing said
    expect(onRoad(52_000, { lateBy: 20 }).trip.pace).toBeNull();
    // too early to tell: under 5 km, or under 10 minutes on the road
    expect(onRoad(4_000).trip.pace).toBeNull();
    expect(onRoad(6_000).trip.pace).toBeNull();
    const noLeave = roadTrip({ road: baghdad, startName: 'g', points: [], departAt, departedAt: null, travelMin: 120, car: at(52_000), now: new Date() });
    expect(noLeave.pace).toBeNull();
  });
  it('the Kut road: الدبوني, then الكوت', () => {
    const kut = intercityRoad('bab2', 'kut', 'from_aziziyah');
    const trip = roadTrip({ road: kut, startName: 'كراج البوابة 2', points: [], departAt, travelMin: 60, car: null, now: departAt });
    expect(names(trip.stops)).toEqual(['كراج البوابة 2', 'الدبوني', 'الكوت']);
    expect(trip.arriveAt.toISOString()).toBe('2026-10-12T05:00:00.000Z');
  });
});

describe('a booking’s road', () => {
  const network = {
    corridors: [{ id: 'aziziyah_baghdad', cityId: 'baghdad', travelMin: 120, checkpoints: [{ id: 'cp_diyala', nameAr: 'سيطرة جسر ديالى (مسودة)', lat: 33.233, lng: 44.52 }] }],
    garages: [],
  };
  const departure = (state: string) => ({ garageId: 'mp_garage_bab1', corridorId: 'aziziyah_baghdad', direction: 'from_aziziyah' as const, departAt, departedAt: departAt, state });
  const args = { pickup: { kind: 'garage', lat: 0, lng: 0 }, network, car: at(52_000), now: new Date('2026-10-12T05:00:00Z'), startName: 'كراج البوابة 1', stopName: '', checkpointName: (n: string) => n.replace(' (مسودة)', '') };
  it('the car counts only once it has left (before, it is driving to the garage)', () => {
    expect(bookingRoadTrip({ ...args, departure: departure('boarding') })!.carM).toBeNull();
    expect(bookingRoadTrip({ ...args, departure: departure('departed') })!.carM).not.toBeNull();
  });
  it('no corridor, no road', () => {
    expect(bookingRoadTrip({ ...args, departure: { ...departure('departed'), corridorId: 'nowhere' } })).toBeNull();
    expect(bookingRoadTrip({ ...args, network: null, departure: departure('departed') })).toBeNull();
  });
});

describe('the family page’s road (no corridor minutes)', () => {
  const now = new Date('2026-10-12T05:30:00Z');
  const eta = new Date('2026-10-12T06:10:00Z');
  it('nothing without the car’s place or an arrival time', () => {
    expect(sharedRoadTrip({ road: baghdad, startName: 'العزيزية', car: null, eta, now })).toBeNull();
    expect(sharedRoadTrip({ road: baghdad, startName: 'العزيزية', car: { ...at(52_000), at: now }, eta: null, now })).toBeNull();
    // an arrival already behind the fix says nothing about the pace
    expect(sharedRoadTrip({ road: baghdad, startName: 'العزيزية', car: { ...at(52_000), at: now }, eta: new Date(now.getTime() - MIN), now })).toBeNull();
  });
  it('the road ahead at the pace the server’s arrival gives: it reaches at that time', () => {
    const trip = sharedRoadTrip({ road: baghdad, startName: 'العزيزية', car: { ...at(52_000), at: now }, eta, now })!;
    expect(trip.arriveAt.getTime()).toBeCloseTo(eta.getTime(), -3);
    expect(trip.next?.name).toBe('جسر ديالى');
    expect(trip.stops[0]!.name).toBe('العزيزية');
  });
  it('times from the fix, not the page’s clock, when the fix is old', () => {
    const fixAt = new Date(now.getTime() - 6 * MIN);
    const trip = sharedRoadTrip({ road: baghdad, startName: 'العزيزية', car: { ...at(52_000), at: fixAt }, eta, now })!;
    expect(trip.arriveAt.getTime()).toBeCloseTo(eta.getTime(), -3);
  });
  it('reads dates that arrive as strings (the live stream)', () => {
    const car = { ...at(52_000), at: now.toISOString() as unknown as Date };
    const trip = sharedRoadTrip({ road: baghdad, startName: 'العزيزية', car, eta: eta.toISOString() as unknown as Date, now })!;
    expect(trip.arriveAt.getTime()).toBeCloseTo(eta.getTime(), -3);
  });
});

describe('the words and rows on the screens', () => {
  const t = ((key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key)) as never;
  it('the pass keeps the last town behind and everything ahead; the rest folds into one line', () => {
    const { trip } = onRoad(52_000);
    expect(names(timelineStops(trip))).toEqual(['بسماية', 'جسر ديالى', 'الزعفرانية', 'بغداد']);
    const w = roadWords(trip, t, 'ar-IQ' as never)!;
    expect(w.subtitle).toContain('rajaa_road.passed_left');
    expect(w.subtitle).toContain('بسماية');
    expect(w.summary).toContain('rajaa_road.summary');
    expect(w.summary).toContain('الحفرية');
    expect(w.summary).toContain('الوحدة');
    expect(w.tag?.top).toContain('rajaa_road.tag_passed');
    expect(w.horizon?.title).toContain('جسر ديالى');
    // the next town, then what the car's pace says
    expect(w.nextLine).toContain('rajaa_road.next_in');
    expect(w.nextLine).toContain('rajaa_road.pace_moving');
  });
  it('nothing about the road’s pace when it says nothing', () => {
    const w = roadWords(onRoad(52_000, { lateBy: 20 }).trip, t, 'ar-IQ' as never)!;
    expect(w.nextLine).not.toContain('pace');
  });
  it('before the car leaves: every row, and no words about the road', () => {
    const trip = roadTrip({ road: baghdad, startName: 'g', points: [], departAt, travelMin: 120, car: null, now: departAt });
    expect(timelineStops(trip)).toEqual(trip.stops);
    const w = roadWords(trip, t, 'ar-IQ' as never)!;
    expect([w.subtitle, w.summary, w.tag, w.nextLine, w.onRoad]).toEqual([null, null, null, null, false]);
    expect(roadWords(null, t, 'ar-IQ' as never)).toBeNull();
  });
  it('just out of the garage: what is left, no folded line', () => {
    const w = roadWords(onRoad(3_000).trip, t, 'ar-IQ' as never)!;
    expect(w.subtitle).toContain('rajaa_road.left');
    expect(w.summary).toBeNull();
    expect(w.tag?.top).toContain('rajaa_road.tag_from');
  });
});
