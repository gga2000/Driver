import { describe, expect, it } from 'vitest';
import { homeContext } from './context';

describe('homeContext (C-09)', () => {
  it('always shows what is happening now: the live order and a booked seat', () => {
    expect(homeContext({ active: true, rajaaTrip: false, reorder: true })).toEqual(['active']);
    expect(homeContext({ active: false, rajaaTrip: true, reorder: true })).toEqual(['rajaa_trip']);
    expect(homeContext({ active: true, rajaaTrip: true, reorder: true })).toEqual(['active', 'rajaa_trip']);
  });
  it('otherwise one card: the reorder when there is a recent meal, else none (the trip tiles show the cars)', () => {
    expect(homeContext({ active: false, rajaaTrip: false, reorder: true })).toEqual(['reorder']);
    expect(homeContext({ active: false, rajaaTrip: false, reorder: false })).toEqual([]);
  });
});
