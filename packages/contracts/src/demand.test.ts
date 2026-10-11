import { describe, expect, it } from 'vitest';
import { demandGlow, glowFor } from './demand.js';

const at = new Date('2026-10-11T18:00:00Z');
const centres = new Map([
  ['a', { lat: 32.905, lng: 45.06 }],
  ['b', { lat: 32.92, lng: 45.07 }],
]);
const driver = (driverId: string, lat: number, lng: number, zoneId: string | null = null, free = true) => ({ driverId, zoneId, lat, lng, free });

describe('demandGlow (N17)', () => {
  it('never lights a zone for one job alone', () => {
    const snap = demandGlow({ waitingZones: ['a'], drivers: [], expected: new Map(), centres, at });
    expect(snap.zones).toEqual([]);
  });

  it('picks a short zone for only as many free couriers as it is short, nearest first', () => {
    // Zone a: 3 waiting, 1 courier there → short by 2.
    const snap = demandGlow({
      waitingZones: ['a', 'a', 'a'],
      drivers: [driver('in-a', 32.905, 45.06, 'a'), driver('far', 32.93, 45.08), driver('near', 32.906, 45.061), driver('mid', 32.91, 45.065), driver('busy', 32.905, 45.0601, null, false)],
      expected: new Map(),
      centres,
      at,
    });
    expect(snap.zones).toEqual([{ zoneId: 'a', level: 'hot' }]);
    expect([...snap.picks]).toEqual([
      ['near', 'a'],
      ['mid', 'a'],
    ]);
    expect(glowFor(snap, 'near').zones).toEqual([{ zoneId: 'a', level: 'hot', forYou: true }]);
    // Everyone else sees it warm: nobody else is pulled there.
    expect(glowFor(snap, 'far').zones).toEqual([{ zoneId: 'a', level: 'warm', forYou: false }]);
    expect(glowFor(snap, 'in-a').zones[0]?.forYou).toBe(false);
  });

  it('gives each courier at most one zone and skips couriers too far away', () => {
    const snap = demandGlow({
      waitingZones: ['a', 'a', 'b', 'b'],
      drivers: [driver('one', 32.912, 45.065), driver('away', 33.2, 45.4)],
      expected: new Map(),
      centres,
      at,
    });
    expect(snap.zones.map((z) => z.level)).toEqual(['hot', 'hot']);
    expect(snap.picks.size).toBe(1);
    expect(snap.picks.has('away')).toBe(false);
  });

  it('counts the usual coming-hour pickups toward the threshold, but shows no counts', () => {
    const snap = demandGlow({ waitingZones: ['b'], drivers: [driver('x', 32.905, 45.06, 'b')], expected: new Map([['b', 1.2]]), centres, at });
    expect(snap.zones).toEqual([{ zoneId: 'b', level: 'hot' }]);
    expect(Object.keys(glowFor(snap, 'x').zones[0] ?? {})).toEqual(['zoneId', 'level', 'forYou']);
  });
});
