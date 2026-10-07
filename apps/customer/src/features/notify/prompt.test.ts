import { describe, expect, it } from 'vitest';
import { deepLinkPath, PREPROMPT_SNOOZE_MS, rideAskOnLiveScreen, shouldShowPrePrompt } from './prompt';

describe('notification pre-prompt timing', () => {
  it('asks only while the OS permission is undetermined, and a "later" snoozes a week', () => {
    const now = 1_790_000_000_000;
    expect(shouldShowPrePrompt('undetermined', null, now)).toBe(true);
    expect(shouldShowPrePrompt('granted', null, now)).toBe(false);
    expect(shouldShowPrePrompt('denied', null, now)).toBe(false);
    expect(shouldShowPrePrompt('undetermined', now - 1000, now)).toBe(false);
    expect(shouldShowPrePrompt('undetermined', now - PREPROMPT_SNOOZE_MS, now)).toBe(true);
  });

  it('never over the live map: food asks on the kitchen screen; a ride asks inside the sheet once a driver is coming (f1, L-01)', () => {
    expect(rideAskOnLiveScreen(false, 'on_the_way')).toBe(false);
    expect(rideAskOnLiveScreen(false, 'preparing')).toBe(false);
    expect(rideAskOnLiveScreen(true, 'searching')).toBe(false);
    expect(rideAskOnLiveScreen(true, 'to_pickup')).toBe(true);
    expect(rideAskOnLiveScreen(true, 'at_pickup')).toBe(true);
    expect(rideAskOnLiveScreen(true, 'on_the_way')).toBe(false);
    expect(rideAskOnLiveScreen(true, null)).toBe(false);
  });

  it('turns our deep links into routes and ignores anything else', () => {
    expect(deepLinkPath('driver://order/ord_1')).toBe('/order/ord_1');
    expect(deepLinkPath('driver://chat/ord_1?kind=customer_courier')).toBe('/chat/ord_1?kind=customer_courier');
    expect(deepLinkPath('driver://ride/again?from=32.909500,45.063500,street_30,p1&to=32.912200,45.055200,mahdood_1&v=taxi&door=0')).toBe('/ride/again?from=32.909500,45.063500,street_30,p1&to=32.912200,45.055200,mahdood_1&v=taxi&door=0');
    expect(deepLinkPath('driver://')).toBe('/');
    expect(deepLinkPath('https://evil.example/x')).toBeNull();
    expect(deepLinkPath(undefined)).toBeNull();
  });
});
