import { POSITION_RULES, type DeviceFix } from '@driver/contracts';
import type { Fix } from '@/lib/location';

/** Below this distance (m) between two fixes a computed heading is GPS noise. */
const BEARING_MIN_M = 5;

/**
 * Worth sending for the trail: accurate enough. A mock-location fix is still sent — the API refuses it
 * and asks support to look, which only works if it hears about it.
 */
export function worthSending(fix: Fix): boolean {
  return fix.accuracyM === undefined || fix.accuracyM <= POSITION_RULES.maxAccuracyM;
}

/** The fix as the API wants it: device speed and heading, else computed from the previous fix's own time. */
export function toDeviceFix(fix: Fix, prev: Fix | null): DeviceFix {
  const moved = prev ? metres(prev, fix) : 0;
  const seconds = prev ? (fix.at - prev.at) / 1000 : 0;
  const speedKmh = fix.speedKmh ?? (prev && seconds > 0 ? (moved / seconds) * 3.6 : undefined);
  const bearing = fix.bearing ?? (prev && moved > BEARING_MIN_M ? bearingOf(prev, fix) : undefined);
  return {
    pin: { lat: fix.lat, lng: fix.lng },
    at: new Date(fix.at),
    ...(speedKmh !== undefined ? { speedKmh } : {}),
    ...(bearing !== undefined ? { bearing } : {}),
    ...(fix.accuracyM !== undefined ? { accuracyM: fix.accuracyM } : {}),
    ...(fix.mocked ? { mocked: true } : {}),
  };
}

/**
 * Fixes waiting to be sent, oldest first. Survives a dropped connection (the next report sends the
 * backlog); past `max` the oldest go. A fix not newer than the newest one held or sent is skipped —
 * the phone often hands back the same cached fix twice.
 */
export class FixBuffer {
  private readonly items: DeviceFix[] = [];
  private newestAt = 0;

  constructor(private readonly max: number = POSITION_RULES.clientBufferMax) {}

  push(fix: DeviceFix): void {
    const at = fix.at.getTime();
    if (at <= this.newestAt) return;
    this.newestAt = at;
    this.items.push(fix);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  peek(n: number = POSITION_RULES.batchMax): DeviceFix[] {
    return this.items.slice(0, n);
  }

  drop(n: number): void {
    this.items.splice(0, n);
  }

  get size(): number {
    return this.items.length;
  }
}

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const k = 111_320;
  return Math.hypot((b.lng - a.lng) * k * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * k);
}

/** Degrees clockwise from north, 0–360. */
export function bearingOf(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
