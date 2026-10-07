import { describe, expect, it } from 'vitest';
import { pullDistance, PULL_AT } from './pull';

describe('home tea pull', () => {
  it('follows the finger at half speed up to the line, then stiffens like a rubber band', () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(64)).toBe(32);
    expect(pullDistance(PULL_AT * 2)).toBe(PULL_AT);
    // 100 px of finger past the line moves the page only 12.5 px more.
    expect(pullDistance(PULL_AT * 2 + 100)).toBe(PULL_AT + 12.5);
  });

  it('never moves backwards as the finger goes further', () => {
    let last = 0;
    for (let dy = 0; dy <= 600; dy += 7) {
      const d = pullDistance(dy);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });
});
