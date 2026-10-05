import { describe, expect, it } from 'vitest';
import type { DeviceFix } from '@driver/contracts';
import type { Fix } from '@/lib/location';
import { FixBuffer, toDeviceFix, worthSending } from './position-report';

const T0 = Date.parse('2026-10-05T10:00:00Z');
const fix = (over: Partial<Fix> = {}): Fix => ({ lat: 32.905, lng: 45.06, at: T0, ...over });
const device = (atMs: number): DeviceFix => ({ pin: { lat: 32.905, lng: 45.06 }, at: new Date(atMs) });

describe('position report', () => {
  it('sends accurate fixes and mock-location ones (the API flags those), not noisy ones', () => {
    expect(worthSending(fix({ accuracyM: 12 }))).toBe(true);
    expect(worthSending(fix({ accuracyM: 90 }))).toBe(false);
    expect(worthSending(fix({ mocked: true, accuracyM: 5 }))).toBe(true);
    expect(worthSending(fix())).toBe(true);
  });

  it("uses the device's own time, speed and heading", () => {
    const d = toDeviceFix(fix({ speedKmh: 30, bearing: 90, accuracyM: 8, mocked: true }), null);
    expect(d).toEqual({ pin: { lat: 32.905, lng: 45.06 }, at: new Date(T0), speedKmh: 30, bearing: 90, accuracyM: 8, mocked: true });
  });

  it('computes speed and heading from the previous fix when the device has none', () => {
    const prev = fix();
    const next = fix({ lat: 32.905 + 100 / 111_320, at: T0 + 10_000 });
    const d = toDeviceFix(next, prev);
    expect(d.speedKmh).toBeCloseTo(36, 0);
    expect(d.bearing).toBeCloseTo(0, 0);
    expect(toDeviceFix(fix({ at: T0 + 10_000 }), prev).bearing).toBeUndefined();
  });

  it('the buffer keeps order, skips repeats, drops the oldest past its size', () => {
    const b = new FixBuffer(3);
    b.push(device(T0));
    b.push(device(T0));
    b.push(device(T0 - 1_000));
    expect(b.size).toBe(1);
    b.push(device(T0 + 1_000));
    b.push(device(T0 + 2_000));
    b.push(device(T0 + 3_000));
    expect(b.peek().map((f) => f.at.getTime())).toEqual([T0 + 1_000, T0 + 2_000, T0 + 3_000]);
    b.drop(2);
    expect(b.peek().map((f) => f.at.getTime())).toEqual([T0 + 3_000]);
  });
});
