import { describe, expect, it } from 'vitest';
import { alongRoad, roadLine, type RoadPoint } from './road';

const start: RoadPoint = { id: 'g', kind: 'start', name: 'باب 1', lat: 32.91, lng: 45.06 };
const end: RoadPoint = { id: 'b', kind: 'end', name: 'بغداد', lat: 33.33, lng: 44.42 };
const mid = (f: number, id: string, kind: RoadPoint['kind'] = 'checkpoint'): RoadPoint => ({ id, kind, name: id, lat: start.lat + (end.lat - start.lat) * f, lng: start.lng + (end.lng - start.lng) * f });
const departAt = new Date('2026-10-07T04:00:00Z');

describe('the road line (r1, r2)', () => {
  it('places points along the road', () => {
    expect(alongRoad(start, end, start)).toBe(0);
    expect(alongRoad(start, end, end)).toBe(1);
    expect(alongRoad(start, end, mid(0.5, 'm'))).toBeCloseTo(0.5, 5);
  });
  it('before it leaves: stops in road order, times from the announced time', () => {
    const r = roadLine({ start, end, between: [mid(0.75, 'cp2'), mid(0.25, 'cp1')], departAt, travelMin: 120, car: null, now: new Date('2026-10-07T03:30:00Z') });
    expect(r.stops.map((s) => s.id)).toEqual(['g', 'cp1', 'cp2', 'b']);
    expect(r.stops[1]!.at.toISOString()).toBe('2026-10-07T04:30:00.000Z');
    expect(r.arriveAt.toISOString()).toBe('2026-10-07T06:00:00.000Z');
    expect(r.stops.every((s) => !s.passed)).toBe(true);
  });
  it('on the road: times from where the car is, passed stops marked', () => {
    const now = new Date('2026-10-07T05:00:00Z');
    const r = roadLine({ start, end, between: [mid(0.25, 'cp1'), mid(0.6, 'mine', 'my_stop')], departAt, travelMin: 120, car: mid(0.5, 'car'), now });
    expect(r.carFrac).toBeCloseTo(0.5, 5);
    expect(r.stops.map((s) => s.passed)).toEqual([true, true, false, false]);
    expect(r.minutesLeft).toBe(60);
    expect(r.arriveAt.toISOString()).toBe('2026-10-07T06:00:00.000Z');
  });
  it('passed stops are timed from when the car really left', () => {
    const now = new Date('2026-10-07T05:00:00Z');
    const r = roadLine({ start, end, between: [mid(0.25, 'cp1')], departAt, departedAt: new Date('2026-10-07T04:10:00Z'), travelMin: 120, car: mid(0.5, 'car'), now });
    expect(r.stops[0]!.at.toISOString()).toBe('2026-10-07T04:10:00.000Z');
    expect(r.stops[1]!.at.toISOString()).toBe('2026-10-07T04:35:00.000Z');
    expect(r.arriveAt.toISOString()).toBe('2026-10-07T06:00:00.000Z');
  });
});
