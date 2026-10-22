import { describe, expect, it } from 'vitest';
import { coinSides, dayPoints, dayStops, FIRST_RIPPLES, justReady, newRipples, rippleSpot } from './pulse-logic';

const k = (id: string, state: 'cooking' | 'ready') => ({
  id,
  at: { lat: 32.905, lng: 45.06 },
  state,
  progress: null,
});

describe('live home pulse logic', () => {
  it('a ripple sits near the area middle, the same spot for the same rise, and never for an unknown area', () => {
    const a = rippleSpot('centre', 1)!;
    expect(rippleSpot('centre', 1)).toEqual(a);
    expect(Math.abs(a.lat - 32.905)).toBeLessThan(0.002);
    expect(Math.abs(a.lng - 45.06)).toBeLessThan(0.002);
    expect(rippleSpot('nowhere', 1)).toBeNull();
  });

  it('first picture ripples only the busiest few; later ones ripple only areas whose count rose', () => {
    const areas = [
      { zoneId: 'centre', n: 9 },
      { zoneId: 'street_30', n: 6 },
      { zoneId: 'hashimi', n: 5 },
      { zoneId: 'shukri', n: 4 },
    ];
    expect(newRipples(null, areas, 1).map((r) => r.zoneId)).toEqual(areas.slice(0, FIRST_RIPPLES).map((a) => a.zoneId));
    const next = [
      { zoneId: 'centre', n: 9 },
      { zoneId: 'street_30', n: 7 },
      { zoneId: 'fidaa', n: 3 },
    ];
    const r = newRipples(areas, next, 2);
    expect(r.map((x) => x.zoneId)).toEqual(['street_30', 'fidaa']);
    expect(new Set(r.map((x) => x.key)).size).toBe(2);
  });

  it('a kitchen pops only when it turns ready, never on the first picture', () => {
    expect(justReady(null, [k('a', 'ready')]).size).toBe(0);
    expect([...justReady([k('a', 'cooking'), k('b', 'ready')], [k('a', 'ready'), k('b', 'ready'), k('c', 'ready')])]).toEqual(['a', 'c']);
  });

  it('«يومي» draws jobs oldest first and skips ones with nowhere to draw', () => {
    const p = { lat: 32.9, lng: 45.06 };
    const stops = dayStops({
      earningsIqd: 4_000,
      jobs: [
        { tripId: 't2', pickup: p, dropoff: p, doneAt: new Date(2_000), earnedIqd: 2_000 },
        { tripId: 't1', pickup: p, dropoff: null, doneAt: new Date(1_000), earnedIqd: 2_000 },
        { tripId: 't3', pickup: null, dropoff: null, doneAt: new Date(3_000), earnedIqd: 0 },
      ],
    });
    expect(stops.map((s) => s.tripId)).toEqual(['t1', 't2']);
    expect(dayPoints(stops)).toHaveLength(3);
    expect(dayStops(undefined)).toEqual([]);
  });

  it('a money chip that would cover an earlier one flips under its door', () => {
    const at = (lat: number, lng: number) => ({ lat, lng });
    const stop = (id: string, d: { lat: number; lng: number } | null) => ({ tripId: id, pickup: null, dropoff: d, earnedIqd: 500 });
    expect(coinSides([stop('a', at(32.91, 45.06)), stop('b', at(32.9105, 45.061)), stop('c', at(32.89, 45.07)), stop('d', null)])).toEqual(['above', 'below', 'above', 'above']);
  });
});
