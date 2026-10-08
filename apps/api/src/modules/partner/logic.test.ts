import { describe, expect, it } from 'vitest';
import type { QuoteComponent } from '@driver/contracts';
import { buildPay, demandHint, demandZones, forecastWindows, gateAllowsHeartbeat, gateErrorCode, kmBetween, merchantPrep, nearestLandmark, offerClimate, rideTake, startOfLocalDay, todayFromLines } from './logic.js';

const food = (deliveryFeeIqd: number, tipIqd = 0) => ({ type: 'food' as const, deliveryFeeIqd, tipIqd, totalIqd: 15_000 + deliveryFeeIqd + tipIqd });
const comp = (key: QuoteComponent['key'], amount: number): QuoteComponent => ({ key, amount, label_ar: key, label_en: key, driverShareRule: 'driver_full', visibility: 'shown' });

describe('buildPay', () => {
  it('delivery passes through in full, with night and rain split out and the compensation named', () => {
    const pay = buildPay({
      vertical: 'food',
      orders: [food(1_500, 500)],
      feeComponents: [comp('base', 1_000), comp('night', 250), comp('weather', 250), comp('service_fee', 500)],
      batchedSecond: false,
      batchShare: 0.7,
      compensationIqd: 500,
      take: null,
    });
    expect(pay.components).toEqual([
      { key: 'delivery', amountIqd: 1_000 },
      { key: 'night', amountIqd: 250 },
      { key: 'weather', amountIqd: 250 },
      { key: 'tip', amountIqd: 500 },
      { key: 'pickup_compensation', amountIqd: 500 },
    ]);
    expect(pay.totalIqd).toBe(2_500);
    expect(pay.takePct).toBeNull();
  });

  it('a batched second order pays 70 % of its fee as the batch bonus ("طلب ثاني على طريقك +700")', () => {
    const pay = buildPay({ vertical: 'food', orders: [food(1_000)], batchedSecond: true, batchShare: 0.7, compensationIqd: 0, take: null });
    expect(pay).toEqual({ totalIqd: 700, components: [{ key: 'batch_bonus', amountIqd: 700 }], takePct: null });
  });

  it('the offer promises exactly what the ledger posts (review 2026-10-04 #16)', () => {
    // Ledger postings: courier share = pct(fee, 0.7) (half rounds up): 1,250 → 875, 1,750 → 1,225.
    for (const [fee, posted] of [
      [1_250, 875],
      [1_750, 1_225],
      [1_000, 700],
    ] as const) {
      const pay = buildPay({ vertical: 'food', orders: [food(fee)], batchedSecond: true, batchShare: 0.7, compensationIqd: 0, take: null });
      expect(pay.totalIqd, `fee ${fee}`).toBe(posted);
    }
    // Ride take: ledger takeOf = max(min, pct(fare, rate)) + fixed, half rounds up.
    expect(rideTake(3_125, { rate: 0.12 })).toBe(375);
    expect(rideTake(1_125, { rate: 0.1, minIqd: 100 })).toBe(113);
  });

  it('rides pay the fare minus the open take (tuktuk 10 %, min 100)', () => {
    const ride = { type: 'ride' as const, deliveryFeeIqd: 0, tipIqd: 0, totalIqd: 3_000 };
    const pay = buildPay({ vertical: 'tuktuk', orders: [ride], batchedSecond: false, batchShare: 0.7, compensationIqd: 0, take: { rate: 0.1, minIqd: 100 } });
    expect(pay).toEqual({ totalIqd: 2_700, components: [{ key: 'fare', amountIqd: 2_700 }], takePct: 10 });
    expect(rideTake(500, { rate: 0.1, minIqd: 100 })).toBe(100);
    expect(rideTake(10_000, { rate: 0.08, fixedIqd: 1_000 })).toBe(1_800);
  });

  it('never lets a quote component eat more than the fee that was charged', () => {
    const pay = buildPay({ vertical: 'food', orders: [food(500)], feeComponents: [comp('night', 750)], batchedSecond: false, batchShare: 0.7, compensationIqd: 0, take: null });
    expect(pay.components).toEqual([{ key: 'delivery', amountIqd: 500 }]);
  });
});

describe('demandHint', () => {
  it('quiet when nothing waits', () => {
    expect(demandHint([], ['centre', 'centre'], 'centre')).toEqual({ level: 'quiet', zoneId: 'centre', waitingJobs: 0, driversNearby: 2 });
  });
  it('high in the zone with the most jobs per driver', () => {
    expect(demandHint(['centre', 'centre', 'centre', 'zakur'], ['centre', 'zakur', 'zakur'], 'zakur')).toEqual({ level: 'high', zoneId: 'centre', waitingJobs: 3, driversNearby: 1 });
  });
  it('normal when one job waits', () => {
    expect(demandHint(['hashimi'], [], null)).toMatchObject({ level: 'normal', zoneId: 'hashimi', waitingJobs: 1 });
  });
});

describe('today and prep', () => {
  it("starts the day at Baghdad midnight", () => {
    expect(startOfLocalDay(new Date('2026-10-03T20:30:00Z')).toISOString()).toBe('2026-10-02T21:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-10-03T22:30:00Z')).toISOString()).toBe('2026-10-03T21:00:00.000Z');
  });
  it('sums earnings net of commission and counts paid jobs', () => {
    const lines = [
      { type: 'delivery_fee', amountIqd: 1_000, orderId: 'o1' },
      { type: 'tip', amountIqd: 500, orderId: 'o1' },
      { type: 'fare', amountIqd: 3_000, tripId: 't2' },
      { type: 'commission_accrued', amountIqd: -300, tripId: 't2' },
      { type: 'driver_payout', amountIqd: -10_000 },
    ];
    expect(todayFromLines(lines)).toEqual({ earningsIqd: 4_200, jobs: 2 });
  });
  it('reads the kitchen state with minutes to ready', () => {
    const now = new Date('2026-10-03T12:00:00Z');
    expect(merchantPrep('مطعم خالد', { state: 'preparing', promisedReadyAt: new Date('2026-10-03T12:06:10Z'), readyAt: null, pickedUpAt: null }, now)).toEqual({ name: 'مطعم خالد', state: 'preparing', readyInMin: 7 });
    expect(merchantPrep('x', { state: 'ready', promisedReadyAt: null, readyAt: now, pickedUpAt: null }, now)).toMatchObject({ state: 'ready', readyInMin: 0 });
  });
  it('measures town distances in km', () => {
    expect(kmBetween({ lat: 32.905, lng: 45.06 }, { lat: 32.887, lng: 45.0765 })).toBeCloseTo(2.5, 0);
  });
});

describe('online gate', () => {
  const r = (code: 'checkin_required' | 'checkin_locked' | 'document_expired') => ({ code, message_ar: '…' });
  it('names the worst reason as the error code', () => {
    expect(gateErrorCode([r('checkin_required')])).toBe('online_checkin_required');
    expect(gateErrorCode([r('checkin_required'), r('document_expired')])).toBe('online_document_expired');
    expect(gateErrorCode([r('document_expired'), r('checkin_locked')])).toBe('checkin_locked');
  });
  it('lets only a missing check-in through as a heartbeat of someone already online', () => {
    const night = new Date('2026-10-02T22:00:00Z'); // 01:00 Baghdad
    const day = new Date('2026-10-03T10:00:00Z'); // 13:00 Baghdad
    expect(gateAllowsHeartbeat({ canGoOnline: true, reasons: [] }, false, day)).toBe(true);
    expect(gateAllowsHeartbeat({ canGoOnline: false, reasons: [r('checkin_required')] }, true, night)).toBe(true);
    expect(gateAllowsHeartbeat({ canGoOnline: false, reasons: [r('checkin_required')] }, true, day)).toBe(false);
    expect(gateAllowsHeartbeat({ canGoOnline: false, reasons: [r('checkin_required')] }, false, night)).toBe(false);
    expect(gateAllowsHeartbeat({ canGoOnline: false, reasons: [r('checkin_locked')] }, true, night)).toBe(false);
    expect(gateAllowsHeartbeat({ canGoOnline: false, reasons: [r('checkin_required'), r('document_expired')] }, true, night)).toBe(false);
  });
});

describe('demandZones (maps program d5)', () => {
  it('waiting now plus the usual pickups this hour, against the drivers there', () => {
    const zones = demandZones(['centre', 'centre', 'zakur'], ['centre', 'zakur', 'zakur', null], new Map([['centre', 1.25], ['fidaa', 2], ['hashimi', 0.2]]));
    expect(zones).toEqual([
      { zoneId: 'centre', waiting: 2, expected: 1.3, drivers: 1, level: 'hot' },
      { zoneId: 'fidaa', waiting: 0, expected: 2, drivers: 0, level: 'hot' },
      { zoneId: 'zakur', waiting: 1, expected: 0, drivers: 2, level: 'warm' },
    ]);
  });

  it('drivers alone make a calm zone; nothing at all is left out', () => {
    expect(demandZones([], ['zakur'], new Map())).toEqual([{ zoneId: 'zakur', waiting: 0, expected: 0, drivers: 1, level: 'calm' }]);
    expect(demandZones([], [], new Map([['zakur', 0.25]]))).toEqual([]);
  });

  it('forecast windows: this coming hour, one to four weeks back', () => {
    const now = new Date('2026-10-05T18:00:00Z');
    const w = forecastWindows(now, 4);
    expect(w).toHaveLength(4);
    expect(w[0]).toEqual({ from: new Date('2026-09-28T18:00:00Z'), to: new Date('2026-09-28T19:00:00Z') });
    expect(w[3]!.from).toEqual(new Date('2026-09-07T18:00:00Z'));
  });
});

describe('offer hints (partner redesign o7, o12)', () => {
  it('names the nearest town landmark within 600 m, and nothing farther', () => {
    // 50 m from the Grand Mosque gate, closer to it than to the garages around the centre.
    expect(nearestLandmark({ lat: 32.9049, lng: 45.0596 })).toBe('باب الجامع الكبير');
    expect(nearestLandmark({ lat: 32.98, lng: 45.2 })).toBeNull();
    expect(nearestLandmark(null)).toBeNull();
  });

  it('says AC on a hot-day car ride only', () => {
    const hot = new Date('2026-07-14T11:00:00Z'); // 14:00 in Baghdad, July
    const mild = new Date('2026-10-07T11:00:00Z');
    expect(offerClimate('taxi', 'car', hot)).toBe('ac');
    expect(offerClimate('taxi', 'car', mild)).toBeNull();
    expect(offerClimate('tuktuk', 'tuktuk', hot)).toBeNull();
    expect(offerClimate('food', 'car', hot)).toBeNull();
    expect(offerClimate('taxi', 'car', new Date('2026-01-14T07:00:00Z'))).toBe('heating');
  });
});
