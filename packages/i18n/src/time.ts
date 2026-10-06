/**
 * One clock for every Driver app (audit S-06, C-14). Pure TypeScript, no React Native, so the apps,
 * the API's push/WhatsApp texts and the tests all format time the same way.
 *
 * - Always the city's clock: Asia/Baghdad is UTC+3 all year (no DST), so a phone set to another
 *   time zone still shows Aziziyah time. A fixed offset (not `Intl`) keeps Hermes builds honest.
 * - Clock times always carry the part of day: "10:30 م", "7:30 ص" (English "10:30 PM").
 * - A time that is not today says which day: "باچر 7:30 ص", "الخميس 9:00 م", "3/10 9:00 م".
 * - Durations read as durations, never as a clock: "20 دقيقة", "ساعة و20 دقيقة", short "1 س 20 د".
 * - Minutes take the natural Iraqi form (joy J-D9): "دقيقة", "دقيقتين", "5 دقايق", "15 دقيقة".
 * - Countdowns stay `m:ss` (voice spec §5).
 *
 * Words come from the locale files (`time.*`), never from this module.
 */
import { pluralKey } from './plural.js';
import { DEFAULT_LOCALE, t, type Locale, type MessageKey } from './translate.js';

export { agreeMinutes, minuteNoun, type MinuteForm } from './translate.js';

/** The city's time zone and its fixed offset from UTC. */
export const CITY_TIME_ZONE = 'Asia/Baghdad';
export const CITY_UTC_OFFSET_MIN = 180;

const MIN = 60_000;
const DAY = 86_400_000;

export interface CityParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0 = Sunday … 6 = Saturday */
  dow: number;
  hour: number;
  minute: number;
}

function ms(at: Date | number): number {
  return typeof at === 'number' ? at : at.getTime();
}

/** Wall-clock parts of an instant on the city's clock. */
export function cityParts(at: Date | number, offsetMin = CITY_UTC_OFFSET_MIN): CityParts {
  const d = new Date(ms(at) + offsetMin * MIN);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dow: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** Calendar days from `now` to `at` on the city's clock (0 today, 1 tomorrow, −1 yesterday). */
export function cityDayDiff(at: Date | number, now: Date | number, offsetMin = CITY_UTC_OFFSET_MIN): number {
  const day = (x: number) => Math.floor((x + offsetMin * MIN) / DAY);
  return day(ms(at)) - day(ms(now));
}

export interface ClockOptions {
  locale?: Locale;
  /** Add ص/م (AM/PM). Default true; switch off only where the part of day is shown next to it. */
  period?: boolean;
  offsetMin?: number;
}

/** "10:30 م" — 12-hour city clock with the part of day (Western digits). */
export function formatClock(at: Date | number, opts: ClockOptions = {}): string {
  const { locale = 'ar-IQ', period = true, offsetMin = CITY_UTC_OFFSET_MIN } = opts;
  const p = cityParts(at, offsetMin);
  const h = p.hour % 12 || 12;
  const time = `${h}:${String(p.minute).padStart(2, '0')}`;
  if (!period) return time;
  return t('time.clock', { time, period: t(p.hour < 12 ? 'time.am' : 'time.pm', undefined, locale) }, locale);
}

/** "اليوم" · "باچر" · "أمس" · a weekday within the coming week ("الخميس") · else "3/10". */
export function formatDay(at: Date | number, now: Date | number, opts: { locale?: Locale; offsetMin?: number } = {}): string {
  const { locale = 'ar-IQ', offsetMin = CITY_UTC_OFFSET_MIN } = opts;
  const diff = cityDayDiff(at, now, offsetMin);
  if (diff === 0) return t('time.today', undefined, locale);
  if (diff === 1) return t('time.tomorrow', undefined, locale);
  if (diff === -1) return t('time.yesterday', undefined, locale);
  const p = cityParts(at, offsetMin);
  if (diff > 1 && diff < 7) return t(`time.dow_${p.dow}` as MessageKey, undefined, locale);
  return t('time.date', { day: p.day, month: p.month }, locale);
}

/**
 * A moment people act on: the clock alone when it is today ("10:30 م"), with the day otherwise
 * ("باچر 7:30 ص", "الخميس 9:00 م", "أمس 11:15 م", "3/10 9:00 م").
 */
export function formatWhen(at: Date | number, now: Date | number, opts: ClockOptions = {}): string {
  const { locale = 'ar-IQ', offsetMin = CITY_UTC_OFFSET_MIN } = opts;
  const time = formatClock(at, opts);
  if (cityDayDiff(at, now, offsetMin) === 0) return time;
  return t('time.day_at', { day: formatDay(at, now, { locale, offsetMin }), time }, locale);
}

export interface DurationOptions {
  locale?: Locale;
  /** `long` (default): "1 ساعة و20 دقيقة". `short`, for tight chips: "1 س 20 د". */
  style?: 'long' | 'short';
}

/**
 * A length of time in whole minutes (rounded up, so "دقيقة" never reads as nothing):
 * "45 دقيقة", "ساعة", "ساعتين و5 دقايق", "19 ساعة و32 دقيقة"; short "45 د", "1 س 20 د".
 */
export function formatDuration(durationMs: number, opts: DurationOptions = {}): string {
  const { locale = 'ar-IQ', style = 'long' } = opts;
  const total = Math.max(0, Math.ceil(durationMs / MIN));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (style === 'short') {
    if (hours === 0) return t('time.minutes_short', { n: minutes }, locale);
    if (minutes === 0) return t('time.hours_short', { n: hours }, locale);
    return t('time.hm_short', { hours, minutes }, locale);
  }
  const m = t('time.minutes', { n: minutes }, locale);
  if (hours === 0) return m;
  const h = t(pluralKey('time.hours', hours), { n: hours }, locale);
  if (minutes === 0) return h;
  return t('time.hm', { hours: h, minutes: m }, locale);
}

/** Minutes as a duration: `formatMinutes(80)` → "1 ساعة و20 دقيقة". */
export function formatMinutes(minutes: number, opts: DurationOptions = {}): string {
  return formatDuration(minutes * MIN, opts);
}

/** A count of minutes in its natural form (J-D9): "دقيقة", "دقيقتين", "7 دقايق", "15 دقيقة" ("7 min"). */
export function formatMinuteCount(n: number, opts: { locale?: Locale } = {}): string {
  return t('time.minutes', { n }, opts.locale);
}

const LRI = '\u2066';
const RLI = '\u2067';
const PDI = '\u2069';

/**
 * A span of two numbers ("30–40") that reads low to high in the locale's direction. In Arabic the
 * low end sits on the right, where the eye starts: isolated right-to-left, so the dash keeps 30 on
 * the right whatever surrounds it — «يوصلك خلال 30–40 دقيقة», never «40–30» (a left-to-right
 * isolate puts 30 on the left, which an Arabic reader reads as 40 first). English is the mirror.
 * The ends may be clock strings ("4:30"). Ends that carry words ("27 أيلول", "6 المغرب") take
 * `{ spaced: true }`: «27 أيلول – 3 تشرين الأول», still the first one on the right.
 */
export function formatRange(low: number | string, high: number | string, locale: Locale = DEFAULT_LOCALE, opts: { spaced?: boolean } = {}): string {
  return `${locale.startsWith('ar') ? RLI : LRI}${low}${opts.spaced ? ' – ' : '–'}${high}${PDI}`;
}

/** A minutes range read by its high end, the low end first in reading order: "30–40 دقيقة", "6–9 دقايق". */
export function formatMinutesRange(low: number, high: number, opts: { locale?: Locale } = {}): string {
  return t('time.minutes_range', { range: formatRange(low, high, opts.locale) }, opts.locale);
}

/** The Iraqi parts of the day (R-06): what people say after an hour so 8 can't be morning or night. */
export type DayPart = 'late' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

/** 0–3 بالليل · 4–11 الصبح · 12–14 الظهر · 15–17 العصر · 18–19 المسا · 20–23 بالليل (city clock). */
export function dayPart(at: Date | number, offsetMin = CITY_UTC_OFFSET_MIN): DayPart {
  const h = cityParts(at, offsetMin).hour;
  if (h < 4) return 'late';
  if (h < 12) return 'morning';
  if (h < 15) return 'noon';
  if (h < 18) return 'afternoon';
  if (h < 20) return 'evening';
  return 'night';
}

/** "4" or "4:30" on the 12-hour city clock, no part of day. */
function hourDigits(at: Date | number, offsetMin: number): string {
  const p = cityParts(at, offsetMin);
  const h = p.hour % 12 || 12;
  return p.minute === 0 ? String(h) : `${h}:${String(p.minute).padStart(2, '0')}`;
}

function partWord(part: DayPart, locale: Locale): string {
  return t(`time.part_${part}` as MessageKey, undefined, locale);
}

/** "4 العصر", "6:15 المسا", "9 بالليل" ("4 PM"): an hour people can't misread as the other half of the day. */
export function formatHourPart(at: Date | number, opts: { locale?: Locale; offsetMin?: number } = {}): string {
  const { locale = 'ar-IQ', offsetMin = CITY_UTC_OFFSET_MIN } = opts;
  return `${hourDigits(at, offsetMin)} ${partWord(dayPart(at, offsetMin), locale)}`;
}

/**
 * A window's two ends for "بين {from} و {to}" or "{from}–{to}": the part of day once when both ends
 * share it ("8" … "10 بالليل", "4" … "6 العصر"), on each end otherwise ("5:50 العصر" … "6:55 المسا").
 * The end is the moment the window closes, so its part is read a minute before ("4–6 العصر", not المسا).
 */
export function hourWindow(start: Date | number, end: Date | number, opts: { locale?: Locale; offsetMin?: number } = {}): { from: string; to: string } {
  const { locale = 'ar-IQ', offsetMin = CITY_UTC_OFFSET_MIN } = opts;
  const startPart = dayPart(start, offsetMin);
  const endMs = typeof end === 'number' ? end : end.getTime();
  const endPart = dayPart(endMs - MIN, offsetMin);
  const to = `${hourDigits(endMs, offsetMin)} ${partWord(endPart, locale)}`;
  const from = hourDigits(start, offsetMin);
  return { from: startPart === endPart ? from : `${from} ${partWord(startPart, locale)}`, to };
}

/** A chip-sized window: "4–6 العصر" (4 first in reading order, `formatRange`), else "5:50 العصر – 6:55 المسا". */
export function formatHourRange(start: Date | number, end: Date | number, opts: { locale?: Locale; offsetMin?: number } = {}): string {
  const { locale = DEFAULT_LOCALE, offsetMin = CITY_UTC_OFFSET_MIN } = opts;
  const w = hourWindow(start, end, opts);
  if (w.from.includes(' ')) return `${w.from} – ${w.to}`;
  const endMs = typeof end === 'number' ? end : end.getTime();
  const toDigits = hourDigits(endMs, offsetMin);
  return `${formatRange(w.from, toDigits, locale)}${w.to.slice(toDigits.length)}`;
}

/** Countdown `m:ss` (voice spec: `{minutes}:{seconds}`); `h:mm:ss` from one hour up. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
