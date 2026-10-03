import { describe, expect, it } from 'vitest';
import { cashTone, docAlertKey, dowOf, isPlateValid, localDateKey, niceCeiling, normalizePlate, seatsKey, sortDrivers, weekBars } from './logic';

describe('fleet week chart', () => {
  it('reads dates on the Baghdad calendar', () => {
    expect(localDateKey(new Date('2026-10-03T20:59:00Z'))).toBe('2026-10-03');
    expect(localDateKey(new Date('2026-10-03T21:00:00Z'))).toBe('2026-10-04');
    expect(dowOf('2026-09-27')).toBe(0);
    expect(dowOf('2026-10-03')).toBe(6);
  });

  it('scales bars against the best day and marks today and the days to come', () => {
    const days = [
      { date: '2026-09-27', earningsIqd: 40_000, jobs: 12 },
      { date: '2026-09-28', earningsIqd: 80_000, jobs: 20 },
      { date: '2026-09-29', earningsIqd: 0, jobs: 0 },
      { date: '2026-09-30', earningsIqd: 20_000, jobs: 5 },
      { date: '2026-10-01', earningsIqd: 0, jobs: 0 },
      { date: '2026-10-02', earningsIqd: 0, jobs: 0 },
      { date: '2026-10-03', earningsIqd: 0, jobs: 0 },
    ];
    const bars = weekBars(days, '2026-09-30');
    expect(bars.map((b) => b.share)).toEqual([0.5, 1, 0, 0.25, 0, 0, 0]);
    expect(bars.map((b) => b.state)).toEqual(['past', 'past', 'past', 'today', 'future', 'future', 'future']);
    expect(bars.map((b) => b.dow)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekBars(days.map((d) => ({ ...d, earningsIqd: 0 })), '2026-09-30').every((b) => b.share === 0)).toBe(true);
  });

  it('rounds the scale label up to a readable number', () => {
    expect(niceCeiling(0)).toBe(0);
    expect(niceCeiling(73_500)).toBe(100_000);
    expect(niceCeiling(41_000)).toBe(50_000);
    expect(niceCeiling(20_000)).toBe(20_000);
    expect(niceCeiling(23_000)).toBe(25_000);
  });
});

describe('vehicles', () => {
  it('normalises and validates plates', () => {
    expect(normalizePlate('  واسط   ١٢٣٤٥ ')).toBe('واسط 12345');
    expect(isPlateValid('واسط 12345')).toBe(true);
    expect(isPlateValid('واسط')).toBe(false);
    expect(isPlateValid('1')).toBe(false);
  });

  it('counts seats in Iraqi agreement and hides them for a bike', () => {
    expect(seatsKey(0)).toBeNull();
    expect(seatsKey(1)).toBe('partner.fleet_seats_one');
    expect(seatsKey(4)).toBe('partner.fleet_seats_few');
    expect(seatsKey(11)).toBe('partner.fleet_seats_many');
  });
});

describe('drivers', () => {
  it('puts over-cap and working drivers first, then by today’s earnings', () => {
    const rows = [
      { driverId: 'a', name: 'أحمد', state: 'offline' as const, todayEarningsIqd: 30_000 },
      { driverId: 'b', name: 'باقر', state: 'online' as const, todayEarningsIqd: 5_000 },
      { driverId: 'c', name: 'جعفر', state: 'on_job' as const, todayEarningsIqd: 1_000 },
      { driverId: 'd', name: 'داود', state: 'online' as const, todayEarningsIqd: 9_000 },
      { driverId: 'e', name: 'علي', state: 'over_cap' as const, todayEarningsIqd: 0 },
    ];
    expect(sortDrivers(rows).map((r) => r.driverId)).toEqual(['e', 'c', 'd', 'b', 'a']);
  });

  it('colours the cash bar by how close he is to the cap', () => {
    expect(cashTone(10_000, 75_000, false)).toBe('success');
    expect(cashTone(60_000, 75_000, false)).toBe('warning');
    expect(cashTone(80_000, 75_000, false)).toBe('danger');
    expect(cashTone(0, 75_000, true)).toBe('danger');
  });

  it('words document alerts by days left', () => {
    expect(docAlertKey('expiring', 12)).toBe('partner.fleet_doc_days');
    expect(docAlertKey('expiring', 0)).toBe('partner.fleet_doc_today');
    expect(docAlertKey('expired', -3)).toBe('partner.fleet_doc_expired');
  });
});
