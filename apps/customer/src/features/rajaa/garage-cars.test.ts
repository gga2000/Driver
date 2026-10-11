import { describe, expect, it } from 'vitest';
import type { DepartureCard } from '@driver/contracts';
import { garageCars, garageKey, type GarageBay } from './garage-cars';

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
