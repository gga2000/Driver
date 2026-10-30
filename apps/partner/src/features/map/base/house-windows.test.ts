import { describe, expect, it } from 'vitest';
import { windowsKey } from './house-windows';

describe('windowsKey', () => {
  it('stays the same for a nudge under 10 m and changes for a move, a zoom or new houses', () => {
    const base = windowsKey(17.2, [45.06612, 32.90211], 40);
    expect(windowsKey(17.21, [45.06614, 32.90212], 40)).toBe(base);
    expect(windowsKey(17.2, [45.0671, 32.90211], 40)).not.toBe(base);
    expect(windowsKey(17.6, [45.06612, 32.90211], 40)).not.toBe(base);
    expect(windowsKey(17.2, [45.06612, 32.90211], 41)).not.toBe(base);
  });
});
