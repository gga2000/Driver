import { describe, expect, it } from 'vitest';
import type { Trip } from '@driver/contracts';
import { atRiskDrivers, FLEET_RULES, glideAt, isQuiet } from './fleet-motion';

describe('live fleet motion (maps program o1, o4)', () => {
  it('glides from the old fix to the new one, eased, clamped', () => {
    expect(glideAt([0, 0], [10, 20], 0)).toEqual([0, 0]);
    expect(glideAt([0, 0], [10, 20], 1)).toEqual([10, 20]);
    expect(glideAt([0, 0], [10, 20], 0.5)).toEqual([7.5, 15]);
    expect(glideAt([0, 0], [10, 20], 2)).toEqual([10, 20]);
  });

  it('a pin goes quiet after 45 s without a fix', () => {
    expect(isQuiet(0, FLEET_RULES.quietMs)).toBe(false);
    expect(isQuiet(0, FLEET_RULES.quietMs + 1)).toBe(true);
    expect(isQuiet(null, 1e12)).toBe(false);
  });

  it('rings the couriers holding an at-risk order', () => {
    const trips = [
      { courierId: 'd1', stops: [{ orderId: 'o1' }, { orderId: 'o1' }] },
      { courierId: 'd2', stops: [{ orderId: 'o2' }] },
      { courierId: null, stops: [{ orderId: 'o3' }] },
    ] as unknown as Trip[];
    expect([...atRiskDrivers(['o1', 'o3'], trips)]).toEqual(['d1']);
  });
});
