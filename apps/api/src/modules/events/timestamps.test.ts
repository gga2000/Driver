import { describe, expect, it } from 'vitest';
import { assessSkew, backoffMs, isDeviceRecorded, isLateReplay } from './timestamps.js';

const server = new Date('2026-10-03T12:00:00Z');
const at = (ms: number) => new Date(server.getTime() + ms);
const S = 1000;
const MIN = 60 * S;
const DAY = 86_400_000;

describe('skew policy (plan Step 3, edge-case §10)', () => {
  it.each([
    ['in sync', 0, false, null],
    ['device 60 s ahead (tolerated)', 60 * S, false, null],
    ['device 61 s ahead', 61 * S, true, 'device_ahead'],
    ['device 3 min ahead', 3 * MIN, true, 'device_ahead'],
    ['device 4 min behind (tolerated)', -4 * MIN, false, null],
    ['device 4 min 1 s behind', -(4 * MIN + S), true, 'device_skew'],
    ['offline replay 2 h old', -2 * 60 * MIN, true, 'device_skew'],
    ['exactly 7 days old', -7 * DAY, true, 'device_skew'],
    ['older than 7 days', -(7 * DAY + S), true, 'device_stale'],
  ] as const)('%s', (_label, deltaMs, flagged, reason) => {
    const r = assessSkew(at(deltaMs), server);
    expect(r.skewMs).toBe(deltaMs);
    expect(r.flagged).toBe(flagged);
    expect(r.flagReason).toBe(reason);
  });
});

describe('late replay rule', () => {
  const detachedAt = at(-5 * MIN);

  it('nothing is late while the order is attached', () => {
    expect(isLateReplay({ occurredAt: at(-10 * MIN), deviceUptimeMs: 1 }, server, null)).toBe(false);
  });

  it('a device-recorded event received after the detach is late, whenever it claims to have happened', () => {
    expect(isLateReplay({ occurredAt: at(-8 * MIN), deviceUptimeMs: 123 }, server, detachedAt)).toBe(true);
    expect(isLateReplay({ occurredAt: at(-2 * MIN), deviceUptimeMs: 123 }, server, detachedAt)).toBe(true);
  });

  it('an event claiming to predate the detach but received after it is late even without uptime', () => {
    expect(isLateReplay({ occurredAt: at(-6 * MIN) }, server, detachedAt)).toBe(true);
  });

  it('server events at or after the detach (the detach itself, follow-ups) are not late', () => {
    expect(isLateReplay({ occurredAt: detachedAt }, server, detachedAt)).toBe(false);
    expect(isLateReplay({ occurredAt: server }, server, detachedAt)).toBe(false);
  });

  it('received at the detach instant is not after it', () => {
    expect(isLateReplay({ occurredAt: at(-10 * MIN), deviceUptimeMs: 1 }, detachedAt, detachedAt)).toBe(false);
  });
});

describe('helpers', () => {
  it('backoff doubles: 2 s, 4 s … 1024 s', () => {
    expect([1, 2, 3, 10].map(backoffMs)).toEqual([2000, 4000, 8000, 1_024_000]);
  });

  it('device-recorded = carries uptime, or arrived more than a minute after it happened', () => {
    expect(isDeviceRecorded({ occurredAt: server, recordedAt: server, deviceUptimeMs: 5 })).toBe(true);
    expect(isDeviceRecorded({ occurredAt: at(-61 * S), recordedAt: server })).toBe(true);
    expect(isDeviceRecorded({ occurredAt: at(-59 * S), recordedAt: server })).toBe(false);
  });
});
