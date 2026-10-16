import { describe, expect, it } from 'vitest';
import { secondsLeft } from '@/features/work/logic';
import { arrivedTooLate, batchMinutes, localExpiry, riderTripsKey, serviceOf, shouldOpenOffer, speakText, timeShare } from './slip';

const t = (key: string, p?: Record<string, string | number>) => `${key}${p ? JSON.stringify(p) : ''}`;

describe('order slip', () => {
  it('colours each service its own way (b9: tuktuk is plum, not saffron)', () => {
    expect(serviceOf('food')).toBe('food');
    expect(serviceOf('parcel')).toBe('food');
    expect(serviceOf('tuktuk')).toBe('tuktuk');
    expect(serviceOf('taxi')).toBe('taxi');
    expect(serviceOf('intercity')).toBe('trips');
  });

  it('names the rider’s history in plain words', () => {
    expect(riderTripsKey(0)).toBe('partner.slip_rider_zero');
    expect(riderTripsKey(1)).toBe('partner.slip_rider_one');
    expect(riderTripsKey(4)).toBe('partner.slip_rider_few');
    expect(riderTripsKey(23)).toBe('partner.slip_rider_many');
  });

  it('drains the time bar from full to empty', () => {
    const exp = new Date(20_000);
    expect(timeShare(exp, 20, 0)).toBe(1);
    expect(timeShare(exp, 20, 10_000)).toBe(0.5);
    expect(timeShare(exp, 20, 30_000)).toBe(0);
  });

  it('counts the ring from the server’s clock, so a phone 20 s fast or slow still gets the full 15 s', () => {
    const server = Date.parse('2026-10-03T10:00:00Z');
    const offer = { expiresAt: new Date(server + 15_000), serverNow: new Date(server) };
    for (const skew of [20_000, -20_000, 0]) {
      const receivedAt = server + skew;
      const expiry = localExpiry(offer, receivedAt);
      expect(arrivedTooLate(expiry, receivedAt)).toBe(false);
      expect(secondsLeft(expiry, receivedAt)).toBe(15);
      expect(secondsLeft(expiry, receivedAt + 10_000)).toBe(5);
    }
    // Counting on the phone's own clock (the old way) drops it unseen on a phone 20 s fast.
    expect(arrivedTooLate(offer.expiresAt, server + 20_000)).toBe(true);
  });

  it('brings an unanswered offer back on top, never one already answered or the card twice', () => {
    const done = new Set(['o1']);
    expect(shouldOpenOffer('o2', '(tabs)', done)).toBe(true);
    expect(shouldOpenOffer('o2', 'job', done)).toBe(true);
    expect(shouldOpenOffer('o2', 'offer', done)).toBe(false);
    expect(shouldOpenOffer('o1', '(tabs)', done)).toBe(false);
    expect(shouldOpenOffer(null, '(tabs)', done)).toBe(false);
  });

  it('drops an offer that reached the screen already over (l8)', () => {
    expect(arrivedTooLate(new Date(10_000), 9_000)).toBe(true);
    expect(arrivedTooLate(new Date(10_000), 1_000)).toBe(false);
  });

  it('adds minutes only for a second order on the way', () => {
    expect(batchMinutes({ batch: null, tripKm: 2 }, 'bike')).toBeNull();
    expect(batchMinutes({ batch: { extraIqd: 700, withTripIds: ['t1'] }, tripKm: 2 }, 'bike')).toBeGreaterThan(0);
  });

  it('reads kind, money, place, kitchen time and cash, numbers without separators', () => {
    const text = speakText(
      { vertical: 'food', pay: { totalIqd: 1250, components: [], takePct: null }, pickup: { zoneId: 'centre', label: 'مطعم خالد', pin: null, landmark: null }, collectIqd: 18000, merchant: { name: 'مطعم خالد', state: 'preparing', readyInMin: 9 } },
      'مطعم خالد',
      t as never,
      'ar-IQ',
    );
    expect(text).toContain('"amount":"1250"');
    expect(text).toContain('partner.slip_speak_ready');
    expect(text).toContain('"amount":"18000"');
    expect(text.split('، ')).toHaveLength(3);
  });
});
