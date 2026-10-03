/**
 * Kitchen time on screen (voice guide §5): 12-hour clock in Baghdad time ("7:30"), whole minutes
 * since/until ("من 4 د"), and a server-synced "now" so card timers don't drift with the tablet clock.
 * Pure (no React Native), tested.
 */

const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 all year, no DST

/** "7:30" (12-hour, no am/pm, Western digits) in Baghdad time. */
export function clock12(at: Date | number): string {
  const d = new Date((typeof at === 'number' ? at : at.getTime()) + BAGHDAD_OFFSET_MS);
  const h = d.getUTCHours() % 12 || 12;
  return `${h}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
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
