import { describe, expect, it } from 'vitest';
import type { BoardCourier, BoardOrder } from '@driver/contracts';
import * as golden from '@driver/map/golden';
import { comingCouriers, metresBetween, nextTrails, panelCamera, panelFrame, pinned, pointFrom, SHOW_MAX_M, trailGeoJSON, TRAIL_MAX, warmAt, WARM_MS, warmNow, type ComingCourier } from './courier-map';

const KITCHEN = { lat: 32.9085, lng: 45.0655 };
const none: BoardCourier = { state: 'none', firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null };
const order = (id: string, courier: Partial<BoardCourier>) => ({ id, number: id.toUpperCase(), courier: { ...none, ...courier } }) as unknown as BoardOrder;
const coming = (id: string, eta: number | null, at: [number, number] = [45.07, 32.91], far = false): ComingCourier => ({ orderId: id, number: id, firstName: 'حيدر', photoUrl: null, etaMinutes: eta, at, far });

describe('N16 courier map: where he is', () => {
  it('pointFrom puts him back where the radar measured him', () => {
    const north = pointFrom(KITCHEN, 1000, 0);
    expect(north[0]).toBeCloseTo(KITCHEN.lng, 6);
    expect(metresBetween([KITCHEN.lng, KITCHEN.lat], north)).toBeCloseTo(1000, 0);
    const east = pointFrom(KITCHEN, 500, 90);
    expect(east[1]).toBeCloseTo(KITCHEN.lat, 6);
    expect(east[0]).toBeGreaterThan(KITCHEN.lng);
    expect(metresBetween([KITCHEN.lng, KITCHEN.lat], east)).toBeCloseTo(500, 0);
  });

  it('comingCouriers: only couriers on their way with a radar fix, nearest first', () => {
    const list = comingCouriers(
      [
        order('a', { state: 'on_the_way', firstName: 'عباس', etaMinutes: 5, distanceM: 1500, bearingDeg: 10 }),
        order('b', { state: 'on_the_way', firstName: 'حيدر', etaMinutes: 2, distanceM: 600, bearingDeg: 200, photoUrl: '/p/h' }),
        order('c', { state: 'on_the_way', etaMinutes: 2, distanceM: null, bearingDeg: null }),
        order('d', { state: 'arrived', distanceM: 0 }),
        order('e', { state: 'searching' }),
      ],
      KITCHEN,
    );
    expect(list.map((c) => [c.orderId, c.firstName, c.photoUrl, c.far])).toEqual([
      ['b', 'حيدر', '/p/h', true],
      ['a', 'عباس', null, true],
    ]);
    // Farther than the shown street: at its edge, on his line.
    expect(metresBetween([KITCHEN.lng, KITCHEN.lat], list[1]!.at)).toBeCloseTo(SHOW_MAX_M, 0);
    const near = comingCouriers([order('n', { state: 'on_the_way', etaMinutes: 1, distanceM: 200, bearingDeg: 90 })], KITCHEN)[0]!;
    expect(near.far).toBe(false);
    expect(metresBetween([KITCHEN.lng, KITCHEN.lat], near.at)).toBeCloseTo(200, 0);
  });

  it('nextTrails keeps the way he came, only real steps, at most TRAIL_MAX, and forgets who left', () => {
    let trails = nextTrails(new Map(), [coming('a', 4, [45.07, 32.91])]);
    trails = nextTrails(trails, [coming('a', 4, [45.07, 32.91002])]); // ~2 m: no new dot
    expect(trails.get('a')).toHaveLength(1);
    for (let i = 1; i <= 20; i++) trails = nextTrails(trails, [coming('a', 3, [45.07, 32.91 + i * 0.0003])]);
    expect(trails.get('a')).toHaveLength(TRAIL_MAX);
    expect(nextTrails(trails, []).size).toBe(0);
    // Standing at the edge (still far): no way drawn yet.
    expect(nextTrails(trails, [coming('a', 6, [45.07, 32.92], true)]).get('a')).toEqual([]);
  });

  it('trailGeoJSON: dots behind him, not under his photo, older ones fainter', () => {
    const fc = trailGeoJSON(new Map([['a', [[1, 1], [2, 2], [3, 3]] as [number, number][]]]));
    expect(fc.features.map((f) => f.geometry.coordinates)).toEqual([[1, 1], [2, 2]]);
    expect(fc.features[0]!.properties!['a']).toBeLessThan(fc.features[1]!.properties!['a']);
  });
});

describe('N16 courier map: the shop warms once', () => {
  it('warmNow fires once per courier when he comes inside 2 minutes', () => {
    let s = warmNow(new Set(), [coming('a', 4)]);
    expect(s.warm).toBe(false);
    s = warmNow(s.warmed, [coming('a', 2)]);
    expect(s.warm).toBe(true);
    s = warmNow(s.warmed, [coming('a', 1)]);
    expect(s.warm).toBe(false);
    s = warmNow(s.warmed, [coming('a', 1), coming('b', 2)]);
    expect(s.warm).toBe(true);
    expect(warmNow(s.warmed, [coming('c', null)]).warm).toBe(false);
  });

  it('warmAt rises, peaks and settles back to rest', () => {
    expect(warmAt(0)).toBe(0);
    expect(warmAt(WARM_MS / 3)).toBeCloseTo(1, 5);
    expect(warmAt(WARM_MS * 0.8)).toBeGreaterThan(0);
    expect(warmAt(WARM_MS * 0.8)).toBeLessThan(1);
    expect(warmAt(WARM_MS)).toBe(0);
  });

  it('panelFrame looks from the nearest courier up the street to the shop', () => {
    const shop: [number, number] = [KITCHEN.lng, KITCHEN.lat];
    expect(panelFrame(KITCHEN, [coming('a', 2, [45.06, 32.9])])).toEqual({ from: [45.06, 32.9], to: shop });
    expect(panelFrame(KITCHEN, [])).toEqual({ from: shop, to: shop });
  });

  it('pinned: the nearest always, the others only once they are on the shown street', () => {
    const list = [coming('a', 3, [1, 1], true), coming('b', 4, [2, 2], true), coming('c', 5, [3, 3], false)];
    expect(pinned(list).map((c) => c.orderId)).toEqual(['a', 'c']);
  });
});

describe('N16 courier map: the camera', () => {
  it('panelCamera heads from the courier to the shop, tilted, both points inside', () => {
    const south = pointFrom(KITCHEN, 900, 180);
    const cam = panelCamera(golden, KITCHEN, [coming('a', 3, south)], { w: 500, h: 300 });
    expect(cam.zoom).toBeGreaterThanOrEqual(16);
    // The shop is due north of him, so the camera looks north.
    expect(cam.bearing).toBeCloseTo(0, 0);
    expect(cam.pitch).toBe(50);
    expect(cam.center[1]).toBeGreaterThan(south[1]);
    expect(cam.center[1]).toBeLessThan(KITCHEN.lat);
    expect(panelCamera(golden, KITCHEN, [], { w: 500, h: 300 }).bearing).toBe(0);
  });
});
