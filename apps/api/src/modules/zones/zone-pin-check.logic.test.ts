import { describe, expect, it } from 'vitest';
import type { ZonePlacementView, ZoneTierFare } from '@driver/contracts';
import { pinCheck } from './zone-pin-check.logic.js';

const ring = (lat: number, lng: number, d = 0.002) => [
  { lat: lat - d, lng: lng - d }, { lat: lat - d, lng: lng + d }, { lat: lat + d, lng: lng + d }, { lat: lat + d, lng: lng - d },
];
const zone = (key: string, tier: ZonePlacementView['tier'], placement: ZonePlacementView['placement'], lat: number, lng: number): ZonePlacementView => ({
  key, name_ar: key, name_en: key, tier, group: tier, placement, ring: ring(lat, lng), centre: { lat, lng }, areaM2: 100_000, placedBy: null, placedAt: null,
});
const fares: ZoneTierFare[] = [
  { tier: 'centre', deliveryIqd: 500, taxiIqd: 0, tuktukIqd: 0 },
  { tier: 'near', deliveryIqd: 1000, taxiIqd: 0, tuktukIqd: 0 },
  { tier: 'mid', deliveryIqd: 1500, taxiIqd: 0, tuktukIqd: 0 },
  { tier: 'far', deliveryIqd: 2000, taxiIqd: 0, tuktukIqd: 0 },
  { tier: 'edge', deliveryIqd: 3000, taxiIqd: 0, tuktukIqd: 0 },
];

describe('pinCheck', () => {
  const zones = [zone('a', 'near', 'placed', 32.9, 45.0), zone('b', 'mid', 'draft', 32.95, 45.1)];

  it('counts a pin that the circle puts in b but the outline of a holds, with the fee change', () => {
    const r = pinCheck('aziziyah', [{ lat: 32.9, lng: 45.0 }], zones, fares, () => 'b');
    expect(r).toMatchObject({ pins: 1, drawnZones: 1, changed: 1, cheaper: 1, dearer: 0, newlyServed: 0, avgFeeChangeIqd: -500 });
    expect(r.moves).toEqual([{ fromKey: 'b', toKey: 'a', pins: 1, feeChangeIqd: -500 }]);
  });

  it('keeps the circle rule outside every outline and ignores drafts', () => {
    const r = pinCheck('aziziyah', [{ lat: 32.95, lng: 45.1 }, { lat: 33.5, lng: 46 }], zones, fares, () => 'b');
    expect(r.changed).toBe(0);
  });

  it('counts a pin the circles left outside the service area as newly served', () => {
    const r = pinCheck('aziziyah', [{ lat: 32.9, lng: 45.0 }], zones, fares, () => null);
    expect(r).toMatchObject({ changed: 1, newlyServed: 1, dearer: 0, cheaper: 0, avgFeeChangeIqd: 0 });
    expect(r.moves).toEqual([{ fromKey: null, toKey: 'a', pins: 1, feeChangeIqd: null }]);
  });

  it('counts dearer moves, groups identical moves and averages over all pins looked at', () => {
    const inA = { lat: 32.9, lng: 45.0 };
    const r = pinCheck('aziziyah', [inA, inA, { lat: 40, lng: 40 }, { lat: 40, lng: 40 }], [zone('a', 'mid', 'placed', 32.9, 45.0), zone('c', 'near', 'placed', 0, 0)], fares, (p) => (p.lat === 32.9 ? 'c' : 'c'));
    expect(r).toMatchObject({ pins: 4, changed: 2, dearer: 2, cheaper: 0, avgFeeChangeIqd: 250 });
    expect(r.moves).toEqual([{ fromKey: 'c', toKey: 'a', pins: 2, feeChangeIqd: 500 }]);
  });
});
