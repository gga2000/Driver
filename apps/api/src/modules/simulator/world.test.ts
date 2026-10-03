import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { ConfigService } from '../config/index.js';
import { ZoneDirectory } from '../dispatch/zones.js';
import { createRand } from './prng.js';
import { DAY_MINUTES, DAY_OPEN_LOCAL_MIN, buildScenario, demandWeight } from './scenario.js';
import { LAUNCH_SUPPLY, buildWorld, supplyMix, zoneAt } from './world.js';

describe('seeded randomness', () => {
  it('a seed replays exactly; forks are independent of how much the parent drew', () => {
    const a = createRand(7);
    const b = createRand(7);
    expect([a.next(), a.int(1, 6), a.range(0, 1)]).toEqual([b.next(), b.int(1, 6), b.range(0, 1)]);
    const p = createRand(7);
    const early = p.fork('x').next();
    p.next();
    p.next();
    expect(p.fork('x').next()).toBe(early);
    expect(createRand(8).next()).not.toBe(createRand(7).next());
  });
});

describe('world (plan Step 7)', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    expect(buildWorld({ seed: 1 })).toEqual(buildWorld({ seed: 1 }));
    expect(buildWorld({ seed: 2 }).drivers.map((d) => d.home)).not.toEqual(buildWorld({ seed: 1 }).drivers.map((d) => d.home));
  });

  it('launch supply by default (10 bikes, 25 tuktuks, 25 cars), scaled by --drivers', () => {
    const w = buildWorld({ seed: 1 });
    expect(LAUNCH_SUPPLY).toEqual({ bike: 10, tuktuk: 25, car: 25 });
    const count = (v: string) => w.drivers.filter((d) => d.vehicle === v).length;
    expect([count('bike'), count('tuktuk'), count('car')]).toEqual([10, 25, 25]);
    expect(w.restaurants).toHaveLength(10);
    expect(supplyMix(120)).toEqual({ bike: 20, tuktuk: 50, car: 50 });
    expect(supplyMix(12)).toEqual({ bike: 2, tuktuk: 5, car: 5 });
    expect(Object.values(supplyMix(7)).reduce((a, b) => a + b, 0)).toBe(7);
  });

  it('every pin resolves to its own seed zone — the same answer dispatch gives', () => {
    const zones = new ZoneDirectory(new ConfigService());
    for (const seed of [1, 2, 3]) {
      const w = buildWorld({ seed, drivers: 60, restaurants: 10, customers: 300 });
      const pins = [...w.restaurants.map((r) => [r.pin, r.zoneId] as const), ...w.drivers.map((d) => [d.home, d.zoneId] as const), ...w.customers.map((c) => [c.home, c.zoneId] as const)];
      for (const [pin, zone] of pins) {
        expect(zoneAt(pin)).toBe(zone);
        expect(zones.zoneAt('aziziyah', pin)).toBe(zone);
      }
    }
    const ids = new Set(AZIZIYAH_ZONES.map((z) => z.id));
    expect(buildWorld({ seed: 1 }).customers.every((c) => ids.has(c.zoneId))).toBe(true);
    // Restaurants sit in the town, never at the edge; customers spread over many zones.
    expect(buildWorld({ seed: 1 }).restaurants.every((r) => AZIZIYAH_ZONES.find((z) => z.id === r.zoneId)!.tier !== 'edge')).toBe(true);
    expect(new Set(buildWorld({ seed: 1, customers: 400 }).customers.map((c) => c.zoneId)).size).toBeGreaterThan(20);
  });

  it('menus are priced in 500-IQD steps (G-88)', () => {
    for (const r of buildWorld({ seed: 3 }).restaurants) for (const item of r.menu) expect(item.priceIqd % 500).toBe(0);
  });
});

describe('scenario (plan Step 7)', () => {
  const world = buildWorld({ seed: 1, customers: 500 });

  it('is deterministic and time-ordered', () => {
    const a = buildScenario(world, { orders: 500 });
    expect(a).toEqual(buildScenario(world, { orders: 500 }));
    expect(a.map((o) => o.atMin)).toEqual([...a.map((o) => o.atMin)].sort((x, y) => x - y));
    expect(a.every((o) => o.atMin >= 0 && o.atMin < DAY_MINUTES)).toBe(true);
  });

  it('default mix: exactly 70 % food, 25 % city rides, 5 % cancelled at a random stage', () => {
    const plan = buildScenario(world, { orders: 2000 });
    const cancelled = plan.filter((o) => o.cancel);
    expect(cancelled).toHaveLength(100);
    expect(plan.filter((o) => !o.cancel && o.kind === 'food')).toHaveLength(1400);
    expect(plan.filter((o) => !o.cancel && o.kind === 'ride')).toHaveLength(500);
    expect(new Set(cancelled.map((o) => o.cancel!.stage))).toEqual(new Set(['before_merchant', 'after_accept', 'searching', 'driver_en_route']));
    // Kitchens: 3 % of food rejected, 2 % partially accepted (only orders with two lines or more).
    const food = plan.filter((o) => o.kind === 'food' && !o.cancel);
    expect(food.filter((o) => o.kitchen === 'reject')).toHaveLength(42);
    expect(food.filter((o) => o.kitchen === 'partial')).toHaveLength(28);
    expect(food.filter((o) => o.kitchen === 'partial').every((o) => o.lines.length >= 2)).toBe(true);
    // Rides: tuktuks never to or from the edge.
    expect(plan.filter((o) => o.rideVertical === 'tuktuk').every((o) => AZIZIYAH_ZONES.find((z) => z.id === o.dropoffZone)!.tier !== 'edge')).toBe(true);
  });

  it('city peaks: lunch 13–15 and dinner 19:30–22:30 are busier per minute than the rest of the day', () => {
    expect(demandWeight(14 * 60, 'food')).toBeGreaterThan(demandWeight(11 * 60, 'food'));
    expect(demandWeight(20 * 60, 'food')).toBeGreaterThan(demandWeight(17 * 60, 'food'));
    const plan = buildScenario(world, { orders: 2000 });
    const rate = (fromH: number, toH: number) => plan.filter((o) => o.atMin >= fromH * 60 - DAY_OPEN_LOCAL_MIN && o.atMin < toH * 60 - DAY_OPEN_LOCAL_MIN).length / ((toH - fromH) * 60);
    expect(rate(13, 15)).toBeGreaterThan(1.8 * rate(15.5, 19));
    expect(rate(19.5, 22.5)).toBeGreaterThan(1.8 * rate(15.5, 19));
  });

  it('a new account’s first three cash orders stay under the 25,000 cap (decisions §4)', () => {
    const plan = buildScenario(world, { orders: 2000 });
    const seen = new Map<number, number>();
    for (const o of plan) {
      if (o.payment !== 'cash') continue;
      const n = seen.get(o.customer) ?? 0;
      seen.set(o.customer, n + 1);
      if (n < 3 && o.kind === 'food') expect(o.lines.reduce((s, l) => s + l.qty * l.unitPriceIqd, 0)).toBeLessThanOrEqual(21_000);
    }
  });
});
