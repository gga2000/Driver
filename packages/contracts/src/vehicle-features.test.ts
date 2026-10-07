import { describe, expect, it } from 'vitest';
import { climateAt, isNightAt, sortFeatures, VEHICLE_COLOUR_HEX, VehicleColour } from './vehicle-features.js';

/** A Baghdad wall-clock time (UTC+3) as an instant. */
const bgd = (iso: string) => new Date(`${iso}+03:00`);

describe('vehicle features and colours (ride ideas d1, n1, n6)', () => {
  it('every colour has its paint', () => {
    for (const c of VehicleColour.options) expect(VEHICLE_COLOUR_HEX[c]).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('AC and heating lead, the quiet ones follow, in a fixed order', () => {
    expect(sortFeatures(['big_boot', 'ac', 'family'])).toEqual(['ac', 'family', 'big_boot']);
  });
  it('summer afternoons are hot, winter is cold, the edge months are cold at night', () => {
    expect(climateAt(bgd('2026-07-15T14:00:00'))).toBe('hot');
    expect(climateAt(bgd('2026-07-15T22:00:00'))).toBeNull();
    expect(climateAt(bgd('2026-01-10T13:00:00'))).toBe('cold');
    expect(climateAt(bgd('2026-11-05T19:00:00'))).toBe('cold');
    expect(climateAt(bgd('2026-11-05T12:00:00'))).toBeNull();
    expect(climateAt(bgd('2026-10-07T15:00:00'))).toBeNull();
  });
  it('night is 21:00 to 05:59 in Baghdad', () => {
    expect(isNightAt(bgd('2026-10-07T21:00:00'))).toBe(true);
    expect(isNightAt(bgd('2026-10-07T05:59:00'))).toBe(true);
    expect(isNightAt(bgd('2026-10-07T06:00:00'))).toBe(false);
    expect(isNightAt(bgd('2026-10-07T20:59:00'))).toBe(false);
  });
});
