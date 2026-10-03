import { describe, expect, it } from 'vitest';
import { ConfigService } from '../config/index.js';
import { DEFAULT_WEIGHTS, DriverRanker, campingFactor } from './ranker.js';

describe('ranker weights 40 / 30 / 20 / 10 (spec §3)', () => {
  const ranker = new DriverRanker();

  it('uses the city config weights: distance 40, tier 30, load 20, vehicle fit 10', () => {
    expect(new ConfigService().dispatchFor('aziziyah', 'taxi')?.rankWeights).toEqual({ distance: 40, tier: 30, load: 20, vehicleFit: 10 });
    expect(DEFAULT_WEIGHTS).toEqual({ distance: 40, tier: 30, load: 20, vehicleFit: 10 });
  });

  it('scores each term on 0..1 times its weight', () => {
    // perfect: on the pickup, gold, idle, preferred vehicle
    expect(ranker.score({ driverId: 'a', distanceKm: 0, activeTrips: 0, tier: 'gold', vehicleFit: 1 })).toBe(100);
    // 2.5 km of a 5 km horizon = 20; bronze 0; idle 20; fit 10
    expect(ranker.score({ driverId: 'b', distanceKm: 2.5, activeTrips: 0, tier: 'bronze' })).toBe(50);
    // 1 km → 32; silver 15; one job of 3 → 13.33; acceptable vehicle 5
    expect(ranker.score({ driverId: 'c', distanceKm: 1, activeTrips: 1, tier: 'silver', vehicleFit: 0.5 })).toBe(65.33);
    // beyond 5 km the distance term is 0, never negative
    expect(ranker.score({ driverId: 'd', distanceKm: 9, activeTrips: 0, tier: 'bronze' })).toBe(30);
  });

  it('each weight moves the ranking by its share', () => {
    const near = { driverId: 'near', distanceKm: 0, activeTrips: 0, tier: 'bronze' as const };
    const gold = { driverId: 'gold', distanceKm: 3.75, activeTrips: 0, tier: 'gold' as const };
    // near: 40 + 0 + 20 + 10 = 70; gold far: 10 + 30 + 20 + 10 = 70 → tie broken by id
    expect(ranker.rank([near, gold]).map((d) => [d.driverId, d.score])).toEqual([
      ['gold', 70],
      ['near', 70],
    ]);
    const tierHeavy = new DriverRanker({ distance: 10, tier: 60, load: 20, vehicleFit: 10 });
    expect(tierHeavy.rank([near, gold])[0]?.driverId).toBe('gold');
    const distanceHeavy = new DriverRanker({ distance: 70, tier: 0, load: 20, vehicleFit: 10 });
    expect(distanceHeavy.rank([near, gold])[0]?.driverId).toBe('near');
  });

  it('is deterministic: ties break on driverId', () => {
    const same = (id: string) => ({ driverId: id, distanceKm: 1, activeTrips: 0, tier: 'silver' as const });
    expect(ranker.rank([same('z'), same('a'), same('m')]).map((d) => d.driverId)).toEqual(['a', 'm', 'z']);
  });
});

describe('time-in-zone decay against camping (review J112)', () => {
  it('is 1 inside the 15-min grace, then decays linearly to 0.5 at 60 min', () => {
    expect(campingFactor(0)).toBe(1);
    expect(campingFactor(15)).toBe(1);
    expect(campingFactor(37.5)).toBe(0.75);
    expect(campingFactor(60)).toBe(0.5);
    expect(campingFactor(240)).toBe(0.5);
  });

  it('a driver camped 60 min outside the restaurant loses to a fresh driver a kilometre further out', () => {
    const ranker = new DriverRanker();
    const camper = { driverId: 'camper', distanceKm: 0.5, activeTrips: 0, tier: 'bronze' as const, minutesInZone: 60 };
    const fresh = { driverId: 'fresh', distanceKm: 1.5, activeTrips: 0, tier: 'bronze' as const, minutesInZone: 2 };
    // camper: 40 × 0.9 × 0.5 = 18 (+30) = 48; fresh: 40 × 0.7 = 28 (+30) = 58
    expect(ranker.score(camper)).toBe(48);
    expect(ranker.score(fresh)).toBe(58);
    expect(ranker.rank([camper, fresh]).map((d) => d.driverId)).toEqual(['fresh', 'camper']);
    // Without the camping clock the camper would have won.
    expect(ranker.rank([{ ...camper, minutesInZone: 0 }, fresh])[0]?.driverId).toBe('camper');
  });

  it('decays only the distance term: tier, load and fit are untouched', () => {
    const ranker = new DriverRanker();
    const far = { driverId: 'x', distanceKm: 5, activeTrips: 0, tier: 'gold' as const };
    expect(ranker.score({ ...far, minutesInZone: 120 })).toBe(ranker.score(far));
  });
});
