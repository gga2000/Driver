import { describe, expect, it } from 'vitest';
import { hiddenParam, nextBefore, starsTone, tripKey } from './reviews';

describe('Console «كلام الركاب»', () => {
  it('maps the filter to the API input', () => {
    expect(hiddenParam('all')).toBeUndefined();
    expect(hiddenParam('hidden')).toBe(true);
    expect(hiddenParam('shown')).toBe(false);
  });
  it('reads the trip from the corridor and direction', () => {
    expect(tripKey('aziziyah_baghdad', 'to_aziziyah')).toEqual({ from: 'rajaa.city_baghdad', to: 'rajaa.city_aziziyah' });
    expect(tripKey('aziziyah_kut', 'from_aziziyah')).toEqual({ from: 'rajaa.city_aziziyah', to: 'rajaa.city_kut' });
  });
  it('low stars stand out', () => {
    expect([1, 2, 3, 4, 5].map(starsTone)).toEqual(['bad', 'bad', 'warn', 'neutral', 'neutral']);
  });
  it('pages from the oldest row', () => {
    expect(nextBefore([])).toBeNull();
    const at = new Date('2026-10-01T10:00:00Z');
    expect(nextBefore([{ at: new Date() } as never, { at } as never])).toBe(at);
  });
});
