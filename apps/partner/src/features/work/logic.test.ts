import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { capShare, clock, driversKey, inZone, jobAction, jobsKey, km, mapsUrl, secondsLeft, taskProgress, todayKey, unreachablePhase, waitingKey, zoneName } from './logic';

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
    expect(t(todayKey(1), { amount: '1,000' })).toBe('1,000 · طلب واحد');
    expect(t(todayKey(6), { amount: '12,500', n: 6 })).toBe('12,500 · 6 طلبات');
    expect(t(todayKey(14), { amount: '30,000', n: 14 })).toBe('30,000 · 14 طلب');
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
