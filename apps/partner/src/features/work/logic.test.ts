import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { capShare, clock, driversKey, inZone, jobAction, jobsKey, keepScreenOn, km, mapsUrl, OFFER_WARN_FROM_S, offerWarnTick, secondsLeft, taskProgress, todayKey, unreachablePhase, waitingKey, zoneCheckMoment, zoneName } from './logic';

const t = createT('ar-IQ');

describe('work logic', () => {
  it('zone names use Western digits and the short centre name', () => {
    expect(zoneName('street_30')).toBe('شارع 30');
    expect(zoneName('centre', 'ar-IQ', t)).toBe('المركز');
    expect(inZone('centre', t)).toBe('بالمركز');
    expect(t('partner.demand_high', { where: inZone('centre', t) })).toBe('الطلب عالي بالمركز');
    expect(zoneName('nowhere')).toBe('nowhere');
  });

  it('today pill agrees with the number like Iraqis say it', () => {
    expect(todayKey(0)).toBe('partner.today_zero');
    expect(t(todayKey(1), { amount: '1,000' })).toBe('1,000 دينار · طلب واحد');
    expect(t(todayKey(6), { amount: '12,500', n: 6 })).toBe('12,500 دينار · 6 طلبات');
    expect(t(todayKey(14), { amount: '30,000', n: 14 })).toBe('30,000 دينار · 14 طلب');
    expect(t(jobsKey(7), { n: 7 })).toBe('7 طلبات');
    expect(t(driversKey(1), { n: 1 })).toBe('سايق واحد قريب');
    expect(t(waitingKey(3), { n: 3 })).toBe('3 طلبات تنتظر');
  });

  it('cap share is clamped for the mini bar', () => {
    expect(capShare(45_000, 150_000)).toBeCloseTo(0.3);
    expect(capShare(200_000, 150_000)).toBe(1);
    expect(capShare(10, 0)).toBe(0);
  });

  it('the single job button walks pickup → dropoff', () => {
    expect(jobAction({ type: 'pickup', state: 'pending', collectIqd: 0 }, 'food')).toMatchObject({ kind: 'arrive', label: 'partner.action_arrived_pickup' });
    expect(jobAction({ type: 'pickup', state: 'arrived', collectIqd: 0 }, 'food')).toMatchObject({ kind: 'complete', label: 'partner.action_picked_up' });
    expect(jobAction({ type: 'dropoff', state: 'pending', collectIqd: 15_500 }, 'food')).toMatchObject({ kind: 'arrive', label: 'partner.action_arrived_dropoff', needsCash: false });
    expect(jobAction({ type: 'dropoff', state: 'arrived', collectIqd: 15_500 }, 'food')).toMatchObject({ kind: 'complete', label: 'partner.action_delivered', needsCash: true, wantsPhoto: true });
    expect(jobAction({ type: 'dropoff', state: 'arrived', collectIqd: 0 }, 'food').needsCash).toBe(false);
    expect(jobAction({ type: 'pickup', state: 'arrived', collectIqd: 0 }, 'tuktuk').label).toBe('partner.action_rider_in');
  });

  it('task progress counts the current stop among the run', () => {
    const stops = [
      { stopId: 'a', state: 'completed' },
      { stopId: 'b', state: 'pending' },
      { stopId: 'c', state: 'pending' },
    ] as never;
    expect(taskProgress({ stops, currentStopId: 'b' })).toEqual({ n: 2, total: 3 });
  });

  it('unreachable phases: dispatcher at 3:00, end allowed at 5:00', () => {
    const start = Date.parse('2026-10-03T12:00:00Z');
    const u = { startedAt: new Date(start), escalateAt: new Date(start + 180_000), failAllowedAt: new Date(start + 300_000) };
    expect(unreachablePhase(u, start + 60_000)).toEqual({ elapsedMs: 60_000, remainingMs: 240_000, dispatcherAlerted: false, canFail: false });
    expect(unreachablePhase(u, start + 200_000)).toMatchObject({ dispatcherAlerted: true, canFail: false });
    expect(unreachablePhase(u, start + 301_000)).toMatchObject({ canFail: true, remainingMs: 0 });
    expect(clock(240_000)).toEqual({ minutes: '4', seconds: '00' });
    expect(clock(61_500)).toEqual({ minutes: '1', seconds: '02' });
  });

  it('formats the ring, distances and the maps link', () => {
    expect(secondsLeft(new Date(10_400), 0)).toBe(11);
    expect(secondsLeft(new Date(0), 5_000)).toBe(0);
    expect(km(0.84)).toBe('0.8');
    expect(km(2)).toBe('2');
    expect(mapsUrl({ lat: 32.9, lng: 45.06 })).toContain('destination=32.900000,45.060000');
  });
});

describe('offer alert (P-01, signature S-1)', () => {
  it('warns every second in the last 5 seconds, never after it ended', () => {
    expect(OFFER_WARN_FROM_S).toBe(5);
    expect([15, 6, 5, 4, 3, 2, 1, 0].map(offerWarnTick)).toEqual([false, false, true, true, true, true, true, false]);
  });

  it('keeps the screen on while online or on a job', () => {
    expect(keepScreenOn(undefined)).toBe(false);
    expect(keepScreenOn({ online: false, activeTripId: null })).toBe(false);
    expect(keepScreenOn({ online: true, activeTripId: null })).toBe(true);
    expect(keepScreenOn({ online: false, activeTripId: 'trip_1' })).toBe(true);
  });
});

describe('zone check on the done screen (maps SP3)', () => {
  const Q = { checkId: 'zc_1' };
  const base = { counted: true, doneAt: 1000, readAt: 0, readFailed: false, check: null, answeredId: null };
  it('holds the count home until a read made after the job settles; a failed read lets go', () => {
    expect(zoneCheckMoment(base)).toEqual({ check: null, hold: true });
    expect(zoneCheckMoment({ ...base, readAt: 900, check: Q })).toEqual({ check: null, hold: true });
    expect(zoneCheckMoment({ ...base, readFailed: true })).toEqual({ check: null, hold: false });
    expect(zoneCheckMoment({ ...base, readAt: 1200 })).toEqual({ check: null, hold: false });
  });
  it('shows the question and holds for it until he answers; never offline or after a failed job', () => {
    expect(zoneCheckMoment({ ...base, readAt: 1200, check: Q })).toEqual({ check: Q, hold: true });
    expect(zoneCheckMoment({ ...base, readAt: 1200, check: Q, answeredId: 'zc_1' })).toEqual({ check: null, hold: false });
    expect(zoneCheckMoment({ ...base, counted: false, readAt: 1200, check: Q })).toEqual({ check: null, hold: false });
  });
});
