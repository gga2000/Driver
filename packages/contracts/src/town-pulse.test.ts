import { describe, expect, it } from 'vitest';
import { TOWN_PULSE_RULES, townNowFor, townPulseFor, townPulseSnapshot, type TownPulseInput } from './town-pulse-io.js';

const at = new Date('2026-10-22T15:00:00Z');
const min = (n: number) => new Date(at.getTime() - n * 60_000);
const shop = { lat: 32.904, lng: 45.06 };
const base: TownPulseInput = { at, kitchens: [], placed: [], drivers: [] };

describe('townPulseSnapshot', () => {
  it('shows a kitchen once, ready over cooking, with the soonest ring in quarter steps', () => {
    const snap = townPulseSnapshot({
      ...base,
      kitchens: [
        { merchantOrgId: 'k1', pin: shop, state: 'preparing', acceptedAt: min(10), promisedReadyAt: min(-10) },
        { merchantOrgId: 'k1', pin: shop, state: 'merchant_accepted', acceptedAt: min(14), promisedReadyAt: min(-6) },
        { merchantOrgId: 'k2', pin: shop, state: 'preparing', acceptedAt: min(5), promisedReadyAt: min(-5) },
        { merchantOrgId: 'k2', pin: shop, state: 'ready', acceptedAt: min(20), promisedReadyAt: min(1) },
        { merchantOrgId: 'k3', pin: null, state: 'preparing', acceptedAt: min(5), promisedReadyAt: min(-5) },
      ],
    });
    expect(snap.kitchens).toEqual([
      { id: 'k1', at: shop, state: 'cooking', progress: 0.5 },
      { id: 'k2', at: shop, state: 'ready', progress: null },
    ]);
  });

  it('counts new orders per area a few minutes late and only from the minimum up', () => {
    const placed = [...Array(3)].map(() => ({ zoneId: 'centre', placedAt: min(5) }));
    placed.push({ zoneId: 'fidaa', placedAt: min(5) }, { zoneId: 'fidaa', placedAt: min(4) }, { zoneId: 'centre', placedAt: min(1) }, { zoneId: 'centre', placedAt: min(30) });
    const snap = townPulseSnapshot({ ...base, placed });
    expect(snap.areas).toEqual([{ zoneId: 'centre', n: 3 }]);
  });
});

describe('townPulseFor', () => {
  const drivers = ['a', 'b', 'c', 'me'].map((driverId) => ({ driverId, lat: 32.9041, lng: 45.0601 }));
  it('never lets him make a cell count, and shows no cell under the minimum', () => {
    const snap = townPulseSnapshot({ ...base, drivers });
    const me = townPulseFor(snap, { driverId: 'me', at: shop });
    expect(me.drivers).toEqual([{ at: snap.cells[0]!.at, n: 3 }]);
    const a = townPulseFor(townPulseSnapshot({ ...base, drivers: drivers.slice(1) }), { driverId: 'b', at: shop });
    expect(a.drivers).toEqual([]);
    expect(TOWN_PULSE_RULES.minCount).toBe(3);
  });

  it('keeps kitchens around him, nearest first', () => {
    const far = { lat: 32.95, lng: 45.1 };
    const snap = townPulseSnapshot({ ...base, kitchens: [{ merchantOrgId: 'far', pin: far, state: 'ready', acceptedAt: null, promisedReadyAt: null }, { merchantOrgId: 'near', pin: shop, state: 'ready', acceptedAt: null, promisedReadyAt: null }] });
    expect(townPulseFor(snap, { driverId: 'me', at: shop }).kitchens.map((k) => k.id)).toEqual(['near']);
  });
});

describe('townNowFor (the customer live map)', () => {
  it('shows cooking and ready shops alike as cooking, nearest first, never progress or areas', () => {
    const far = { lat: 32.95, lng: 45.06 };
    const near = { lat: 32.9045, lng: 45.0605 };
    const snap = townPulseSnapshot({
      ...base,
      kitchens: [
        { merchantOrgId: 'k1', pin: near, state: 'preparing', acceptedAt: min(10), promisedReadyAt: min(-10) },
        { merchantOrgId: 'k2', pin: shop, state: 'ready', acceptedAt: min(20), promisedReadyAt: min(1) },
        { merchantOrgId: 'k3', pin: far, state: 'preparing', acceptedAt: min(5), promisedReadyAt: min(-5) },
      ],
      placed: [...Array(4)].map(() => ({ zoneId: 'centre', placedAt: min(5) })),
    });
    const town = townNowFor(snap, shop);
    expect(town.cooking).toEqual([{ id: 'k2', at: shop }, { id: 'k1', at: near }]);
    expect(town).not.toHaveProperty('areas');
    expect(Object.keys(town.cooking[0]!)).toEqual(['id', 'at']);
  });

  it('counts drivers only in cells of three or more, as a number, never who', () => {
    const three = ['a', 'b', 'c'].map((driverId) => ({ driverId, lat: 32.9041, lng: 45.0601 }));
    const two = ['d', 'e'].map((driverId) => ({ driverId, lat: 32.9101, lng: 45.0701 }));
    const town = townNowFor(townPulseSnapshot({ ...base, drivers: [...three, ...two] }), shop);
    expect(town.drivers).toEqual([{ at: expect.any(Object), n: 3 }]);
    expect(JSON.stringify(town)).not.toMatch(/"a"|driverId/);
  });

  it('leaves out everything further than the radius', () => {
    const away = { lat: shop.lat + (TOWN_PULSE_RULES.radiusKm + 1) / 111, lng: shop.lng };
    const snap = townPulseSnapshot({ ...base, kitchens: [{ merchantOrgId: 'k9', pin: away, state: 'preparing', acceptedAt: min(1), promisedReadyAt: min(-9) }] });
    expect(townNowFor(snap, shop).cooking).toEqual([]);
  });
});
