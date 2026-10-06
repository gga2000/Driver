import { formatRange } from '@driver/i18n';

/** Baghdad is UTC+3 all year (no DST); quiet days turn at Baghdad midnight. */
const BAGHDAD_MS = 3 * 3_600_000;

/** Today in Baghdad as YYYY-MM-DD (the date the API compares quiet days with). */
export function baghdadToday(now: Date = new Date()): string {
  return new Date(now.getTime() + BAGHDAD_MS).toISOString().slice(0, 10);
}

/** "13/11", or "6/6 – 18/6" for a stretch (Western digits, day first, as the Console writes dates; the first day on the right, `formatRange`). */
export function quietRange(startsOn: string, endsOn: string): string {
  const d = (s: string) => `${Number(s.slice(8, 10))}/${Number(s.slice(5, 7))}`;
  return startsOn === endsOn ? d(startsOn) : formatRange(d(startsOn), d(endsOn), 'ar-IQ', { spaced: true });
}

/** The UTC instant of "HH:MM" Baghdad time on a YYYY-MM-DD day (for the city clock, `formatClock`). */
export function baghdadInstant(day: string, hhmm: string): Date {
  return new Date(Date.parse(`${day}T${hhmm}:00Z`) - BAGHDAD_MS);
}

/** The switches a season keeps on, in the order the card names them (quiet days keep none). */
export function seasonSwitchesOn(s: { celebrations: boolean; sounds: boolean; promos: boolean; accent: boolean; homeCard: boolean }): Array<'celebrations' | 'sounds' | 'promos' | 'accent' | 'card'> {
  const on: Array<'celebrations' | 'sounds' | 'promos' | 'accent' | 'card'> = [];
  if (s.celebrations) on.push('celebrations');
  if (s.sounds) on.push('sounds');
  if (s.promos) on.push('promos');
  if (s.accent) on.push('accent');
  if (s.homeCard) on.push('card');
  return on;
}
