import { describe, expect, it } from 'vitest';
import type { CityPricingConfig, PriceRequest, PriceRequestInput } from '@driver/contracts';
import { PriceRequest as PriceRequestSchema } from '@driver/contracts';
import { aziziyah } from '../config/cities/aziziyah.js';
import { PricingEngine, clamp, inWindow, roundTo } from './engine.js';

const engine = new PricingEngine(() => 'q_test');
const NOON = new Date('2026-10-02T09:00:00Z'); // 12:00 Asia/Baghdad
const MIDNIGHT = new Date('2026-10-02T21:00:00Z'); // 00:00 Asia/Baghdad

function req(partial: Partial<PriceRequestInput> & { stops: PriceRequestInput['stops'] }): PriceRequest {
  return PriceRequestSchema.parse({ cityId: 'aziziyah', vertical: 'taxi', at: NOON, ...partial });
}

const stops = (...zones: string[]) => zones.map((zoneId) => ({ zoneId }));

const amountOf = (q: ReturnType<PricingEngine['quote']>, key: string) =>
  q.components.filter((c) => c.key === key).reduce((a, c) => a + c.amount, 0);

describe('PricingEngine — Aziziyah', () => {
  it('prices a zone fare from the city table', () => {
    const q = engine.quote(req({ stops: stops('center', 'north') }), aziziyah);
    expect(amountOf(q, 'base')).toBe(4000);
    expect(q.total).toBe(4000);
    expect(q.currency).toBe('IQD');
  });

  it('zone fares are symmetric', () => {
    const a = engine.quote(req({ stops: stops('north', 'center') }), aziziyah);
    const b = engine.quote(req({ stops: stops('center', 'north') }), aziziyah);
    expect(a.total).toBe(b.total);
  });

  it('adds the +2000 front seat premium on intercity', () => {
    const base = engine.quote(req({ vertical: 'intercity', stops: stops('center', 'kut') }), aziziyah);
    const front = engine.quote(
      req({ vertical: 'intercity', stops: stops('center', 'kut'), options: { frontSeat: true } }),
      aziziyah,
    );
    expect(base.total).toBe(10000);
    expect(amountOf(front, 'front_seat')).toBe(2000);
    expect(front.total).toBe(12000);
    expect(front.components.find((c) => c.key === 'front_seat')?.label_ar).toBe('مقعد أمامي');
  });

  it('prices Baghdad higher than Kut', () => {
    const kut = engine.quote(req({ vertical: 'intercity', stops: stops('center', 'kut') }), aziziyah);
    const bgd = engine.quote(req({ vertical: 'intercity', stops: stops('center', 'baghdad') }), aziziyah);
    expect(bgd.total).toBeGreaterThan(kut.total);
    expect(bgd.total).toBe(15000);
  });

  it('door pickup costs more than street pickup and both are explained', () => {
    const street = engine.quote(req({ stops: stops('center', 'south') }), aziziyah);
    const door = engine.quote(req({ stops: stops('center', 'south'), options: { doorPickup: true } }), aziziyah);
    expect(street.components.some((c) => c.key === 'street_pickup')).toBe(true);
    expect(street.components.some((c) => c.key === 'door_pickup')).toBe(false);
    expect(amountOf(street, 'street_pickup')).toBe(0);
    expect(amountOf(door, 'door_pickup')).toBe(1000);
    expect(door.total - street.total).toBe(1000);
  });

  it('rounds to the nearest 250 IQD', () => {
    // 4000 base + 3 min wait × 250 = 4750 (already on-grid); 1 min wait → 4250.
    const q = engine.quote(req({ stops: stops('center', 'north'), options: { waitMinutes: 1 } }), aziziyah);
    expect(q.total).toBe(4250);
    // Use a custom config with a 333 wait rate to force an off-grid subtotal.
    const custom: CityPricingConfig = {
      ...aziziyah,
      verticals: aziziyah.verticals.map((v) =>
        v.vertical === 'taxi'
          ? { ...v, components: v.components.map((c) => (c.key === 'wait' ? { ...c, perUnit: 333 } : c)) }
          : v,
      ),
    };
    const off = engine.quote(req({ stops: stops('center', 'north'), options: { waitMinutes: 1 } }), custom);
    expect(off.subtotal).toBe(4333);
    expect(off.total).toBe(4250);
    expect(off.rounding).toEqual({ step: 250, applied: -83 });
  });

  it('applies floor and ceiling per vertical', () => {
    const promoHeavy = engine.quote(
      req({ stops: stops('center', 'center'), options: { promoIqd: 10000 } }),
      aziziyah,
    );
    expect(promoHeavy.subtotal).toBe(-7000);
    expect(promoHeavy.total).toBe(3000);
    expect(promoHeavy.bounds.clamped).toBe(true);

    const longWait = engine.quote(
      req({ stops: stops('center', 'outskirts'), options: { waitMinutes: 200 } }),
      aziziyah,
    );
    expect(longWait.total).toBe(25000);
    expect(longWait.bounds).toMatchObject({ floor: 3000, ceiling: 25000, clamped: true });
  });

  it('always computes distance and time as shadow components, hidden from the shown list', () => {
    const q = engine.quote(req({ stops: stops('center', 'north'), distanceKm: 4.2, durationMin: 11 }), aziziyah);
    const keys = q.shadowComponents.map((c) => c.key);
    expect(keys).toContain('distance');
    expect(keys).toContain('time');
    expect(q.components.map((c) => c.key)).not.toContain('distance');
    expect(q.shadowComponents.find((c) => c.key === 'distance')?.amount).toBe(2100);
    expect(q.shadowComponents.find((c) => c.key === 'time')?.amount).toBe(1100);
    expect(q.shadowComponents.every((c) => c.visibility === 'shadow')).toBe(true);
    // Shadow total reflects what the quote would be if metered pricing were enabled.
    expect(q.total).toBe(4000);
    expect(q.shadowTotal).toBe(7250);
  });

  it('flipping a shadow component to shown moves it into the paid total', () => {
    const metered: CityPricingConfig = {
      ...aziziyah,
      verticals: aziziyah.verticals.map((v) =>
        v.vertical === 'taxi'
          ? { ...v, components: v.components.map((c) => (c.key === 'distance' ? { ...c, visibility: 'shown' } : c)) }
          : v,
      ),
    };
    const q = engine.quote(req({ stops: stops('center', 'north'), distanceKm: 2 }), metered);
    expect(q.components.map((c) => c.key)).toContain('distance');
    expect(q.total).toBe(5000);
  });

  it('prices a multi-leg trip per leg', () => {
    const q = engine.quote(req({ stops: stops('center', 'north', 'south') }), aziziyah);
    const bases = q.components.filter((c) => c.key === 'base');
    expect(bases).toHaveLength(2);
    expect(bases.map((b) => b.leg)).toEqual([0, 1]);
    expect(bases.map((b) => b.amount)).toEqual([4000, 5000]);
    expect(q.total).toBe(9000);
  });

  it('adds a night fee inside the configured window only', () => {
    const day = engine.quote(req({ stops: stops('center', 'north') }), aziziyah);
    const night = engine.quote(req({ stops: stops('center', 'north'), at: MIDNIGHT }), aziziyah);
    expect(day.components.some((c) => c.key === 'night')).toBe(false);
    expect(amountOf(night, 'night')).toBe(1000);
  });

  it('every component carries Arabic and English labels and a driver share rule', () => {
    const q = engine.quote(
      req({ stops: stops('center', 'north'), options: { doorPickup: true, waitMinutes: 2, promoIqd: 500 } }),
      aziziyah,
    );
    for (const c of [...q.components, ...q.shadowComponents]) {
      expect(c.label_ar.length).toBeGreaterThan(0);
      expect(c.label_en.length).toBeGreaterThan(0);
      expect(['driver_full', 'driver_commissioned', 'platform_only']).toContain(c.driverShareRule);
    }
    expect(amountOf(q, 'promo')).toBe(-500);
  });

  it('rejects an unconfigured vertical or mismatched city', () => {
    const noKhat: CityPricingConfig = { ...aziziyah, verticals: aziziyah.verticals.filter((v) => v.vertical !== 'khat') };
    expect(() => engine.quote(req({ vertical: 'khat', stops: stops('center', 'north') }), noKhat)).toThrow(
      /not configured/,
    );
    expect(() => engine.quote(req({ cityId: 'kut', stops: stops('center', 'north') }), aziziyah)).toThrow(
      /city_mismatch|!=/,
    );
  });
});

describe('pricing helpers', () => {
  it('roundTo rounds half up to the step', () => {
    expect(roundTo(4125, 250)).toBe(4250);
    expect(roundTo(4124, 250)).toBe(4000);
    expect(roundTo(4000, 250)).toBe(4000);
  });
  it('clamp reports whether bounds were applied', () => {
    expect(clamp(100, 500, 1000)).toEqual({ value: 500, clamped: true });
    expect(clamp(700, 500, 1000)).toEqual({ value: 700, clamped: false });
    expect(clamp(5000, undefined, 1000)).toEqual({ value: 1000, clamped: true });
  });
  it('inWindow wraps midnight', () => {
    expect(inWindow(23, [23, 5])).toBe(true);
    expect(inWindow(2, [23, 5])).toBe(true);
    expect(inWindow(5, [23, 5])).toBe(false);
    expect(inWindow(12, [9, 17])).toBe(true);
  });
});
