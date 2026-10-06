import { describe, expect, it } from 'vitest';
import type { BoardCourier, BoardOrder, MerchantBoard } from '@driver/contracts';
import { applyRadar, arriving, distanceParts, incoming, newArrivals, RADAR_LABEL_SIZE, radarLabelAt, radarPoint, radarRadius } from './radar';

const courier = (over: Partial<BoardCourier> = {}): BoardCourier => ({
  state: 'on_the_way',
  firstName: 'حيدر',
  vehicleClass: 'bike',
  etaMinutes: 5,
  arrivedAt: null,
  distanceM: 1500,
  bearingDeg: 90,
  plate: 'واسط 45671',
  pickupCode: '4821',
  ...over,
});
const order = (id: string, c: Partial<BoardCourier> = {}) => ({ id, number: id, courier: courier(c) }) as unknown as BoardOrder;

describe('courier radar (maps program SP7a)', () => {
  it('patches the board from a live radar event, only for a courier on his way', () => {
    const board = { merchantOrgId: 'm1', now: new Date(0), acceptWindowSec: 90, orders: [order('a'), order('b', { state: 'arrived', distanceM: null })] } as unknown as MerchantBoard;
    const next = applyRadar(board, { type: 'courier_radar', orderId: 'a', distanceM: 400, bearingDeg: 10, etaMinutes: 2, at: new Date(0) })!;
    expect(next.orders[0]!.courier).toMatchObject({ distanceM: 400, bearingDeg: 10, etaMinutes: 2 });
    expect(applyRadar(board, { type: 'courier_radar', orderId: 'b', distanceM: 400, bearingDeg: 10, etaMinutes: 2, at: new Date(0) })).toBe(board);
    expect(applyRadar(undefined, { type: 'courier_radar', orderId: 'a', distanceM: 1, bearingDeg: 0, etaMinutes: 1, at: new Date(0) })).toBeUndefined();
  });

  it('arriving: inside 250 m, or at the counter; a minute away only when the distance is unknown', () => {
    expect(arriving(courier())).toBe(false);
    expect(arriving(courier({ distanceM: 240 }))).toBe(true);
    expect(arriving(courier({ distanceM: 570, etaMinutes: 1 }))).toBe(false);
    expect(arriving(courier({ distanceM: null, etaMinutes: 1 }))).toBe(true);
    expect(arriving(courier({ state: 'arrived', distanceM: null }))).toBe(true);
    expect(arriving(courier({ state: 'picked_up', distanceM: 10 }))).toBe(false);
  });

  it('chimes once per courier, never for what the first read already showed', () => {
    const first = newArrivals(null, [order('a', { state: 'arrived' }), order('b')]);
    expect(first.chime).toEqual([]);
    const second = newArrivals(first.seen, [order('a', { state: 'arrived' }), order('b', { distanceM: 200 })]);
    expect(second.chime).toEqual(['b']);
    expect(newArrivals(second.seen, [order('a', { state: 'arrived' }), order('b', { state: 'arrived' })]).chime).toEqual([]);
    // Reassigned: a new courier (new code) on the same order chimes again.
    expect(newArrivals(second.seen, [order('b', { distanceM: 100, pickupCode: '1111' })]).chime).toEqual(['b']);
  });

  it('the list: at the counter first, then nearest; nobody without a position', () => {
    const list = incoming([order('far', { distanceM: 2500 }), order('here', { state: 'arrived', distanceM: null }), order('near', { distanceM: 300 }), order('unknown', { distanceM: null }), order('gone', { state: 'picked_up' })]);
    expect(list.map((o) => o.id)).toEqual(['here', 'near', 'far']);
  });

  it('rings: 250 m a third of the way out, 3 km the edge, north up', () => {
    expect(radarRadius(0)).toBe(0);
    expect(radarRadius(250)).toBeCloseTo(Math.log(2) / Math.log(13), 5);
    expect(radarRadius(3000)).toBeCloseTo(1, 5);
    expect(radarRadius(9000)).toBe(1);
    const north = radarPoint(3000, 0);
    expect(north.x).toBeCloseTo(0, 5);
    expect(north.y).toBeCloseTo(-1, 5);
    expect(radarPoint(3000, 90).x).toBeCloseTo(1, 5);
  });

  it('ticket labels stay inside the radar: above the dot, below it on the top edge, never off the side', () => {
    // 128 px radar (R = 56): a dot half way out sits with its number above it.
    expect(radarLabelAt(64, 36, 128)).toEqual({ x: 64, y: 26 });
    // Due north at 3 km (y = 8): above would be cut off, so the number goes under the dot.
    const top = radarLabelAt(64, 8, 128);
    expect(top.y).toBeGreaterThan(8);
    expect(top.y - RADAR_LABEL_SIZE).toBeGreaterThan(8);
    // Due east/west at the edge: the 4 digits stay inside.
    expect(radarLabelAt(122, 64, 128).x).toBe(116);
    expect(radarLabelAt(6, 64, 128).x).toBe(12);
  });

  it('distance labels: metres to the nearest 10 under a kilometre, then kilometres', () => {
    expect(distanceParts(823)).toEqual({ key: 'merchant.radar.metres', value: '820' });
    expect(distanceParts(3)).toEqual({ key: 'merchant.radar.metres', value: '10' });
    expect(distanceParts(1450)).toEqual({ key: 'merchant.radar.km', value: '1.4' });
    expect(distanceParts(12_300)).toEqual({ key: 'merchant.radar.km', value: '12' });
  });
});
