import { describe, expect, it } from 'vitest';
import { parseBackgroundState, planBackgroundWake, wantsBackgroundTracking } from './background-plan';
import { HEARTBEAT_MS } from './presence-timing';

const online = { online: true, onJob: false, vehicleClass: 'bike' as const };
const onJob = { online: true, onJob: true, vehicleClass: null };

describe('background location plan', () => {
  it('runs the OS service only while online or on a job', () => {
    expect(wantsBackgroundTracking(online)).toBe(true);
    expect(wantsBackgroundTracking({ online: false, onJob: true, vehicleClass: null })).toBe(true);
    expect(wantsBackgroundTracking({ online: false, onJob: false, vehicleClass: null })).toBe(false);
  });

  it('stays quiet while the app is on screen: its own hooks send, nothing goes twice', () => {
    expect(planBackgroundWake({ state: onJob, appActive: true, lastBeatAt: 0, now: 10 * HEARTBEAT_MS })).toEqual({ heartbeat: false, reportPositions: false });
  });

  it('in the background: a heartbeat every 30 s while online, positions on every wake on a job', () => {
    const now = 10 * HEARTBEAT_MS;
    expect(planBackgroundWake({ state: online, appActive: false, lastBeatAt: 0, now })).toEqual({ heartbeat: true, reportPositions: false });
    expect(planBackgroundWake({ state: online, appActive: false, lastBeatAt: now - 5_000, now })).toEqual({ heartbeat: false, reportPositions: false });
    expect(planBackgroundWake({ state: onJob, appActive: false, lastBeatAt: now - 5_000, now })).toEqual({ heartbeat: false, reportPositions: true });
  });

  it('sends nothing without a known shift (a wake after sign-out or a bad stored state)', () => {
    expect(planBackgroundWake({ state: null, appActive: false, lastBeatAt: 0, now: 1e9 })).toEqual({ heartbeat: false, reportPositions: false });
    expect(parseBackgroundState(null)).toBeNull();
    expect(parseBackgroundState('not json')).toBeNull();
    expect(parseBackgroundState('{"online":"yes"}')).toBeNull();
    expect(parseBackgroundState(JSON.stringify(online))).toEqual(online);
  });
});
