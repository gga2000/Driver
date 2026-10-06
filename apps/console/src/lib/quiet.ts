/** Baghdad is UTC+3 all year (no DST); quiet days turn at Baghdad midnight. */
const BAGHDAD_MS = 3 * 3_600_000;

/** Today in Baghdad as YYYY-MM-DD (the date the API compares quiet days with). */
export function baghdadToday(now: Date = new Date()): string {
  return new Date(now.getTime() + BAGHDAD_MS).toISOString().slice(0, 10);
}

/** "13/11", or "6/6 – 18/6" for a stretch (Western digits, day first, as the Console writes dates). */
export function quietRange(startsOn: string, endsOn: string): string {
  const d = (s: string) => `${Number(s.slice(8, 10))}/${Number(s.slice(5, 7))}`;
  return startsOn === endsOn ? d(startsOn) : `${d(startsOn)} – ${d(endsOn)}`;
}
