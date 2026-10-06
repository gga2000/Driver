import { t, type Locale, type MessageKey, type Params } from './translate.js';

export { asCount, countParamOf, DEFAULT_LOCALE, hasKey, interpolate, locales, resolvePlural, t, type Locale, type MessageKey, type Params } from './translate.js';
export { PLURAL_FALLBACK, pluralCategory, pluralFamilies, pluralKey, pluralKeyIn, tp, type PluralBase, type PluralCategory } from './plural.js';
export {
  CITY_TIME_ZONE,
  CITY_UTC_OFFSET_MIN,
  cityDayDiff,
  cityParts,
  dayPart,
  formatClock,
  formatCountdown,
  formatDay,
  agreeMinutes,
  formatDuration,
  formatHourPart,
  formatHourRange,
  formatMinuteCount,
  formatMinutes,
  formatMinutesRange,
  minuteNoun,
  formatWhen,
  hourWindow,
  type CityParts,
  type ClockOptions,
  type DayPart,
  type DurationOptions,
  type MinuteForm,
} from './time.js';
export { BANNED_TERMS, voiceProblems, type VoiceProblem } from './voice.js';

export const RTL_LOCALES: ReadonlySet<string> = new Set(['ar-IQ', 'ar']);

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.has(locale) || locale.startsWith('ar-');
}

/** Bind a locale once per app session. */
export function createT(locale: Locale) {
  return (key: MessageKey, params?: Params) => t(key, params, locale);
}
