/**
 * The garage-board time (customer audit d-2): the pure half of `DepartureTime`. A departure (or a
 * food ETA, which reads like one) is shown as big tabular digits, the part of day, the day when it
 * is not today ("باچر"), and a countdown ("بعد 52 دقيقة"). Everything here is the city's one clock
 * (Asia/Baghdad, `@driver/i18n`), whatever the phone's time zone. Plain TypeScript, unit-tested.
 */
import { cityDayDiff, cityParts, formatDay, formatDuration, t, type Locale } from '@driver/i18n';

const MIN = 60_000;

export interface DepartureParts {
  /** "7:05": the digits the split-flap cells show (no part of day). */
  digits: string;
  /** "ص" / "م". */
  period: string;
  /** Null today; "باچر", "أمس", a weekday within the week, else "3/10". */
  day: string | null;
  /** "بعد 52 دقيقة" · "بعد ساعة و20 دقيقة" · "هسة"; null once the time has passed or it is not today/tomorrow. */
  countdown: string | null;
  /** Whole minutes until the time (negative once passed). */
  minutesLeft: number;
  past: boolean;
  /** One accessible sentence: "7:05 م، باچر، بعد 52 دقيقة". */
  label: string;
}

/** Whole minutes from `now` to `at`, rounded up while ahead ("بعد 1 دقيقة" never reads as nothing). */
export function departureMinutesLeft(at: number, now: number): number {
  const ms = at - now;
  return ms >= 0 ? Math.ceil(ms / MIN) : -Math.ceil(-ms / MIN);
}

/** The countdown line, or null when the moment has passed. Under a minute reads "هسة". */
export function departureCountdown(at: number, now: number, locale: Locale = 'ar-IQ'): string | null {
  const ms = at - now;
  if (ms < 0) return null;
  if (ms < MIN) return t('departure_time.now', undefined, locale);
  return t('departure_time.in', { duration: formatDuration(ms, { locale }) }, locale);
}

export function departureParts(at: Date | number, now: Date | number, opts: { locale?: Locale; countdown?: boolean } = {}): DepartureParts {
  const { locale = 'ar-IQ', countdown = true } = opts;
  const atMs = typeof at === 'number' ? at : at.getTime();
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const p = cityParts(atMs);
  const h = p.hour % 12 || 12;
  const digits = `${h}:${String(p.minute).padStart(2, '0')}`;
  const period = t(p.hour < 12 ? 'time.am' : 'time.pm', undefined, locale);
  const diff = cityDayDiff(atMs, nowMs);
  const day = diff === 0 ? null : formatDay(atMs, nowMs, { locale });
  // A countdown is only worth reading for today and tomorrow; further out the day says it.
  const cd = countdown && diff >= 0 && diff <= 1 ? departureCountdown(atMs, nowMs, locale) : null;
  const minutesLeft = departureMinutesLeft(atMs, nowMs);
  const label = [t('time.clock', { time: digits, period }, locale), day, cd].filter(Boolean).join('، ');
  return { digits, period, day, countdown: cd, minutesLeft, past: atMs < nowMs, label };
}

export interface FlapCell {
  /** Stable key per position (digits change in place; a "9:59" → "10:00" shift re-keys from the end). */
  key: string;
  char: string;
  /** ":" is drawn narrower and never flips. */
  colon: boolean;
}

/**
 * The split-flap cells of a time, keyed from the right end so "9:59" → "10:00" flips the minutes in
 * place and adds the new hour cell instead of shifting every cell.
 */
export function flapCells(digits: string): FlapCell[] {
  const chars = [...digits];
  return chars.map((char, i) => ({ key: `c${chars.length - 1 - i}`, char, colon: char === ':' }));
}

/** Which cells changed between two renders (by key), so only those flip. */
export function changedCells(prev: string, next: string): Set<string> {
  const before = new Map(flapCells(prev).map((c) => [c.key, c.char]));
  const out = new Set<string>();
  for (const c of flapCells(next)) if (before.get(c.key) !== c.char) out.add(c.key);
  return out;
}

/** Tick interval for the countdown: every 15 s near the time, every minute otherwise (battery). */
export function departureTickMs(at: number, now: number): number {
  return Math.abs(at - now) <= 60 * MIN ? 15_000 : MIN;
}
