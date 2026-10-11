import { describe, expect, it } from 'vitest';
import type { DepartureCard } from '@driver/contracts';
import { barLiftPx, garageCars,garageKey, garageLot, LOT_PITCH, LOT_TURN, LOT_ZOOM, lotCamera, SEAT_FLOOR_M, SEAT_TALL_M, seatBarPaint, spreadBays, type GarageBay } from './garage-cars';

const at = (min: number) => new Date(Date.UTC(2026, 9, 11, 6) + min * 60_000);
const dep = (id: string, garageId: string, departMin: number, seatsTotal: number, free: number) =>
  ({ id, garageId, departAt: at(departMin), latestDepartureAt: at(departMin + 45), state: 'scheduled', fill: { seatsTotal, free } }) as unknown as DepartureCard;
const BAYS: GarageBay[] = [
  { at: [45.0405, 32.9157], bearing: 90 },
  { at: [45.0406, 32.9158], bearing: 90 },
];

describe('garageCars (map idea N12)', () => {
  it('puts the soonest cars of this garage in the bays, with seats taken from the board', () => {
    const cars = garageCars([dep('d3', 'mp_garage_bab1', 90, 4, 4), dep('d1', 'mp_garage_bab1', 30, 7, 2), dep('dx', 'mp_garage_bab2', 10, 4, 1), dep('d2', 'mp_garage_bab1', 60, 4, 0)], 'mp_garage_bab1', BAYS);
    expect(cars).toEqual([
      { id: 'd1', at: BAYS[0]!.at, bearing: 90, seats: 7, taken: 5 },
      { id: 'd2', at: BAYS[1]!.at, bearing: 90, seats: 4, taken: 4 },
    ]);
  });

  it('draws nothing without bays, and knows only the three town garages', () => {
    expect(garageCars([dep('d1', 'mp_garage_bab1', 30, 4, 2)], 'mp_garage_bab1', [])).toEqual([]);
    expect(['mp_garage_bab1', 'mp_garage_bab2', 'mp_garage_souq', 'mp_garage_nahdha'].map(garageKey)).toEqual(['bab1', 'bab2', 'souq', null]);
  });
});

describe('garageLot', () => {
  it('keeps this garage’s bookable cars, soonest first, like the board', () => {
    const gone = { ...dep('dg', 'mp_garage_bab1', 0, 4, 2), state: 'departed' } as unknown as DepartureCard;
    const late = dep('dl', 'mp_garage_bab1', -120, 4, 2);
    const lot = garageLot([dep('d2', 'mp_garage_bab1', 60, 4, 1), gone, late, dep('dx', 'mp_garage_bab2', 10, 4, 1), dep('d1', 'mp_garage_bab1', 20, 4, 4)], 'mp_garage_bab1', at(0));
    expect(lot.map((d) => d.id)).toEqual(['d1', 'd2']);
  });
});

describe('spreadBays', () => {
  const bays = Array.from({ length: 10 }, (_, i) => ({ at: [45 + i / 1e4, 32.9] as [number, number], bearing: 8 }));
  it('spreads the cars over the lot, first and last bay included, order kept', () => {
    expect(spreadBays(bays, 3).map((b) => bays.indexOf(b))).toEqual([0, 5, 9]);
    expect(spreadBays(bays, 1).map((b) => bays.indexOf(b))).toEqual([2]);
  });
  it('never asks for more bays than there are', () => {
    expect(spreadBays(bays, 40)).toHaveLength(10);
    expect(spreadBays(bays, 0)).toEqual([]);
    expect(spreadBays([], 3)).toEqual([]);
  });
});

describe('seatBarPaint', () => {
  it('stands the bars over the garage roof, keeping the map’s own heights when they are higher', () => {
    const { base, height } = seatBarPaint();
    expect(base).toEqual(['max', ['get', 'base'], SEAT_FLOOR_M]);
    expect(height).toEqual(['max', ['get', 'hm'], SEAT_FLOOR_M + SEAT_TALL_M]);
  });
  it('rises each seat after the one before it', () => {
    const { height } = seatBarPaint({ t: 0.5, stagger: 0.1 });
    expect(JSON.stringify(height)).toContain('["-",0.5,["*",0.1,["get","seat"]]]');
  });
});

describe('barLiftPx', () => {
  it('is nothing from straight above and grows with the zoom and the tilt', () => {
    expect(barLiftPx(19, 0, 32.9)).toBe(0);
    const a = barLiftPx(18, 55, 32.9);
    expect(barLiftPx(19, 55, 32.9)).toBeCloseTo(a * 2, 6);
    expect(barLiftPx(18, 60, 32.9)).toBeGreaterThan(a);
    // ~9.8 m at zoom 19 (0.125 m/px) tilted 55° → ~64 px.
    expect(barLiftPx(19, 55, 32.9)).toBeGreaterThan(55);
    expect(barLiftPx(19, 55, 32.9)).toBeLessThan(75);
  });
});

describe('lotCamera', () => {
  it('centres on the bays and looks across them at the hall', () => {
    const cam = lotCamera([
      { at: [45.04, 32.91], bearing: 8 },
      { at: [45.042, 32.912], bearing: 188 },
    ]);
    expect(cam?.center[0]).toBeCloseTo(45.041, 6);
    expect(cam?.center[1]).toBeCloseTo(32.911, 6);
    expect(cam).toMatchObject({ bearing: (188 + LOT_TURN) % 360, pitch: LOT_PITCH, zoom: LOT_ZOOM });
    expect(lotCamera([])).toBeNull();
  });
});
