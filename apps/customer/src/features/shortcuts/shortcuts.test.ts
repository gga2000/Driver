import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { shortcutItems, shortcutsKey } from './shortcuts';

const t = createT('ar-IQ');

describe('app icon shortcuts (joy t1)', () => {
  it('a guest gets الرجعة only', () => {
    const items = shortcutItems({ signedIn: false, activeOrderId: 'o1', activeIsRide: false, lastMerchant: 'مطعم خالد' }, t);
    expect(items.map((s) => s.id)).toEqual(['rajaa']);
    expect(items[0]!.params.href).toBe('/rajaa');
  });

  it('a live order comes first, then the last meal, then الرجعة', () => {
    const items = shortcutItems({ signedIn: true, activeOrderId: 'o1', activeIsRide: false, lastMerchant: 'مطعم خالد' }, t);
    expect(items.map((s) => [s.id, s.params.href])).toEqual([
      ['track', '/order/o1'],
      ['reorder', '/?reorder=last'],
      ['rajaa', '/rajaa'],
    ]);
    expect(items[0]!.title).toBe(t('shortcut.track'));
    expect(items[1]!.subtitle).toBe('مطعم خالد');
  });

  it('a live ride says so; nothing live and nothing to reorder leaves الرجعة', () => {
    expect(shortcutItems({ signedIn: true, activeOrderId: 'r1', activeIsRide: true, lastMerchant: null }, t)[0]!.title).toBe(t('shortcut.track_ride'));
    expect(shortcutItems({ signedIn: true, activeOrderId: null, activeIsRide: false, lastMerchant: null }, t).map((s) => s.id)).toEqual(['rajaa']);
  });

  it('the key changes when the items do', () => {
    const a = shortcutItems({ signedIn: true, activeOrderId: 'o1', activeIsRide: false, lastMerchant: null }, t);
    const b = shortcutItems({ signedIn: true, activeOrderId: null, activeIsRide: false, lastMerchant: null }, t);
    expect(shortcutsKey(a)).not.toBe(shortcutsKey(b));
    expect(shortcutsKey(a)).toBe(shortcutsKey(shortcutItems({ signedIn: true, activeOrderId: 'o1', activeIsRide: false, lastMerchant: null }, t)));
  });
});
