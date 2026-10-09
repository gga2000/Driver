import { describe, expect, it } from 'vitest';
import { later } from './orders.service.js';

describe('later (SCALE-24): reads run together, checks keep their order', () => {
  it('answers in the order asked even when a later read finishes first', async () => {
    const seen: string[] = [];
    const slow = later(new Promise<string>((r) => setTimeout(() => (seen.push('slow'), r('a')), 20)));
    const fast = later(Promise.resolve().then(() => (seen.push('fast'), 'b')));
    expect(await slow()).toBe('a');
    expect(await fast()).toBe('b');
    expect(seen).toEqual(['fast', 'slow']);
  });

  it('the first check asked throws its own error, and an unasked failing read is never unhandled', async () => {
    let unhandled = 0;
    const onUnhandled = () => (unhandled += 1);
    process.on('unhandledRejection', onUnhandled);
    try {
      const first = later(new Promise((_, rej) => setTimeout(() => rej(new Error('first')), 10)));
      later(Promise.reject(new Error('never asked')));
      await expect(first()).rejects.toThrow('first');
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toBe(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
