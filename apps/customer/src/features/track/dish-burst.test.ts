import { describe, expect, it } from 'vitest';
import { BURST_BITS, BURST_MS, burstAt } from './dish-burst';

describe('the «بالعافية» burst of tiny dishes', () => {
  it('stays inside the celebration cap and starts and ends with nothing showing', () => {
    expect(BURST_MS).toBeLessThanOrEqual(900);
    for (const bit of BURST_BITS) {
      expect(burstAt(0, bit).opacity).toBe(0);
      expect(burstAt(1, bit).opacity).toBe(0);
      expect(burstAt(1, bit).scale).toBe(0);
    }
  });
  it('every dish flies outward, and most of them up', () => {
    const mid = BURST_BITS.map((b) => burstAt(0.5, b));
    for (const p of mid) expect(Math.hypot(p.x, p.y)).toBeGreaterThan(50);
    expect(mid.filter((p) => p.y < 0).length).toBeGreaterThanOrEqual(6);
  });
  it('fully shown in the middle of its flight', () => {
    for (const bit of BURST_BITS) expect(burstAt(0.45, bit).opacity).toBe(1);
  });
});
