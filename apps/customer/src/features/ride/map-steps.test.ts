import { describe, expect, it } from 'vitest';
import { t } from '@driver/i18n';
import type { Spot } from './logic';
import { KEEP_SPOT_M, nearestNamed, quickPlaces, spotAtPin } from './map-steps';

const spot = (id: string, lat: number, lng: number, extra: Partial<Spot> = {}): Spot => ({ id, kind: 'landmark', title: id, zoneId: 'z_markaz', pin: { lat, lng }, ...extra });
const MOSQUE = spot('جامع شارع 30', 32.9088, 45.0621);
const MARKET = spot('سوق العزيزية', 32.9056, 45.0607);
const HOME = spot('saved:home', 32.9093, 45.0614, { kind: 'saved', title: 'البيت', savedLabel: 'home' });
const pinSpot = (pin: { lat: number; lng: number }, keep: Spot | null, named: Spot | null) =>
  spotAtPin({ pin, zoneId: 'z_s30', keep, named, zoneName: 'شارع 30', nearLabel: (place) => t('ride.map_near', { place }), pinLabel: t('ride.pin_spot') });

describe('map-led booking: the place under the pin', () => {
  it('names the pin after the nearest landmark within 150 m, else nothing', () => {
    expect(nearestNamed({ lat: 32.9093, lng: 45.0614 }, [MARKET, MOSQUE])?.id).toBe('جامع شارع 30');
    expect(nearestNamed({ lat: 32.92, lng: 45.07 }, [MARKET, MOSQUE])).toBeNull();
  });

  it('keeps his own place while the pin stays on it, and becomes a pin spot once moved', () => {
    expect(pinSpot(HOME.pin, HOME, MOSQUE)).toBe(HOME);
    const moved = pinSpot({ lat: 32.9093 + (KEEP_SPOT_M * 3) / 111_000, lng: 45.0614 }, HOME, MOSQUE);
    expect(moved.kind).toBe('pin');
    expect(moved.title).toBe('قرب جامع شارع 30');
    expect(moved.subtitle).toBe('شارع 30');
    expect(moved.zoneId).toBe('z_s30');
  });

  it('falls back to the area name with no landmark near', () => {
    const s = pinSpot({ lat: 32.92, lng: 45.07 }, null, null);
    expect(s.title).toBe('شارع 30');
    expect(s.subtitle).toBe(t('ride.pin_spot'));
    expect(s.id).toBe('pin:32.92000,45.07000');
  });

  it('offers three quick drop-off places, no repeats and never where he stands', () => {
    const garage = spot('كراج البوابة 1', 32.91575, 45.0405);
    const recentMarket = { ...MARKET, id: 'recent:market', kind: 'recent' as const };
    const out = quickPlaces({ picks: [garage], saved: [HOME], recent: [recentMarket, MARKET, MOSQUE], pickup: HOME });
    expect(out.map((s) => s.title)).toEqual(['كراج البوابة 1', 'سوق العزيزية']);
  });

  it('reads the steps in natural Iraqi Arabic', () => {
    expect(t('ride.map_pickup_title')).toBe('منين نجيك؟');
    expect(t('ride.map_confirm')).toBe('هنا، تمام');
    expect(t('ride.steps_a11y', { n: 2, step: t('ride.step_dropoff') })).toBe('الخطوة 2 من 3: الوجهة');
  });
});
