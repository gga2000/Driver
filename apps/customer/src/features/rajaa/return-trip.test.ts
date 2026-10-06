import { describe, expect, it } from 'vitest';
import { presetWindow, returnTrip } from './return-trip';

const dep = (departAt: string, direction: 'to_aziziyah' | 'from_aziziyah' = 'from_aziziyah') => ({ departure: { corridorId: 'aziziyah_baghdad', direction, departAt: new Date(departAt) } });

describe('returnTrip («احجز رجعتك»)', () => {
  it('is the reverse direction on the same corridor, same weekday and time next week', () => {
    // Saturday 07:00 Baghdad (04:00Z) to Baghdad, arrived at 08:40.
    const r = returnTrip(dep('2026-10-03T04:00:00Z'), new Date('2026-10-03T05:40:00Z'));
    expect(r).toEqual({ corridorId: 'aziziyah_baghdad', direction: 'to_aziziyah', at: new Date('2026-10-10T04:00:00Z') });
  });

  it('skips a week that is already (nearly) past', () => {
    const r = returnTrip(dep('2026-10-03T04:00:00Z', 'to_aziziyah'), new Date('2026-10-10T03:30:00Z'));
    expect(r.direction).toBe('from_aziziyah');
    expect(r.at).toEqual(new Date('2026-10-17T04:00:00Z'));
  });
});

describe('presetWindow', () => {
  it('reads the board an hour before to two hours after the preset time', () => {
    expect(presetWindow(new Date('2026-10-10T04:00:00Z'))).toEqual({ from: new Date('2026-10-10T03:00:00Z'), to: new Date('2026-10-10T06:00:00Z') });
  });
  it('is the default window without a valid time', () => {
    expect(presetWindow(null)).toBeNull();
    expect(presetWindow(new Date('nope'))).toBeNull();
  });
});
