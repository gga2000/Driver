import { describe, expect, it } from 'vitest';
import { CUSTOMER_ZONE_MIN_ORDERS, feeBandsOf, PriceRequest, type Quote } from '@driver/contracts';
import { ConfigService } from '../config/index.js';
import { PricingError, PricingService } from '../pricing/index.js';
import { SEED_ZONES } from './area.fixtures.js';
import { composeCustomerZones, composeDeliveryArea, foodDeliveryFee } from './area.js';

const NOON = new Date('2026-10-03T09:00:00Z'); // 12:00 Baghdad
const pricing = new PricingService(new ConfigService());
const zones = SEED_ZONES.filter((z) => ['centre', 'zakur', 'khamas', 'hashimi', 'deir'].includes(z.key));

describe('foodDeliveryFee — checkout’s quote, nothing else', () => {
  it('is the delivery part of the food quote for the pair (no service fee)', () => {
    const quote = pricing.quote(PriceRequest.parse({ cityId: 'aziziyah', vertical: 'food', stops: [{ zoneId: 'centre', type: 'pickup' }, { zoneId: 'zakur', type: 'dropoff' }], at: NOON }));
    const delivery = quote.components.filter((c) => c.key !== 'service_fee' && c.key !== 'promo').reduce((a, c) => a + c.amount, 0);
    expect(foodDeliveryFee(pricing, 'aziziyah', 'centre', 'zakur', NOON)).toBe(delivery);
    expect(delivery).toBe(1000);
  });

  it('null when the engine cannot price it; any other fault is thrown, not hidden', () => {
    const refusing = { quote: (): Quote => { throw new PricingError('vertical_not_configured', 'food off'); } };
    expect(foodDeliveryFee(refusing, 'aziziyah', 'centre', 'zakur', NOON)).toBeNull();
    const broken = { quote: (): Quote => { throw new Error('config store down'); } };
    expect(() => foodDeliveryFee(broken, 'aziziyah', 'centre', 'zakur', NOON)).toThrow('config store down');
  });
});

describe('feeBandsOf', () => {
  it('one band per distinct fee, cheapest first, unpriced left out', () => {
    expect(feeBandsOf([1000, 500, null, 1000, 2000, 500, 1000])).toEqual([
      { feeIqd: 500, zones: 2 },
      { feeIqd: 1000, zones: 3 },
      { feeIqd: 2000, zones: 1 },
    ]);
    expect(feeBandsOf([null])).toEqual([]);
  });
});

describe('composeDeliveryArea', () => {
  const fees: Record<string, number | null> = { centre: 500, zakur: 1000, khamas: 1500, hashimi: 500, deir: null };
  const area = (paused: string[] = []) =>
    composeDeliveryArea({ merchantOrgId: 'org_1', cityId: 'aziziyah', kitchen: { zoneKey: 'centre', pin: { lat: 32.91, lng: 45.06 } }, zones, feeOf: (k) => fees[k] ?? null, paused: new Set(paused), at: NOON });

  it('gives each zone its fee, band and service; the kitchen’s zone is marked', () => {
    const view = area(['zakur']);
    expect(view.bands).toEqual([
      { feeIqd: 500, zones: 2 },
      { feeIqd: 1000, zones: 1 },
      { feeIqd: 1500, zones: 1 },
    ]);
    const byKey = new Map(view.zones.map((z) => [z.key, z]));
    expect(byKey.get('centre')).toMatchObject({ feeIqd: 500, band: 0, service: 'open', kitchen: true });
    expect(byKey.get('hashimi')).toMatchObject({ band: 0, kitchen: false });
    expect(byKey.get('zakur')).toMatchObject({ feeIqd: 1000, band: 1, service: 'paused' });
    expect(byKey.get('deir')).toMatchObject({ feeIqd: null, band: null, service: 'no_price' });
    expect(view.kitchen).toEqual({ zoneKey: 'centre', name_ar: 'العزيزية (مركز)', name_en: 'Aziziyah centre', pin: { lat: 32.91, lng: 45.06 } });
    expect(view.zones[0]!.ring.length).toBeGreaterThanOrEqual(3);
  });

  it('without a kitchen nothing is priced, even if a price function exists', () => {
    const view = composeDeliveryArea({ merchantOrgId: 'org_1', cityId: 'aziziyah', kitchen: null, zones, feeOf: () => 500, paused: new Set(), at: NOON });
    expect(view.kitchen).toBeNull();
    expect(view.bands).toEqual([]);
    expect(view.zones.every((z) => z.service === 'no_price')).toBe(true);
  });
});

describe('composeCustomerZones (D7: areas only, k ≥ 5)', () => {
  const base = { merchantOrgId: 'org_1', from: new Date('2026-09-03T09:00:00Z'), to: NOON, days: 30, zones };

  it('names zones at the threshold, hides those under it and orders without a zone, most first', () => {
    const view = composeCustomerZones({
      ...base,
      counts: [
        { zoneKey: 'hashimi', orders: CUSTOMER_ZONE_MIN_ORDERS },
        { zoneKey: 'zakur', orders: 12 },
        { zoneKey: 'khamas', orders: CUSTOMER_ZONE_MIN_ORDERS - 1 },
        { zoneKey: null, orders: 2 },
        { zoneKey: 'gone_zone', orders: 9 }, // removed from the map: can't be named or drawn
      ],
    });
    expect(view.zones.map((z) => [z.key, z.orders])).toEqual([
      ['zakur', 12],
      ['hashimi', 5],
    ]);
    expect(view).toMatchObject({ otherOrders: 4 + 2 + 9, totalOrders: 32, minOrders: 5 });
  });

  it('ties go by Arabic name', () => {
    const view = composeCustomerZones({ ...base, counts: [{ zoneKey: 'zakur', orders: 6 }, { zoneKey: 'deir', orders: 6 }] });
    expect(view.zones.map((z) => z.name_ar)).toEqual(['الدير', 'زاكور']);
  });

  it('nothing delivered: empty, zero', () => {
    expect(composeCustomerZones({ ...base, counts: [] })).toMatchObject({ zones: [], otherOrders: 0, totalOrders: 0 });
  });
});
