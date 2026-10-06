/**
 * Kitchen time on screen (voice guide §5): 12-hour clock in Baghdad time ("7:30 م"), whole minutes
 * since/until ("من 4 دقيقة"), and a server-synced "now" so card timers don't drift with the tablet clock.
 * Pure (no React Native), tested.
 */

import { formatClock } from '@driver/i18n';

/** "7:30 م" in Baghdad time: the one clock in packages/i18n (ص/م, Western digits). */
export function clock12(at: Date | number): string {
  return formatClock(at);
}

/** Whole minutes from `from` to `to` (floored, never negative). */
export function minutesBetween(from: Date | number, to: Date | number): number {
  const a = typeof from === 'number' ? from : from.getTime();
  const b = typeof to === 'number' ? to : to.getTime();
  return Math.max(0, Math.floor((b - a) / 60_000));
}

/** Whole minutes left until `until` (rounded up, never negative). */
export function minutesLeft(until: Date | number, now: number): number {
  const u = typeof until === 'number' ? until : until.getTime();
  return Math.max(0, Math.ceil((u - now) / 60_000));
}

/** Seconds left until `until` (rounded up, never negative). */
export function secondsLeft(until: Date | number, now: number): number {
  const u = typeof until === 'number' ? until : until.getTime();
  return Math.max(0, Math.ceil((u - now) / 1000));
}

/**
 * The offset between the server's clock and this device's, from a response carrying the server's
 * `now` and the moment we received it. Add it to `Date.now()` for server time.
 */
export function clockOffset(serverNow: Date, receivedAt: number): number {
  return serverNow.getTime() - receivedAt;
}

/**
 * The board's clock: calls `onTick` with server time (device time + `offset`) at once and then every
 * `ms`, until the returned stop is called. Everything time-based on the board — the 90-s rings, "من
 * 4 د", the courier at the pass turning amber after 3 min (m2a) — is re-evaluated on these ticks, so
 * a card changes by itself while the board stays open, without a reload or a new read of the board.
 */
export function startServerClock(offset: number, ms: number, onTick: (serverNow: number) => void, deviceNow: () => number = Date.now): () => void {
  onTick(deviceNow() + offset);
  const id = setInterval(() => onTick(deviceNow() + offset), ms);
  return () => clearInterval(id);
}
