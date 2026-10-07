import { describe, expect, it } from 'vitest';
import { GARAGE_TAXI_RULES, garageLateMin, garagePickupPlan, returnCarEtaMin, shouldTellLate } from './garage-taxi-io.js';

const NOW = new Date('2026-10-08T05:00:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

describe('x2: the pickup time for a taxi to the الرجعة car', () => {
  it('departure − 10-minute buffer − the ride, rounded down to the 5-minute grid', () => {
    expect(garagePickupPlan(at(90), 13, NOW)).toEqual({ mode: 'later', pickupAt: at(65), arriveAt: at(78) });
    expect(garagePickupPlan(at(90), 10, NOW)).toEqual({ mode: 'later', pickupAt: at(70), arriveAt: at(80) });
    expect(GARAGE_TAXI_RULES.bufferMin).toBe(10);
  });

  it('closer than 20 minutes ahead: a ride now while it arrives by the car’s time, else too late', () => {
    // 9:35 − 10 − 15 = 9:10: only 10 minutes ahead → now (7 + 15 = 22 min → 9:22, before 9:35).
    expect(garagePickupPlan(at(35), 15, NOW)).toEqual({ mode: 'now', arriveAt: at(22) });
    expect(garagePickupPlan(at(22), 15, NOW)).toEqual({ mode: 'now', arriveAt: at(22) });
    expect(garagePickupPlan(at(21), 15, NOW)).toEqual({ mode: 'too_late' });
  });
});

describe('x3: how late, and when to tell', () => {
  it('whole minutes after the car’s time, never negative', () => {
    expect(garageLateMin(at(94), at(90))).toBe(4);
    expect(garageLateMin(new Date(at(90).getTime() + 30_000), at(90))).toBe(1);
    expect(garageLateMin(at(80), at(90))).toBe(0);
  });

  it('first from 3 minutes; again only when it grew by 5', () => {
    expect(shouldTellLate(2, null)).toBe(false);
    expect(shouldTellLate(3, null)).toBe(true);
    expect(shouldTellLate(7, 3)).toBe(false);
    expect(shouldTellLate(8, 3)).toBe(true);
    expect(shouldTellLate(1, 8)).toBe(false);
  });
});

describe('x4: the car’s minutes to the Aziziyah garage', () => {
  it('a live fix is routed; a stale or missing one falls back to departure + travel time; nothing before it left', () => {
    expect(returnCarEtaMin({ now: NOW, departedAt: at(-60), travelMin: 120, fixAt: at(-2), fixMin: 9 })).toBe(9);
    expect(returnCarEtaMin({ now: NOW, departedAt: at(-60), travelMin: 120, fixAt: at(-6), fixMin: 9 })).toBe(60);
    expect(returnCarEtaMin({ now: NOW, departedAt: at(-130), travelMin: 120, fixAt: null, fixMin: null })).toBe(0);
    expect(returnCarEtaMin({ now: NOW, departedAt: null, travelMin: 120, fixAt: null, fixMin: null })).toBeNull();
  });
});
