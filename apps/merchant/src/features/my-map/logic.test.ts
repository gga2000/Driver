import { describe, expect, it } from 'vitest';
import { blockerOf, metresBetween, MOVE_MIN_M, toReportInput, type MyMapDraft } from './logic';

const HOME = { lat: 32.9093, lng: 45.0636 };
/** About 11 m north (1e-4 degree of latitude). */
const NUDGE = { lat: 32.9094, lng: 45.0636 };
/** About 111 m north. */
const NEXT_STREET = { lat: 32.9103, lng: 45.0636 };
const ctx = { current: HOME, storeName: 'مطعم خالد', mapOk: true };
const draft = (d: Partial<MyMapDraft>): MyMapDraft => ({ kind: 'moved', pin: null, name: '', note: '', ...d });

describe('my place on the map', () => {
  it('measures metres between two points', () => {
    expect(metresBetween(HOME, HOME)).toBe(0);
    expect(metresBetween(HOME, NUDGE)).toBeGreaterThan(10);
    expect(metresBetween(HOME, NUDGE)).toBeLessThan(MOVE_MIN_M);
    expect(Math.round(metresBetween(HOME, NEXT_STREET))).toBe(111);
  });

  it('a move needs the map and a pin at least 15 m from the one on file', () => {
    expect(blockerOf(draft({ pin: NEXT_STREET }), { ...ctx, mapOk: false })).toBe('no_map');
    expect(blockerOf(draft({}), ctx)).toBe('move_more');
    expect(blockerOf(draft({ pin: NUDGE }), ctx)).toBe('move_more');
    expect(blockerOf(draft({ pin: NEXT_STREET }), ctx)).toBeNull();
    // No pin on file yet: wherever she puts it is news.
    expect(blockerOf(draft({ pin: NUDGE }), { ...ctx, current: null })).toBeNull();
  });

  it('a wrong name needs a new name, and works without the map', () => {
    expect(blockerOf(draft({ kind: 'wrong_name', name: '  ' }), ctx)).toBe('name_missing');
    expect(blockerOf(draft({ kind: 'wrong_name', name: ' مطعم خالد ' }), ctx)).toBe('name_same');
    expect(blockerOf(draft({ kind: 'wrong_name', name: 'مطعم أبو خالد' }), { ...ctx, mapOk: false })).toBeNull();
  });

  it('sends the rounded pin for a move and only the name for a wrong name', () => {
    expect(toReportInput('org-1', draft({ pin: { lat: 32.910312345, lng: 45.063687654 }, name: 'x', note: '  جنب الجامع  ' }))).toEqual({
      cityId: 'aziziyah',
      kind: 'moved',
      target: { kind: 'restaurant', id: 'org-1' },
      pin: { lat: 32.91031, lng: 45.06369 },
      note: 'جنب الجامع',
    });
    expect(toReportInput('org-1', draft({ kind: 'wrong_name', pin: NEXT_STREET, name: ' مطعم أبو خالد ', note: ' ' }))).toEqual({
      cityId: 'aziziyah',
      kind: 'wrong_name',
      target: { kind: 'restaurant', id: 'org-1' },
      name_ar: 'مطعم أبو خالد',
    });
  });
});
