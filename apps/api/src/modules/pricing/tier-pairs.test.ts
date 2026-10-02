import { describe, expect, it } from 'vitest';
import type { PriceRequest, PriceRequestInput } from '@driver/contracts';
import { AZIZIYAH_ZONES, PriceRequest as PriceRequestSchema } from '@driver/contracts';
import { aziziyah } from '../config/cities/aziziyah.js';
import { PricingEngine, tierFare, tierIndex, zoneFare } from './engine.js';

const engine = new PricingEngine(() => 'q_test');
const NOON = new Date('2026-10-02T09:00:00Z'); // 12:00 Asia/Baghdad

function req(partial: Partial<PriceRequestInput> & { stops: PriceRequestInput['stops'] }): PriceRequest {
  return PriceRequestSchema.parse({ cityId: 'aziziyah', vertical: 'food', at: NOON, ...partial });
}
const stops = (...zones: string[]) => zones.map((zoneId, i) => ({ zoneId, type: i === 0 ? ('pickup' as const) : ('dropoff' as const) }));
const base = (q: ReturnType<PricingEngine['quote']>) => q.components.filter((c) => c.key === 'base').reduce((a, c) => a + c.amount, 0);
const food = aziziyah.verticals.find((v) => v.vertical === 'food')!;
const tiers = tierIndex(aziziyah);

describe('Aziziyah config — 34 seed zones', () => {
  it('registers every seed zone with its tier and ext id', () => {
    expect(aziziyah.zones.filter((z) => z.extId)).toHaveLength(34);
    for (const seed of AZIZIYAH_ZONES) {
      const z = aziziyah.zones.find((x) => x.id === seed.id);
      expect(z, seed.id).toBeDefined();
      expect(z?.tier).toBe(seed.tier);
      expect(z?.extId).toBe(seed.extId);
      expect(z?.name_ar).toBe(seed.name_ar);
    }
  });

  it('credit caps per trust tier (money §4)', () => {
    expect(aziziyah.creditCapsIqd).toEqual({ bronze: 75000, silver: 150000, gold: 300000 });
  });

  it('dispatch timing per plan Step 5', () => {
    const taxi = aziziyah.dispatch.taxi!;
    expect(taxi.waves).toEqual([
      { size: 3, radiusKm: 1.5, seconds: 15 },
      { size: 5, radiusKm: 3, seconds: 15 },
      { size: 'all', seconds: 30 },
    ]);
    expect(taxi.rebroadcastAfterSec).toBe(60);
    expect(taxi.rebroadcastCompensationIqd).toBe(500);
    expect(taxi.customerFreeCancelAfterSec).toBe(180);
    expect(taxi.rankWeights).toEqual({ distance: 40, tier: 30, load: 20, vehicleFit: 10 });
    const food = aziziyah.dispatch.food!;
    expect(food.policy).toBe('auto_assign');
    expect(food.acceptTimeoutSec).toBe(20);
    expect(food.passes).toBe(3);
    expect(food.arriveBeforeReadyMin).toBe(2);
    expect(food.maxBatch).toBe(2);
    expect(food.batchMaxDetourMin).toBe(4);
    expect(food.batchMaxHotWaitMin).toBe(10);
    expect(aziziyah.dispatch.intercity!.minSeatsByTMinus30).toBe(3);
    const khat = aziziyah.dispatch.khat!;
    expect([khat.substituteWaves, khat.substituteWaveSize, khat.substituteWaveMin]).toEqual([2, 3, 5]);
  });
});

describe('tier-pair delivery fares (dispatch & pricing §1)', () => {
  it('centre ↔ near = 500 and near ↔ near = 500', () => {
    expect(tierFare(food, 'centre', 'near')).toBe(500);
    expect(tierFare(food, 'near', 'centre')).toBe(500);
    expect(tierFare(food, 'near', 'near')).toBe(500);
    expect(tierFare(food, 'centre', 'centre')).toBe(500);
  });

  it('near ↔ mid = 1,000 (and centre ↔ mid)', () => {
    expect(tierFare(food, 'near', 'mid')).toBe(1000);
    expect(tierFare(food, 'mid', 'near')).toBe(1000);
    expect(tierFare(food, 'centre', 'mid')).toBe(1000);
    expect(tierFare(food, 'mid', 'mid')).toBe(1000);
  });

  it('anything ↔ far = 1,500', () => {
    expect(tierFare(food, 'centre', 'far')).toBe(1500);
    expect(tierFare(food, 'near', 'far')).toBe(1500);
    expect(tierFare(food, 'mid', 'far')).toBe(1500);
    expect(tierFare(food, 'far', 'far')).toBe(1500);
  });

  it('edge = 2,000 from anywhere, including far', () => {
    expect(tierFare(food, 'centre', 'edge')).toBe(2000);
    expect(tierFare(food, 'far', 'edge')).toBe(2000);
    expect(tierFare(food, 'edge', 'edge')).toBe(2000);
  });

  it('centre → الخماس (far) prices the delivery at 1,500 through the engine', () => {
    const q = engine.quote(req({ stops: stops('centre', 'khamas') }), aziziyah);
    expect(base(q)).toBe(1500);
    expect(q.components.find((c) => c.key === 'base')?.label_ar).toBe('أجرة التوصيل');
  });

  it('centre → بزل حلاته (edge) prices at 2,000', () => {
    const q = engine.quote(req({ stops: stops('centre', 'bazl_hallata') }), aziziyah);
    expect(base(q)).toBe(2000);
  });

  it('exact zone pairs win over tier pairs', () => {
    const custom = { ...food, zoneFares: [{ from: 'centre', to: 'khamas', fare: 1250 }] };
    expect(zoneFare(custom, 'centre', 'khamas', tiers)).toBe(1250);
    expect(zoneFare(custom, 'khamas', 'centre', tiers)).toBe(1250);
    expect(zoneFare(custom, 'centre', 'deir', tiers)).toBe(1500);
  });

  it('unknown zones fall through to the default fare', () => {
    expect(zoneFare(food, 'centre', 'nowhere', tiers)).toBe(food.defaultFare);
  });

  it('a 15,000 order across town: fee 1,000 + service fee 500 (money §2 worked example)', () => {
    const q = engine.quote(req({ stops: stops('centre', 'zakur') }), aziziyah);
    expect(base(q)).toBe(1000);
    expect(q.components.find((c) => c.key === 'service_fee')?.amount).toBe(500);
    expect(q.total).toBe(1500);
  });

  it('door is the delivery default; street handover −250 is opt-in; door pickup +500 for errands', () => {
    const door = engine.quote(req({ stops: stops('centre', 'hashimi') }), aziziyah);
    expect(door.components.find((c) => c.key === 'door_pickup')?.amount).toBe(0);
    expect(door.total).toBe(1000);
    const street = engine.quote(req({ stops: stops('centre', 'hashimi'), options: { streetHandover: true } }), aziziyah);
    expect(street.components.find((c) => c.key === 'street_pickup')?.amount).toBe(-250);
    expect(street.total).toBe(750);
    const errand = engine.quote(req({ vertical: 'errand', stops: stops('centre', 'hashimi'), options: { doorPickup: true } }), aziziyah);
    expect(errand.components.find((c) => c.key === 'door_pickup')?.amount).toBe(500);
  });
});

describe('Aziziyah city rides use tier pairs too', () => {
  it('tuktuk in the centre is cheaper than a far trip and every total is on the 250 grid', () => {
    const near = engine.quote(req({ vertical: 'tuktuk', stops: stops('centre', 'street_30') }), aziziyah);
    const far = engine.quote(req({ vertical: 'tuktuk', stops: stops('centre', 'khamas') }), aziziyah);
    expect(near.total).toBeLessThan(far.total);
    for (const q of [near, far]) expect(q.total % 250).toBe(0);
  });

  it('intercity centre → Baghdad is priced from the explicit zone table', () => {
    const q = engine.quote(req({ vertical: 'intercity', stops: stops('centre', 'baghdad') }), aziziyah);
    expect(q.total).toBe(15000);
    const q2 = engine.quote(req({ vertical: 'intercity', stops: stops('khamas', 'baghdad') }), aziziyah);
    expect(q2.total).toBe(15000);
  });
});
