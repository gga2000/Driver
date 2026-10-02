import { describe, expect, it } from 'vitest';
import { PriceRequest } from './pricing.js';
import { LedgerEvent } from './ledger.js';

describe('contracts', () => {
  it('parses a PriceRequest with defaults and coerces dates', () => {
    const req = PriceRequest.parse({
      cityId: 'aziziyah',
      vertical: 'taxi',
      stops: [{ zoneId: 'centre' }, { zoneId: 'zakur' }],
      at: '2026-10-02T10:00:00Z',
    });
    expect(req.options.frontSeat).toBe(false);
    expect(req.stops[0]?.type).toBe('dropoff');
    expect(req.at).toBeInstanceOf(Date);
  });

  it('rejects a PriceRequest with fewer than two stops', () => {
    expect(() =>
      PriceRequest.parse({ cityId: 'aziziyah', vertical: 'taxi', stops: [{ zoneId: 'x' }], at: new Date() }),
    ).toThrow();
  });

  it('rejects non-integer or non-positive ledger amounts', () => {
    const base = {
      id: 'e1', type: 'cash_collected', currency: 'IQD', fromAccount: 'customer:c1', toAccount: 'cash:d1',
      occurredAt: new Date(), recordedAt: new Date(),
    };
    expect(LedgerEvent.safeParse({ ...base, amount: 1000.5 }).success).toBe(false);
    expect(LedgerEvent.safeParse({ ...base, amount: -1000 }).success).toBe(false);
    expect(LedgerEvent.safeParse({ ...base, amount: 1000 }).success).toBe(true);
  });

  it('rejects malformed account ids', () => {
    expect(LedgerEvent.shape.fromAccount.safeParse('wallet:1').success).toBe(false);
    expect(LedgerEvent.shape.fromAccount.safeParse('platform').success).toBe(true);
  });
});

describe('city config — tiers and tier pairs', () => {
  it('accepts tiered zones, tier-pair fares, credit caps and dispatch timing', async () => {
    const { CityPricingConfig } = await import('./city-config.js');
    const cfg = CityPricingConfig.parse({
      cityId: 'x',
      name_ar: 'س',
      name_en: 'X',
      timezone: 'Asia/Baghdad',
      zones: [
        { id: 'a', name_ar: 'أ', name_en: 'A', tier: 'centre', extId: '1' },
        { id: 'b', name_ar: 'ب', name_en: 'B', tier: 'far' },
      ],
      verticals: [
        {
          vertical: 'food',
          zoneFares: [],
          tierFares: [{ from: 'centre', to: 'far', fare: 1500 }],
          defaultFare: 1000,
          components: [],
        },
      ],
      dispatch: {
        food: {
          policy: 'auto_assign',
          rebroadcastAfterSec: 60,
          rebroadcastCompensationIqd: 500,
          customerFreeCancelAfterSec: 180,
          passes: 3,
          arriveBeforeReadyMin: 2,
        },
      },
      creditCapsIqd: { bronze: 75000, silver: 150000, gold: 300000 },
    });
    expect(cfg.zones[0]?.tier).toBe('centre');
    expect(cfg.verticals[0]?.tierFares?.[0]?.fare).toBe(1500);
    expect(cfg.creditCapsIqd.gold).toBe(300000);
    expect(cfg.dispatch.food?.passes).toBe(3);
    expect(cfg.dispatch.food?.acceptTimeoutSec).toBe(15);
  });

  it('rejects an unknown tier or a negative credit cap', async () => {
    const { ZoneTier, CreditCaps } = await import('./city-config.js');
    expect(ZoneTier.safeParse('suburb').success).toBe(false);
    expect(CreditCaps.safeParse({ bronze: -1, silver: 1, gold: 1 }).success).toBe(false);
  });
});

describe('ledger types (domain §5 + amendments)', () => {
  it('includes the full money and points list and the kind enum', async () => {
    const { LedgerEventType, LedgerKind, kindOf } = await import('./ledger.js');
    for (const t of ['late_penalty_driver', 'errand_cost_actual', 'tip', 'parcel_fee', 'merchant_paid_by_courier', 'debt_settled', 'cash_rounding_credit', 'refund_cash_delivered', 'points_earned', 'organizer_bonus']) {
      expect(LedgerEventType.safeParse(t).success, t).toBe(true);
    }
    expect(LedgerKind.options).toEqual(['money', 'points']);
    expect(kindOf('points_pending')).toBe('points');
    expect(kindOf('cash_collected')).toBe('money');
  });

  it('accepts points accounts and the points pool', async () => {
    const { AccountId } = await import('./ledger.js');
    expect(AccountId.safeParse('points:p1').success).toBe(true);
    expect(AccountId.safeParse('points_pool').success).toBe(true);
    expect(AccountId.safeParse('merchant_cash:m1').success).toBe(true);
    expect(AccountId.safeParse('wallet:1').success).toBe(false);
  });
});

describe('Aziziyah zone seed', () => {
  it('has the 34 zones with unique ids and ext ids, tiers consistent with distance from the centre', async () => {
    const { AZIZIYAH_ZONES, AZIZIYAH_CENTRE } = await import('./aziziyah-zones.js');
    expect(AZIZIYAH_ZONES).toHaveLength(34);
    expect(new Set(AZIZIYAH_ZONES.map((z) => z.id)).size).toBe(34);
    expect(new Set(AZIZIYAH_ZONES.map((z) => z.extId)).size).toBe(34);
    const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const R = 6371;
      const dLat = ((b.lat - a.lat) * Math.PI) / 180;
      const dLng = ((b.lng - a.lng) * Math.PI) / 180;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    const bands: Record<string, [number, number]> = { centre: [0, 0.8], near: [0.6, 1.6], mid: [1.5, 4], far: [3.8, 6.5], edge: [6, 10] };
    for (const z of AZIZIYAH_ZONES) {
      const d = km(AZIZIYAH_CENTRE, z);
      const [lo, hi] = bands[z.tier]!;
      expect(d, `${z.name_ar} (${z.tier}) is ${d.toFixed(2)} km from the centre`).toBeGreaterThanOrEqual(lo);
      expect(d, `${z.name_ar} (${z.tier}) is ${d.toFixed(2)} km from the centre`).toBeLessThanOrEqual(hi);
    }
    const byTier = (t: string) => AZIZIYAH_ZONES.filter((z) => z.tier === t).length;
    expect([byTier('centre'), byTier('near'), byTier('mid'), byTier('far'), byTier('edge')]).toEqual([3, 7, 13, 8, 3]);
  });
});
