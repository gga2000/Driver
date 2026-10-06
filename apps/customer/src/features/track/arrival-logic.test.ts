import { describe, expect, it } from 'vitest';
import { ARRIVAL_REPLAY_MS, arrivalPlays, arrivalSeenKey, cashAtDoor, gatePhotoFor } from './arrival-logic';

const HOME = { lat: 32.9097, lng: 45.0633 };

describe('arrival: the saved gate photo and the cash at the door (C-11)', () => {
  it('picks the photo of the saved place the order went to, never a far one', () => {
    const places = [
      { pin: { lat: 32.8962, lng: 45.0671 }, photos: [{ id: 'w', url: '/files/work' }] },
      { pin: { lat: 32.9098, lng: 45.0634 }, photos: [{ id: 'h', url: '/files/home' }] },
      { pin: HOME, photos: [] },
    ];
    expect(gatePhotoFor({ zoneKey: 'street_30', pin: HOME }, places)).toBe('/files/home');
    expect(gatePhotoFor({ zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } }, places)).toBeNull();
    expect(gatePhotoFor(null, places)).toBeNull();
    expect(gatePhotoFor({ zoneKey: 'street_30' }, places)).toBeNull();
  });

  it('cash: the rounded total to hand over and the change that goes to the wallet; wallet: nothing to hand over', () => {
    expect(cashAtDoor({ paymentMethod: 'cash', totalIqd: 18000, changeIqd: 200 })).toEqual({ kind: 'cash', cashIqd: 18000, priceIqd: 17800, changeIqd: 200, tender: null, creditedIqd: 0, paidIqd: 18000 });
    expect(cashAtDoor({ paymentMethod: 'cash', totalIqd: 16500 })).toEqual({ kind: 'cash', cashIqd: 16500, priceIqd: 16500, changeIqd: 0, tender: null, creditedIqd: 0, paidIqd: 16500 });
    expect(cashAtDoor({ paymentMethod: 'wallet', totalIqd: 17800, changeIqd: 0 })).toEqual({ kind: 'paid', amountIqd: 17800 });
  });

  it('"الخردة علينا": the stated note and its change before, the wallet credit after the hand-off', () => {
    expect(cashAtDoor({ paymentMethod: 'cash', totalIqd: 17750, statedTenderIqd: 25000 })).toMatchObject({ tender: { tenderIqd: 25000, changeIqd: 7250 }, creditedIqd: 0 });
    // The exact amount needs no change line.
    expect(cashAtDoor({ paymentMethod: 'cash', totalIqd: 17750, statedTenderIqd: 17750 })).toMatchObject({ tender: null });
    expect(cashAtDoor({ paymentMethod: 'cash', totalIqd: 17750, statedTenderIqd: 25000, changeToWalletIqd: 7250 })).toMatchObject({ creditedIqd: 7250, paidIqd: 25000 });
  });
});

describe('arrival: the delivered moment plays once per order (f2, L-04)', () => {
  const DELIVERED = new Date('2026-10-06T12:00:00Z');
  const at = (min: number) => DELIVERED.getTime() + min * 60_000;
  it('plays on the live transition, or when the screen opens within 10 minutes of delivery', () => {
    expect(arrivalPlays({ seen: false, liveTransition: true, deliveredAt: DELIVERED, now: at(30) })).toBe(true);
    expect(arrivalPlays({ seen: false, liveTransition: false, deliveredAt: DELIVERED, now: at(9) })).toBe(true);
    expect(arrivalPlays({ seen: false, liveTransition: false, deliveredAt: DELIVERED, now: at(10) })).toBe(true);
    expect(arrivalPlays({ seen: false, liveTransition: false, deliveredAt: DELIVERED, now: at(11) })).toBe(false);
  });
  it('never again once seen on this phone, and not without a delivery time unless live', () => {
    expect(arrivalPlays({ seen: true, liveTransition: true, deliveredAt: DELIVERED, now: at(1) })).toBe(false);
    expect(arrivalPlays({ seen: false, liveTransition: false, deliveredAt: null, now: at(1) })).toBe(false);
    expect(ARRIVAL_REPLAY_MS).toBe(10 * 60_000);
  });
  it('the key is per order and safe for every platform store', () => {
    expect(arrivalSeenKey('ord_1a2b')).toBe('driver.customer.arrival-seen.ord_1a2b');
    expect(arrivalSeenKey('ord/../x y')).toMatch(/^[\w.-]+$/);
  });
});
