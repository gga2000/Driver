import { describe, expect, it } from 'vitest';
import { CompleteStopInput } from './trip.js';
import { isGuessableStartCode, StartCode, START_CODE_RULES } from './ride-safety-io.js';
import { TrackTrip } from './tracking.js';

describe('«رمز المشوار» (ride step 3, s1)', () => {
  it('one repeated digit or a straight run is guessable; anything else is not', () => {
    for (const c of ['0000', '1111', '1234', '9876', '3456', '6543']) expect(isGuessableStartCode(c), c).toBe(true);
    for (const c of ['4821', '1235', '0907', '1122', '9871']) expect(isGuessableStartCode(c), c).toBe(false);
  });
  it('not digits, or too short to be a code, is never a good code', () => {
    expect(isGuessableStartCode('12a4')).toBe(true);
    expect(isGuessableStartCode('7')).toBe(true);
  });
  it('a code is exactly 4 Western digits', () => {
    expect(START_CODE_RULES.length).toBe(4);
    expect(StartCode.safeParse('4821').success).toBe(true);
    expect(StartCode.safeParse('482').success).toBe(false);
    expect(StartCode.safeParse('٤٨٢١').success).toBe(false);
  });
  it('the partner sends it on the start, optional for every other stop', () => {
    expect(CompleteStopInput.parse({ tripId: 't', stopId: 's' }).startCode).toBeUndefined();
    expect(CompleteStopInput.parse({ tripId: 't', stopId: 's', startCode: '4821' }).startCode).toBe('4821');
    expect(CompleteStopInput.safeParse({ tripId: 't', stopId: 's', startCode: '48' }).success).toBe(false);
  });
  it('an older server that sends no code on the trip reads as none', () => {
    const trip = TrackTrip.parse({ id: 't', state: 'accepted', acceptedAt: null, completedAt: null, stops: [], dropsBeforeMine: 0, unreachable: null, vertical: 'taxi' });
    expect(trip.startCode ?? null).toBeNull();
  });
});
