import { describe, expect, it } from 'vitest';
import { attentionOrder, cashLoudness, dashState, firstName, metresBetween, minutesSince, shiftCheckDay, workHint } from './logic';

const cash = (owed: number, near = false, over = false) => ({ heldIqd: owed, owedIqd: owed, capIqd: 75_000, remainingIqd: Math.max(0, 75_000 - owed), nearCap: near, overCap: over });

describe('home logic', () => {
  it('state top: working, waiting, and no internet wins over both', () => {
    expect(dashState(true, true)).toBe('working');
    expect(dashState(false, true)).toBe('waiting');
    expect(dashState(true, false)).toBe('cut');
    expect(dashState(false, false)).toBe('cut');
  });

  it('cash line: nothing when he owes nothing (b10), quiet, saffron near the cap, blocked over it', () => {
    expect(cashLoudness(cash(0))).toBe('none');
    expect(cashLoudness(cash(12_500))).toBe('quiet');
    expect(cashLoudness(cash(60_000, true))).toBe('near');
    expect(cashLoudness(cash(80_000, true, true))).toBe('blocked');
  });

  it('attention: the job first, then the gate and cash, the climate question last', () => {
    expect(attentionOrder(['climate', 'invite', 'job'])).toEqual(['job', 'invite', 'climate']);
    expect(attentionOrder(['lost', 'gate'])).toEqual(['gate', 'lost']);
    // a3: a paper in its last 14 days waits behind cash and lost items, before an invite.
    expect(attentionOrder(['invite', 'papers', 'cash'])).toEqual(['cash', 'papers', 'invite']);
    expect(attentionOrder([])).toEqual([]);
  });

  it('work hint: the busy zone with its distance; none when quiet or unknown', () => {
    const self = { lat: 32.905, lng: 45.06 }; // the centre
    const h = workHint({ level: 'high', zoneId: 'street_30', waitingJobs: 4, driversNearby: 1 }, self);
    expect(h?.zoneId).toBe('street_30');
    expect(h?.km).toBeGreaterThan(0.4);
    expect(h?.km).toBeLessThan(0.8);
    expect(h?.here).toBe(false);
    expect(workHint({ level: 'high', zoneId: 'centre', waitingJobs: 2, driversNearby: 0 }, self)?.here).toBe(true);
    expect(workHint({ level: 'quiet', zoneId: 'street_30', waitingJobs: 0, driversNearby: 3 }, self)).toBeNull();
    expect(workHint({ level: 'high', zoneId: 'nowhere', waitingJobs: 2, driversNearby: 0 }, self)).toBeNull();
    expect(workHint({ level: 'normal', zoneId: 'street_30', waitingJobs: 1, driversNearby: 2 }, null)?.km).toBeNull();
  });

  it('distance is right to a few metres', () => {
    // One thousandth of a degree of latitude is about 111 m.
    expect(metresBetween({ lat: 32.9, lng: 45 }, { lat: 32.901, lng: 45 })).toBeGreaterThan(110);
    expect(metresBetween({ lat: 32.9, lng: 45 }, { lat: 32.901, lng: 45 })).toBeLessThan(112);
  });

  it('minutes online, first name, and the Baghdad calendar day', () => {
    const now = Date.parse('2026-10-07T18:30:00Z');
    expect(minutesSince(new Date(now - 12 * 60_000 - 5_000), now)).toBe(12);
    expect(minutesSince(new Date(now + 60_000), now)).toBe(0);
    expect(minutesSince(null, now)).toBeNull();
    expect(firstName('  حيدر علي ')).toBe('حيدر');
    expect(firstName('')).toBeNull();
    expect(firstName(null)).toBeNull();
    // 22:30 UTC is already the next day in Baghdad (UTC+3).
    expect(shiftCheckDay(new Date('2026-10-07T22:30:00Z'))).toBe('2026-10-08');
    expect(shiftCheckDay(new Date('2026-10-07T20:30:00Z'))).toBe('2026-10-07');
  });
});
