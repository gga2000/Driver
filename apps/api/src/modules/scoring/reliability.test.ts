import { describe, expect, it } from 'vitest';
import { cashPunctuality, nudgesFor, onTimePercent, reliabilityCard, type OnTimeTrip } from './reliability.js';

const NOW = new Date('2026-10-20T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('reliabilityCard (scoring §1, Partner card)', () => {
  it('is 100 with no samples, every metric "—" and nothing below Silver', () => {
    const card = reliabilityCard({ events: [], trips: [], ratings: [], cash: [] }, NOW);
    expect(card.index).toBe(100);
    expect(card.tier).toBe('silver'); // Gold also needs 100 completed trips
    expect(card.metrics.every((m) => m.value === null && m.display === '—' && !m.belowSilver)).toBe(true);
    expect(nudgesFor(card.metrics)).toEqual([]);
  });

  it('weighs the older week half and ignores anything beyond 14 days', () => {
    const card = reliabilityCard(
      {
        events: [
          { type: 'trip.accepted', occurredAt: ago(1 * DAY) },
          { type: 'trip.declined', occurredAt: ago(10 * DAY) }, // weighs ½
          { type: 'trip.timed_out', occurredAt: ago(20 * DAY) }, // outside
        ],
        trips: [],
        ratings: [],
        cash: [],
      },
      NOW,
    );
    const acceptance = card.metrics.find((m) => m.key === 'acceptance')!;
    expect(acceptance.value).toBeCloseTo(1 / 1.5, 3);
    expect(acceptance.samples).toBe(2);
  });

  it('completion, on-time (+3 min grace) and the last 50 ratings', () => {
    const t = (state: string, arrivedLateMin: number) => ({
      state,
      acceptedAt: ago(DAY),
      stops: [{ windowEnd: ago(DAY - HOUR), arrivedAt: new Date(ago(DAY - HOUR).getTime() + arrivedLateMin * 60_000) }],
    });
    const card = reliabilityCard(
      {
        events: [],
        trips: [t('completed', 2), t('completed', 4), t('driver_cancelled', 0), t('completed', 0)],
        ratings: [...Array.from({ length: 60 }, (_, i) => ({ score: 5, at: ago(i * HOUR) })), { score: 1, at: ago(100 * DAY) }],
        cash: [],
      },
      NOW,
    );
    const by = Object.fromEntries(card.metrics.map((m) => [m.key, m]));
    expect(by['completion']!.value).toBeCloseTo(0.75);
    expect(by['completion']!.belowSilver).toBe(true);
    expect(by['on_time']!.value).toBeCloseTo(0.75);
    expect(by['rating']!.value).toBe(5);
    expect(by['rating']!.samples).toBe(50);
    expect(card.completedTrips).toBe(3);
    expect(nudgesFor(card.metrics).map((n) => n.key)).toEqual(['completion', 'on_time']);
  });
});

describe('cashPunctuality', () => {
  it('counts cash handed back within 24 h (FIFO) and skips collections still inside their 24 h', () => {
    const start = NOW.getTime() - 14 * DAY;
    const lines = [
      { amountIqd: -10000, at: ago(3 * DAY) },
      { amountIqd: 6000, at: ago(3 * DAY - 2 * HOUR) }, // on time
      { amountIqd: 4000, at: ago(1 * DAY) }, // two days later: late
      { amountIqd: -5000, at: ago(2 * HOUR) }, // still within its 24 h, not judged
    ];
    expect(cashPunctuality(lines, NOW, start)).toEqual({ value: 0.6, samples: 1 });
  });
});

describe('onTimePercent (ride step 3, the driver profile)', () => {
  const MIN = 60_000;
  const trip = (pickupLateMin: number, over: Partial<OnTimeTrip> = {}): OnTimeTrip => ({
    state: 'completed',
    acceptedAt: ago(DAY),
    promisedPickupMin: 5,
    stops: [
      { type: 'pickup', windowEnd: null, arrivedAt: new Date(ago(DAY).getTime() + (5 + pickupLateMin) * MIN) },
      { type: 'dropoff', windowEnd: null, arrivedAt: ago(DAY - 20 * MIN) },
    ],
    ...over,
  });

  it('is null under the minimum completed trips', () => {
    expect(onTimePercent([trip(0)], 2)).toBeNull();
    expect(onTimePercent([trip(0), trip(0, { state: 'driver_cancelled' })], 2)).toBeNull();
  });

  it('counts a pickup reached within the offered minutes plus 3 minutes of grace', () => {
    expect(onTimePercent([trip(0), trip(3), trip(3.5), trip(10)], 4)).toBe(50);
  });

  it('a stop with a window (خطوط) counts by its window; trips with no promise are left out', () => {
    const khat: OnTimeTrip = { state: 'completed', acceptedAt: ago(DAY), promisedPickupMin: null, stops: [{ type: 'pickup', windowEnd: ago(DAY), arrivedAt: ago(DAY - 10 * MIN) }] };
    const unknown = trip(0, { promisedPickupMin: null });
    expect(onTimePercent([trip(0), khat, unknown], 3)).toBe(50);
    expect(onTimePercent([unknown, unknown], 2)).toBeNull();
  });

  it('only a batch’s first pickup carries the offer’s promise', () => {
    const batch = trip(0);
    const late = { type: 'pickup', windowEnd: null, arrivedAt: ago(DAY - 40 * MIN) };
    expect(onTimePercent([{ ...batch, stops: [...batch.stops, late] }], 1)).toBe(100);
  });
});
