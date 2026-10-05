import { describe, expect, it } from 'vitest';
import { SuspicionCounter } from './position-suspicion.js';

describe('SuspicionCounter', () => {
  it('a fake-GPS fix flags at once, and only once a day', () => {
    const c = new SuspicionCounter();
    expect(c.note('d1', 'mocked', '2026-10-05')).toBe(true);
    expect(c.note('d1', 'mocked', '2026-10-05')).toBe(false);
  });
  it('jumps flag at the fifth, per driver', () => {
    const c = new SuspicionCounter();
    expect([1, 2, 3, 4].map(() => c.note('d1', 'jump', '2026-10-05'))).toEqual([false, false, false, false]);
    expect(c.note('d2', 'jump', '2026-10-05')).toBe(false);
    expect(c.note('d1', 'jump', '2026-10-05')).toBe(true);
    expect(c.note('d1', 'jump', '2026-10-05')).toBe(false);
  });
  it('a new day starts over', () => {
    const c = new SuspicionCounter();
    c.note('d1', 'mocked', '2026-10-05');
    expect(c.note('d1', 'mocked', '2026-10-06')).toBe(true);
  });
});
