import { describe, expect, it } from 'vitest';
import { climateShiftAt, shiftIdAt } from './climate-check.js';
import { RideCargoInput, rideCargoKey, sortCargo } from './ride-cargo.js';

/** A Baghdad wall-clock time (UTC+3) as an instant. */
const bgd = (iso: string) => new Date(`${iso}+03:00`);

describe('the shift question (ride idea x1)', () => {
  it('a hot shift asks about AC until the heat is over, the answer holding until the shift ends', () => {
    expect(climateShiftAt(bgd('2026-07-14T14:00:00'))).toEqual({ shiftId: '2026-07-14:day', climate: 'hot', feature: 'ac', endsAt: bgd('2026-07-14T15:00:00') });
    // 07:00: not hot yet, but the day shift runs into the afternoon heat.
    expect(climateShiftAt(bgd('2026-07-14T07:00:00'))?.shiftId).toBe('2026-07-14:day');
    // 19:30 in the evening shift: half an hour of heat left.
    expect(climateShiftAt(bgd('2026-07-14T19:30:00'))).toMatchObject({ shiftId: '2026-07-14:evening', feature: 'ac', endsAt: bgd('2026-07-15T02:00:00') });
    expect(climateShiftAt(bgd('2026-07-14T20:00:00'))).toBeNull();
  });

  it('cold shifts ask about heating; mild ones and the hours between shifts ask nothing', () => {
    expect(climateShiftAt(bgd('2026-01-14T10:00:00'))).toMatchObject({ climate: 'cold', feature: 'heating' });
    // A March afternoon: the cold comes at 18:00, within the evening shift.
    expect(climateShiftAt(bgd('2026-03-10T16:00:00'))).toMatchObject({ shiftId: '2026-03-10:evening', feature: 'heating' });
    expect(climateShiftAt(bgd('2026-03-10T09:00:00'))).toBeNull();
    expect(climateShiftAt(bgd('2026-10-07T14:00:00'))).toBeNull();
    expect(climateShiftAt(bgd('2026-01-14T03:00:00'))).toBeNull();
  });

  it('00:30 still belongs to the shift that started the day before', () => {
    expect(shiftIdAt(bgd('2026-07-15T00:30:00'))).toBe('2026-07-14:evening');
    expect(shiftIdAt(bgd('2026-07-15T04:00:00'))).toBeNull();
  });
});

describe('«عندي غراض» (ride idea x5)', () => {
  it('keeps chip order and refuses a kind twice', () => {
    expect(sortCargo(['big', 'bags'])).toEqual(['bags', 'big']);
    expect(rideCargoKey('gas')).toBe('ride.cargo.gas');
    expect(RideCargoInput.safeParse(['gas', 'gas']).success).toBe(false);
    expect(RideCargoInput.safeParse([]).success).toBe(true);
  });
});
