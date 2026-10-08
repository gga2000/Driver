import { describe, expect, it } from 'vitest';
import { LIVE_STREET_SWITCH_ENABLED, streetSwitchOffered } from './street-switch';

describe('street hand-over on a live order (HUNT-01)', () => {
  it('is switched off until orders.switchHandover exists', () => {
    expect(LIVE_STREET_SWITCH_ENABLED).toBe(false);
    expect(streetSwitchOffered({ type: 'food', pickedUpAt: null }, true)).toBe(false);
  });

  it('when switched on: food before pickup on a live order only', () => {
    expect(streetSwitchOffered({ type: 'food', pickedUpAt: null }, true, true)).toBe(true);
    expect(streetSwitchOffered({ type: 'grocery_catalog', pickedUpAt: null }, true, true)).toBe(true);
    expect(streetSwitchOffered({ type: 'food', pickedUpAt: new Date() }, true, true)).toBe(false);
    expect(streetSwitchOffered({ type: 'food', pickedUpAt: null }, false, true)).toBe(false);
    expect(streetSwitchOffered({ type: 'ride', pickedUpAt: null }, true, true)).toBe(false);
  });
});
