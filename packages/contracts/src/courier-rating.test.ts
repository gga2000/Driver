import { describe, expect, it } from 'vitest';
import { COURIER_RATING_MIN_COUNT, COURIER_RATING_WINDOW, publicCourierRating } from './tracking.js';

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n));
const scores = (list: number[]) => list.map((score, i) => ({ score, at: day(i) }));

describe('the rating customers see on a courier card (joy l2)', () => {
  it('nothing until five customers rated him', () => {
    expect(publicCourierRating([])).toBeNull();
    expect(publicCourierRating(scores([5, 5, 5, 5]))).toBeNull();
    expect(COURIER_RATING_MIN_COUNT).toBe(5);
  });
  it('the average to one decimal, with how many it rests on', () => {
    expect(publicCourierRating(scores([5, 5, 4, 5, 4]))).toEqual({ rating: 4.6, count: 5 });
    expect(publicCourierRating(scores([5, 5, 5, 5, 5, 4]))).toEqual({ rating: 4.8, count: 6 });
  });
  it('only the newest fifty count', () => {
    const old = Array.from({ length: 30 }, (_, i) => ({ score: 1, at: day(i) }));
    const recent = Array.from({ length: COURIER_RATING_WINDOW }, (_, i) => ({ score: 5, at: day(100 + i) }));
    expect(publicCourierRating([...old, ...recent])).toEqual({ rating: 5, count: 50 });
  });
  it('ignores anything outside 1–5', () => {
    expect(publicCourierRating([...scores([5, 5, 5, 5, 5]), { score: 0, at: day(9) }, { score: 9, at: day(10) }])).toEqual({ rating: 5, count: 5 });
  });
});
