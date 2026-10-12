import { describe, expect, it } from 'vitest';
import { detailText, holdRows, inService, rowHref, rowTone, serviceOf } from './inbox';

const lateCar = (facts: Record<string, string | number | boolean>) => ({ kind: 'late_departure' as const, subjectKind: 'departure' as const, subjectId: 'dep_1', orderId: null, facts });

describe('Today rows for a late الرجعة car', () => {
  it('say why and how many riders, and open the garage page', () => {
    expect(detailText(lateCar({ reason: 'driver_no_show', riders: 4 }))).toBe('السايق ما إجا · 4 ركاب');
    expect(detailText(lateCar({ reason: 'not_arrived', riders: 3 }))).toBe('ما وصل · 3 ركاب');
    expect(detailText(lateCar({ reason: 'not_arrived', riders: 1 }))).toBe('ما وصل · راكب واحد');
    expect(rowHref(lateCar({ reason: 'not_arrived' }))).toBe('/garage');
  });

  it('turn red only when riders wait at the garage for a driver who never came', () => {
    expect(rowTone(lateCar({ reason: 'driver_no_show', riders: 4 }))).toBe('bad');
    expect(rowTone(lateCar({ reason: 'driver_no_show', riders: 0 }))).toBe('warn');
    expect(rowTone(lateCar({ reason: 'not_arrived', riders: 3 }))).toBe('warn');
  });
});

describe('holding new Today rows while someone works the list', () => {
  const rows = [
    { id: 'a', kind: 'late' as const },
    { id: 'n', kind: 'no_driver' as const },
    { id: 'b', kind: 'store_silent' as const },
    { id: 's', kind: 'sos' as const },
  ];
  it('shows everything when nobody is working the list', () => {
    expect(holdRows(rows, new Set(['a']), false)).toEqual({ shown: rows, held: 0 });
    expect(holdRows(rows, null, true)).toEqual({ shown: rows, held: 0 });
  });
  it('keeps new rows back but never an SOS', () => {
    const r = holdRows(rows, new Set(['a', 'b']), true);
    expect(r.shown.map((x) => x.id)).toEqual(['a', 'b', 's']);
    expect(r.held).toBe(1);
  });
});

describe('Today service chips (h7)', () => {
  const row = (kind: Parameters<typeof serviceOf>[0]['kind'], facts: Record<string, string> = {}) => ({ kind, facts });
  it('put each row under its service', () => {
    expect(serviceOf(row('store_silent'))).toBe('delivery');
    expect(serviceOf(row('no_driver', { vertical: 'tuktuk' }))).toBe('ride');
    expect(serviceOf(row('no_driver', { vertical: 'intercity' }))).toBe('intercity');
    expect(serviceOf(row('late_departure'))).toBe('intercity');
    expect(serviceOf(row('over_ceiling'))).toBe('delivery');
    expect(serviceOf(row('sweep'))).toBe('khat');
    expect(serviceOf(row('low_rating', { orderType: 'ride' }))).toBe('ride');
  });
  it('never hide an SOS, a safety report or a row that does not say its service', () => {
    expect(inService(row('sos'), 'khat')).toBe(true);
    expect(inService(row('safety_report'), 'delivery')).toBe(true);
    expect(inService(row('no_driver'), 'ride')).toBe(true);
    expect(inService(row('store_silent'), 'khat')).toBe(false);
    expect(inService(row('store_silent'), null)).toBe(true);
  });
});
