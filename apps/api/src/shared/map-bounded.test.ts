import { describe, expect, it } from 'vitest';
import { mapBounded } from './map-bounded.js';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapBounded', () => {
  it('keeps the input order whatever order the work finishes in, and never runs more than the limit', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapBounded([30, 5, 20, 1, 10, 0], 3, async (ms, i) => {
      running += 1;
      peak = Math.max(peak, running);
      await tick(ms);
      running -= 1;
      return `${i}:${ms}`;
    });
    expect(out).toEqual(['0:30', '1:5', '2:20', '3:1', '4:10', '5:0']);
    expect(peak).toBe(3);
  });

  it('answers an empty list with an empty list and passes a failure on', async () => {
    expect(await mapBounded([], 4, async () => 1)).toEqual([]);
    await expect(mapBounded([1, 2], 2, async (n) => (n === 2 ? Promise.reject(new Error('boom')) : n))).rejects.toThrow('boom');
  });
});
