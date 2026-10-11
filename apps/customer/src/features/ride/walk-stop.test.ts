import { describe, expect, it } from 'vitest';
import { t } from '@driver/i18n';
import { fasterBy, isWalkStop, showWalkOffer, stopLatLng, walkMetres, walkMinutes, walkStopSpot, type SafeStop } from './walk-stop';

const STOP: SafeStop = { stop: [45.0662, 32.9089], landmarkName: 'الجامع الكبير', walkM: 63 };

describe('walk to a safe stop (map idea N10)', () => {
  it('reads the walk the way people say it', () => {
    expect(walkMinutes(63)).toBe(1);
    expect(walkMinutes(20)).toBe(1);
    expect(walkMinutes(150)).toBe(2);
    expect(walkMinutes(240)).toBe(3);
    expect(walkMetres(63)).toBe(60);
    expect(walkMetres(4)).toBe(10);
    expect(walkMetres(246)).toBe(250);
  });

  it('says «أسرع بـ» only when the car really comes a whole minute sooner', () => {
    expect(fasterBy(7, 3)).toBe(4);
    expect(fasterBy(4, 3.6)).toBeNull();
    expect(fasterBy(3, 3)).toBeNull();
    expect(fasterBy(3, 5)).toBeNull();
    expect(fasterBy(null, 3)).toBeNull();
    expect(fasterBy(6, undefined)).toBeNull();
  });

  it('offers the walk on street pickup only, not in simple mode, not once dismissed or chosen', () => {
    const base = { stop: STOP, mode: 'street' as const, simple: false, dismissed: false, walking: false };
    expect(showWalkOffer(base)).toBe(true);
    expect(showWalkOffer({ ...base, stop: null })).toBe(false);
    expect(showWalkOffer({ ...base, mode: 'door' })).toBe(false);
    expect(showWalkOffer({ ...base, simple: true })).toBe(false);
    expect(showWalkOffer({ ...base, dismissed: true })).toBe(false);
    expect(showWalkOffer({ ...base, walking: true })).toBe(false);
  });

  it('makes the stop the pickup in the stop’s own zone, marked as a walk', () => {
    const spot = walkStopSpot(STOP, 'z_markaz', 'قبال الجامع الكبير', '60 متر مشي');
    expect(spot.pin).toEqual(stopLatLng(STOP));
    expect(spot.pin).toEqual({ lat: 32.9089, lng: 45.0662 });
    expect(spot.zoneId).toBe('z_markaz');
    expect(spot.kind).toBe('pin');
    expect(isWalkStop(spot)).toBe(true);
    expect(isWalkStop({ id: 'pin:32.90000,45.06000' })).toBe(false);
    expect(isWalkStop(null)).toBe(false);
  });

  it('words the offer in natural Iraqi Arabic', () => {
    expect(t('ride.walk_title', { n: 1 })).toBe('امشي دقيقة للشارع العام');
    expect(t('ride.walk_title', { n: 2 })).toBe('امشي دقيقتين للشارع العام');
    expect(t('ride.walk_faster', { n: 4 })).toBe('أسرع بـ 4 دقايق');
    expect(t('ride.walk_arrives', { n: 3 })).toBe('يوصلك بعد 3 دقايق.');
    expect(t('ride.walk_body', { place: 'الجامع الكبير' })).toBe('السايق يوكف هنا بأمان، قبال الجامع الكبير.');
  });
});
