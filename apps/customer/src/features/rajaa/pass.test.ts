import { describe, expect, it } from 'vitest';
import { lateStageAt, lateStages, leaveHome, passPhase } from './pass';

const now = new Date('2026-10-06T12:00:00Z');
const at = (min: number) => new Date(now.getTime() + min * 60_000);
const pass = (state: Parameters<typeof passPhase>[0]['state'], depState: Parameters<typeof passPhase>[0]['departure']['state'], inMin: number) =>
  passPhase({ state, departure: { state: depState, departAt: at(inMin) } }, now);

describe('passPhase', () => {
  it('counts down before boarding opens (T−30)', () => {
    expect(pass('booked', 'scheduled', 45)).toBe('before');
  });
  it('is boarding from T−30 or when the driver opened boarding', () => {
    expect(pass('booked', 'scheduled', 20)).toBe('boarding');
    expect(pass('booked', 'boarding', 50)).toBe('boarding');
  });
  it('is on the road once checked in or once the car left', () => {
    expect(pass('checked_in', 'boarding', 5)).toBe('onboard');
    expect(pass('booked', 'departed', -5)).toBe('onboard');
  });
  it('keeps a stub after the trip and closes the rest', () => {
    expect(pass('completed', 'arrived', -90)).toBe('kept');
    expect(pass('cancelled_by_rider', 'scheduled', 40)).toBe('closed');
    expect(pass('no_show', 'departed', -10)).toBe('closed');
  });
});

describe('leave home (t4)', () => {
  const garage = { lat: 32.9113, lng: 45.0611 };
  const depart = new Date('2026-10-07T04:00:00Z'); // 7:00 Baghdad
  it('at the garage 10 minutes early, the ride from the distance', () => {
    // ~2 km straight → 2.7 km of streets → 7 min at 25 km/h + 5 to find a tuktuk.
    const home = { lat: garage.lat + 0.018, lng: garage.lng };
    const r = leaveHome(home, garage, depart);
    expect(r.rideMin).toBe(12);
    expect(r.arriveBy.toISOString()).toBe('2026-10-07T03:50:00.000Z');
    expect(r.leaveAt.toISOString()).toBe('2026-10-07T03:38:00.000Z');
  });
  it('never less than 5 minutes', () => {
    expect(leaveHome(garage, garage, depart).rideMin).toBe(5);
  });
});

describe('late stages (t6)', () => {
  const depart = new Date('2026-10-07T04:00:00Z');
  it('wallet: grace, the meter to the cap, then gone', () => {
    const s = lateStages(depart, true, 5 * 60_000, 20);
    expect(s.map((x) => x.stage)).toEqual(['grace', 'meter', 'gone']);
    expect(s[1]!.from.toISOString()).toBe('2026-10-07T04:05:00.000Z');
    expect(s[2]!.from.toISOString()).toBe('2026-10-07T04:20:00.000Z');
    expect(lateStageAt(s, new Date('2026-10-07T03:59:00Z'))).toBeNull();
    expect(lateStageAt(s, new Date('2026-10-07T04:07:00Z'))).toBe('meter');
    expect(lateStageAt(s, new Date('2026-10-07T05:00:00Z'))).toBe('gone');
  });
  it('cash: grace, then the driver may leave', () => {
    expect(lateStages(depart, false, 3 * 60_000, 20).map((x) => x.stage)).toEqual(['grace', 'gone']);
  });
});
