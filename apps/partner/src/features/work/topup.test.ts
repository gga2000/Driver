import { describe, expect, it } from 'vitest';
import type { PartnerJob } from '@driver/contracts';
import { canTopUpOnJob, topUpCapEffect } from './logic';

type Stop = PartnerJob['stops'][number];
const stop = (patch: Partial<Stop>): Stop =>
  ({
    stopId: 's',
    seq: 1,
    type: 'pickup',
    state: 'pending',
    orderId: 'o1',
    zoneId: 'centre',
    pin: null,
    label: null,
    note: null,
    collectIqd: 0,
    ...patch,
  }) as Stop;

describe('wallet top-up on a job', () => {
  const food = {
    vertical: 'food' as const,
    stops: [
      stop({ stopId: 'p', type: 'pickup', state: 'completed' }),
      stop({ stopId: 'd', type: 'dropoff', state: 'arrived', seq: 2 }),
    ],
  };

  it('shows only to a courier carrying a live delivery', () => {
    expect(canTopUpOnJob(food, ['courier'])).toBe(true);
    expect(canTopUpOnJob(food, ['driver'])).toBe(false);
    expect(canTopUpOnJob({ ...food, vertical: 'tuktuk' }, ['courier', 'driver'])).toBe(false);
    expect(
      canTopUpOnJob(
        { ...food, stops: food.stops.map((s) => ({ ...s, state: 'completed' as const })) },
        ['courier'],
      ),
    ).toBe(false);
    expect(
      canTopUpOnJob({ ...food, stops: [stop({ type: 'dropoff', orderId: null })] }, ['courier']),
    ).toBe(false);
    expect(canTopUpOnJob(null, ['courier'])).toBe(false);
  });

  it('counts on the cash cap: before, after, and whether it tips him over', () => {
    expect(topUpCapEffect({ heldIqd: 40_000, owedIqd: 38_000, capIqd: 75_000 }, 25_000)).toEqual({
      heldIqd: 40_000,
      afterIqd: 65_000,
      capIqd: 75_000,
      overCap: false,
    });
    expect(
      topUpCapEffect({ heldIqd: 60_000, owedIqd: 60_000, capIqd: 75_000 }, 20_000).overCap,
    ).toBe(true);
  });
});
