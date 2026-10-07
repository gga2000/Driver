import { describe, expect, it } from 'vitest';
import { uiSwitchOn } from './ui-switches';

describe('uiSwitchOn', () => {
  it('follows the build when nothing is listed: on in studio builds, off in store builds', () => {
    expect(uiSwitchOn('basket_v2', undefined, true)).toBe(true);
    expect(uiSwitchOn('basket_v2', '', false)).toBe(false);
  });
  it('turns on only the listed screens', () => {
    expect(uiSwitchOn('basket_v2', 'basket_v2, checkout_v2', false)).toBe(true);
    expect(uiSwitchOn('track_v2', 'basket_v2,checkout_v2', true)).toBe(false);
    expect(uiSwitchOn('orders_v2', 'all', false)).toBe(true);
  });
  it('none keeps every old screen, even in the studio', () => {
    expect(uiSwitchOn('basket_v2', 'none', true)).toBe(false);
  });
});
