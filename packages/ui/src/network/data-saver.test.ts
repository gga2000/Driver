import { describe, expect, it } from 'vitest';
import { LITE_REFRESH_FACTOR, liteFor, liteInterval } from './data-saver';

describe('low-data mode (maps program q2)', () => {
  it('auto follows the connection; on and off are the person’s choice', () => {
    expect(liteFor('auto', true)).toBe(true);
    expect(liteFor('auto', false)).toBe(false);
    expect(liteFor('on', false)).toBe(true);
    expect(liteFor('off', true)).toBe(false);
  });

  it('refreshes slow down in low-data mode', () => {
    expect(liteInterval(10_000, false)).toBe(10_000);
    expect(liteInterval(10_000, true)).toBe(10_000 * LITE_REFRESH_FACTOR);
  });
});
