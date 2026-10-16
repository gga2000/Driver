import { describe, expect, it } from 'vitest';
import type { GuardianRunView } from '@driver/contracts';
import { busHeadline, busRoute, fractionAlong, khatScene, otherStopFractions, spread, staleMinutes, type Pt } from './bus';

const HOME = { lat: 32.8962, lng: 45.0671 };
const SCHOOL = { lat: 32.905, lng: 45.06, landmark: null };
const BUS = { lat: 32.892, lng: 45.071, bearing: 0, at: new Date('2026-10-11T04:00:00Z') };

const run = (o: Partial<GuardianRunView> = {}): GuardianRunView => ({
  tripId: 't1',
  state: 'en_route_to_pickup',
  leg: 'to_school',
  child: 'waiting',
  home: HOME,
  school: SCHOOL,
  bus: BUS,
  busAway: false,
  stopsBefore: 0,
  others: [],
  polyline6: null,
  minutes: 4,
  ...o,
});

describe('the bus sheet headline', () => {
  it('bus coming to the home, in the morning and the afternoon', () => {
    expect(busHeadline(run())).toEqual({ key: 'khat_bus.coming_home', params: { n: 4 } });
    expect(busHeadline(run({ leg: 'to_home', child: 'on_board', minutes: 7 }))).toEqual({ key: 'khat_bus.coming_home', params: { n: 7 } });
    expect(busHeadline(run({ leg: 'to_home', child: 'waiting', minutes: 3 }))).toEqual({ key: 'khat_bus.coming_school', params: { n: 3 } });
    expect(busHeadline(run({ minutes: null }))).toEqual({ key: 'khat_bus.on_way_home' });
  });

  it('bus away on another child: the count of stops before yours in its Arabic form', () => {
    const away = (n: number, child: GuardianRunView['child'] = 'waiting') => busHeadline(run({ bus: null, busAway: true, stopsBefore: n, minutes: null, child }));
    expect(away(1)).toEqual({ key: 'khat_bus.away_one', params: { n: 1 } });
    expect(away(2)).toEqual({ key: 'khat_bus.away_two', params: { n: 2 } });
    expect(away(4)).toEqual({ key: 'khat_bus.away_few', params: { n: 4 } });
    expect(away(12)).toEqual({ key: 'khat_bus.away', params: { n: 12 } });
    expect(away(0)).toEqual({ key: 'khat_bus.away_next' });
    expect(busHeadline(run({ leg: 'to_home', child: 'on_board', bus: null, busAway: true, stopsBefore: 2, minutes: null }))).toEqual({ key: 'khat_bus.away_dropping_two', params: { n: 2 } });
    expect(away(1, 'on_board')).toEqual({ key: 'khat_bus.on_board_pickup' });
  });

  it('on board, delivered, absent, not started', () => {
    expect(busHeadline(run({ child: 'on_board' }))).toEqual({ key: 'khat_bus.on_board_school' });
    expect(busHeadline(run({ leg: 'to_home', child: 'on_board', minutes: null }))).toEqual({ key: 'khat_bus.on_board_home' });
    expect(busHeadline(run({ child: 'delivered', bus: null }))).toEqual({ key: 'khat_bus.delivered_school' });
    expect(busHeadline(run({ leg: 'to_home', child: 'delivered', bus: null }))).toEqual({ key: 'khat_bus.delivered_home' });
    // Absent wins even while the bus is out on another child's leg.
    expect(busHeadline(run({ child: 'absent', busAway: true, stopsBefore: 2 }))).toEqual({ key: 'khat_bus.absent' });
    expect(busHeadline(run({ state: 'offered', bus: null, minutes: null }))).toEqual({ key: 'khat_bus.not_started' });
    expect(busHeadline(run({ bus: null, minutes: null }))).toEqual({ key: 'khat_bus.no_fix' });
  });

  it('says how old the bus fix is only past 2 minutes', () => {
    const now = BUS.at.getTime();
    expect(staleMinutes(run(), now + 90_000)).toBeNull();
    expect(staleMinutes(run(), now + 5 * 60_000 + 10_000)).toBe(5);
    expect(staleMinutes(run({ bus: null }), now + 10 * 60_000)).toBeNull();
  });
});

describe('the route and the blank dots', () => {
  it('straight lines through the public points in driving order without a road', () => {
    const home: Pt = [HOME.lng, HOME.lat];
    const school: Pt = [SCHOOL.lng, SCHOOL.lat];
    const bus: Pt = [BUS.lng, BUS.lat];
    expect(busRoute(run())).toEqual([bus, home, school]);
    expect(busRoute(run({ child: 'on_board' }))).toEqual([bus, school]);
    expect(busRoute(run({ bus: null }))).toEqual([home, school]);
    expect(busRoute(run({ leg: 'to_home', bus: null }))).toEqual([school, home]);
    expect(busRoute(run({ leg: 'to_home' }))).toEqual([bus, school, home]);
  });

  it('decodes the road when the server sends one', () => {
    // [38.5, -120.2] → [40.7, -120.95] at precision 6 (the format's own example, scaled).
    const route = busRoute(run({ polyline6: '_izlhA~rlgdF_{geC~ywl@' }));
    expect(route).toHaveLength(2);
    expect(route[0]![0]).toBeCloseTo(-120.2, 5);
    expect(route[0]![1]).toBeCloseTo(38.5, 5);
  });

  it('spaces dots evenly inside a stretch, ends left out', () => {
    expect(spread(3, 0, 1)).toEqual([0.25, 0.5, 0.75]);
    expect(spread(1, 0.2, 0.6)[0]).toBeCloseTo(0.4);
    expect(spread(2, 0, 0)).toEqual([]);
    expect(spread(0, 0, 1)).toEqual([]);
  });

  it('places stops still to come before the home between the bus and the home, the rest after it', () => {
    const route: Pt[] = [
      [45.0, 32.9],
      [45.01, 32.9],
      [45.02, 32.9],
    ];
    expect(fractionAlong(route, [45.01, 32.9])).toBeCloseTo(0.5, 2);
    const v = run({ home: { lat: 32.9, lng: 45.01 }, school: { lat: 32.9, lng: 45.02, landmark: null }, bus: { ...BUS, lat: 32.9, lng: 45.0 }, stopsBefore: 1, others: [{ done: true }, { done: false }, { done: false }, { done: false }] });
    const f = otherStopFractions(v, route);
    // One to come before (between 0 and 0.5), two after (between 0.5 and 1); the done one is behind the bus.
    expect(f).toHaveLength(3);
    expect(f[0]).toBeCloseTo(0.25, 2);
    expect(f[1]).toBeCloseTo(0.5 + 0.5 / 3, 2);
    expect(f[2]).toBeCloseTo(0.5 + 1 / 3, 2);
  });

  it('draws no dots when the run is over for this child, or with no room before the home', () => {
    const others = [{ done: false }, { done: false }];
    expect(otherStopFractions(run({ child: 'delivered', others }), busRoute(run()))).toEqual([]);
    // Bus hidden in the morning: the line starts at home, the two before it live in the headline only.
    const away = run({ bus: null, busAway: true, stopsBefore: 2, others });
    expect(otherStopFractions(away, busRoute(away))).toEqual([]);
  });

  it('the scene never carries a point other than the bus, the home and the school', () => {
    const s = khatScene(run({ others: [{ done: false }] }));
    expect(s.bus).toEqual([BUS.lng, BUS.lat]);
    expect(s.others.every((x) => x > 0 && x < 1)).toBe(true);
    expect(s).toMatchObject({ compactHome: false, compactSchool: false });
    // The bus ~90 m from the school: the school pin drops its label so the bus pill sits clear of it.
    expect(khatScene(run({ child: 'on_board', bus: { ...BUS, lat: 32.9058, lng: 45.0596 } }))).toMatchObject({ compactHome: false, compactSchool: true });
  });
});
