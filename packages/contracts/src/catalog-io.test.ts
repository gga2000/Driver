import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from './aziziyah-zones.js';
import { deliveryFeesOf, RestaurantCard } from './catalog-io.js';
import type { QuoteComponent } from './pricing.js';
import { AZIZIYAH_RESTAURANTS, seedItemId } from './seeds/aziziyah-restaurants.js';

const c = (key: QuoteComponent['key'], amount: number): QuoteComponent => ({ key, amount, label_ar: key, label_en: key, driverShareRule: 'platform_only', visibility: 'shown' });

describe('deliveryFeesOf', () => {
  it('splits a food quote the way orders charges it: service fee apart, promo excluded', () => {
    expect(deliveryFeesOf({ components: [c('base', 1000), c('service_fee', 500), c('night', 500)] })).toEqual({ deliveryFeeIqd: 1500, serviceFeeIqd: 500 });
    expect(deliveryFeesOf({ components: [c('base', 500), c('street_pickup', -250), c('promo', -500), c('service_fee', 500)] })).toEqual({ deliveryFeeIqd: 250, serviceFeeIqd: 500 });
    expect(deliveryFeesOf({ components: [] })).toEqual({ deliveryFeeIqd: 0, serviceFeeIqd: 0 });
  });
});

describe('launch restaurants seed', () => {
  const zones = new Set(AZIZIYAH_ZONES.map((z) => z.id));

  it('four Aziziyah kitchens on known zones, with stable distinct ids', () => {
    expect(AZIZIYAH_RESTAURANTS.map((r) => r.nameAr)).toEqual(['مطعم خالد', 'مشويات الحاج كريم', 'مأكولات الشام', 'مطعم المسافر']);
    expect(new Set(AZIZIYAH_RESTAURANTS.map((r) => r.orgId)).size).toBe(4);
    for (const r of AZIZIYAH_RESTAURANTS) {
      expect(zones.has(r.zoneKey), r.key).toBe(true);
      expect(r.orgId).toBe(`org_aziziyah_${r.key}`);
      expect(r.hours).toHaveLength(7);
      expect(r.categories.length, r.key).toBeGreaterThanOrEqual(3);
      const ids = r.categories.flatMap((cat) => cat.items.map((i) => seedItemId(r, i)));
      expect(new Set(ids).size, `${r.key} item keys`).toBe(ids.length);
    }
  });

  it('IQD prices are positive multiples of 250 (modifier deltas multiples of 250 too)', () => {
    for (const r of AZIZIYAH_RESTAURANTS) {
      expect(r.minOrderIqd % 250).toBe(0);
      for (const item of r.categories.flatMap((cat) => cat.items)) {
        expect(item.priceIqd, item.nameAr).toBeGreaterThan(0);
        expect(item.priceIqd % 250, item.nameAr).toBe(0);
        for (const g of item.modifierGroups ?? []) {
          expect(g.options.length, `${item.nameAr}/${g.nameAr}`).toBeGreaterThan(0);
          expect(g.max).toBeGreaterThanOrEqual(g.min ?? (g.required ? 1 : 0));
          expect(g.max).toBeLessThanOrEqual(g.options.length);
          for (const o of g.options) expect(o.priceIqd % 250, `${item.nameAr}/${o.nameAr}`).toBe(0);
        }
      }
    }
  });

  it('card schema accepts a closed kitchen without a fee preview', () => {
    const card = RestaurantCard.parse({
      id: 'org_1',
      cityId: 'aziziyah',
      name: 'مطعم المسافر',
      cuisine: 'باچة',
      tags: [],
      photoUrl: null,
      rating: null,
      pickup: null,
      prepMinMinutes: 30,
      prepMaxMinutes: 40,
      etaMinMinutes: null,
      etaMaxMinutes: null,
      deliveryFeeIqd: null,
      serviceFeeIqd: null,
      minOrderIqd: 8000,
      open: false,
      closedReason: 'hours',
      opensAt: '5:00',
      busy: false,
    });
    expect(card.open).toBe(false);
  });
});
