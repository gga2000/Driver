import { describe, expect, it } from 'vitest';
import * as barrel from './index.js';
import { ANDROID_CHANNELS, AndroidChannelId } from './android-channels.js';
import * as notify from './notify-io.js';

describe('Android channels (their own file, so the apps skip the notify text catalogue)', () => {
  it('still has the four channels each app creates at start', () => {
    expect(AndroidChannelId.options).toEqual(['offers', 'orders', 'chat', 'marketing']);
    const forApp = (app: 'customer' | 'partner' | 'merchant') =>
      Object.values(ANDROID_CHANNELS)
        .filter((c) => c.apps.includes(app))
        .map((c) => c.id);
    expect(forApp('customer')).toEqual(['orders', 'chat', 'marketing']);
    expect(forApp('partner')).toEqual(['offers', 'orders', 'chat']);
    expect(forApp('merchant')).toEqual(['offers', 'orders', 'chat']);
  });

  it('is the same object from notify-io and the contracts index', () => {
    expect(notify.ANDROID_CHANNELS).toBe(ANDROID_CHANNELS);
    expect(notify.AndroidChannelId).toBe(AndroidChannelId);
    expect(barrel.ANDROID_CHANNELS).toBe(ANDROID_CHANNELS);
    expect(barrel.OFFER_SOUND).toBe('offer.wav');
  });
});
