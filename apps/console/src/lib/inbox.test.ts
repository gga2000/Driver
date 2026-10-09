import { describe, expect, it } from 'vitest';
import { detailText, rowHref, rowTone } from './inbox';

const lateCar = (facts: Record<string, string | number | boolean>) => ({ kind: 'late_departure' as const, subjectKind: 'departure' as const, subjectId: 'dep_1', orderId: null, facts });

describe('Today rows for a late الرجعة car', () => {
  it('say why and how many riders, and open the garage page', () => {
    expect(detailText(lateCar({ reason: 'driver_no_show', riders: 4 }))).toBe('السايق ما إجا · 4 راكب');
    expect(detailText(lateCar({ reason: 'not_arrived', riders: 3 }))).toBe('ما وصل · 3 راكب');
    expect(rowHref(lateCar({ reason: 'not_arrived' }))).toBe('/garage');
  });

  it('turn red only when riders wait at the garage for a driver who never came', () => {
    expect(rowTone(lateCar({ reason: 'driver_no_show', riders: 4 }))).toBe('bad');
    expect(rowTone(lateCar({ reason: 'driver_no_show', riders: 0 }))).toBe('warn');
    expect(rowTone(lateCar({ reason: 'not_arrived', riders: 3 }))).toBe('warn');
  });
});
