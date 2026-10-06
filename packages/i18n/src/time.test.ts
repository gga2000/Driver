import { describe, expect, it } from 'vitest';
import { cityDayDiff, cityParts, formatClock, formatCountdown, formatDay, formatDuration, formatMinuteCount, formatMinutes, formatMinutesRange, formatRange, formatHourPart, formatHourRange, formatWhen, dayPart, hourWindow, minuteNoun } from './time.js';
import { agreeMinutes, t } from './translate.js';

// 2026-10-01 is a Thursday. Baghdad is UTC+3: 19:30Z is 22:30 there.
const at = (iso: string) => new Date(iso);
const NOW = at('2026-10-01T09:00:00Z'); // Thursday 12:00 noon, Baghdad

describe('formatClock: one clock, Asia/Baghdad, ص/م', () => {
  it('reads Baghdad wall time whatever the device zone, with the part of day', () => {
    expect(formatClock(at('2026-10-01T19:30:00Z'))).toBe('10:30 م');
    expect(formatClock(at('2026-10-01T04:30:00Z'))).toBe('7:30 ص');
    expect(formatClock(at('2026-10-01T09:05:00Z'))).toBe('12:05 م');
    expect(formatClock(at('2026-09-30T21:00:00Z'))).toBe('12:00 ص');
  });
  it('speaks English as AM/PM, and drops the period only on request', () => {
    expect(formatClock(at('2026-10-01T19:30:00Z'), { locale: 'en' })).toBe('10:30 PM');
    expect(formatClock(at('2026-10-01T19:30:00Z'), { period: false })).toBe('10:30');
  });
  it('accepts epoch milliseconds', () => {
    expect(formatClock(Date.parse('2026-10-01T19:30:00Z'))).toBe('10:30 م');
  });
});

describe('city calendar', () => {
  it('cuts days at Baghdad midnight, not UTC', () => {
    // 22:00Z on the 1st is already 01:00 on Friday the 2nd in Baghdad.
    expect(cityParts(at('2026-10-01T22:00:00Z'))).toMatchObject({ day: 2, dow: 5, hour: 1 });
    expect(cityDayDiff(at('2026-10-01T22:00:00Z'), NOW)).toBe(1);
    expect(cityDayDiff(at('2026-09-30T20:59:00Z'), NOW)).toBe(-1);
  });
});

describe('formatWhen / formatDay: a date wherever the day is not today', () => {
  it('today is the clock alone', () => {
    expect(formatWhen(at('2026-10-01T19:30:00Z'), NOW)).toBe('10:30 م');
  });
  it('tomorrow and yesterday by name', () => {
    expect(formatWhen(at('2026-10-02T04:30:00Z'), NOW)).toBe('باچر 7:30 ص');
    expect(formatWhen(at('2026-09-30T20:15:00Z'), NOW)).toBe('أمس 11:15 م');
  });
  it('a weekday within the coming week, a date beyond it', () => {
    expect(formatWhen(at('2026-10-04T18:00:00Z'), NOW)).toBe('الأحد 9:00 م');
    expect(formatDay(at('2026-10-07T18:00:00Z'), NOW)).toBe('الأربعاء');
    expect(formatWhen(at('2026-10-09T18:00:00Z'), NOW)).toBe('9/10 9:00 م');
    expect(formatWhen(at('2026-09-20T18:00:00Z'), NOW)).toBe('20/9 9:00 م');
  });
  it('English', () => {
    expect(formatWhen(at('2026-10-02T04:30:00Z'), NOW, { locale: 'en' })).toBe('Tomorrow 7:30 AM');
  });
});

describe('formatDuration: durations never look like a clock', () => {
  it('minutes under an hour in the natural forms (J-D9, voice spec §5)', () => {
    expect(formatMinutes(1)).toBe('دقيقة');
    expect(formatMinutes(2)).toBe('دقيقتين');
    expect(formatMinutes(7)).toBe('7 دقايق');
    expect(formatMinutes(45)).toBe('45 دقيقة');
  });
  it('hours with Arabic number agreement, then minutes', () => {
    expect(formatMinutes(60)).toBe('ساعة');
    expect(formatMinutes(80)).toBe('ساعة و20 دقيقة');
    expect(formatMinutes(125)).toBe('ساعتين و5 دقايق');
    expect(formatMinutes(62)).toBe('ساعة ودقيقتين');
    expect(formatMinutes(3 * 60)).toBe('3 ساعات');
    expect(formatMinutes(19 * 60 + 32)).toBe('19 ساعة و32 دقيقة');
  });
  it('short form for tight chips', () => {
    expect(formatMinutes(80, { style: 'short' })).toBe('1 س 20 د');
    expect(formatMinutes(45, { style: 'short' })).toBe('45 د');
    expect(formatMinutes(120, { style: 'short' })).toBe('2 س');
  });
  it('rounds part minutes up and never goes negative', () => {
    expect(formatDuration(61_000)).toBe('دقيقتين');
    expect(formatDuration(-5)).toBe('0 دقيقة');
  });
  it('English', () => {
    expect(formatMinutes(80, { locale: 'en' })).toBe('1 hour 20 min');
  });
});

describe('formatCountdown', () => {
  it('m:ss, and h:mm:ss from an hour up', () => {
    expect(formatCountdown(116_000)).toBe('1:56');
    expect(formatCountdown(500)).toBe('0:01');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(formatCountdown(3_725_000)).toBe('1:02:05');
  });
});

describe('minutes, natural Iraqi forms (J-D9)', () => {
  it('one, two, few (3–10), many (11+ and 0)', () => {
    expect([1, 2, 3, 10, 11, 45, 0].map(minuteNoun)).toEqual(['one', 'two', 'few', 'few', 'many', 'many', 'many']);
    expect(formatMinuteCount(1)).toBe('دقيقة');
    expect(formatMinuteCount(2)).toBe('دقيقتين');
    expect(formatMinuteCount(3)).toBe('3 دقايق');
    expect(formatMinuteCount(10)).toBe('10 دقايق');
    expect(formatMinuteCount(11)).toBe('11 دقيقة');
    expect(formatMinuteCount(45)).toBe('45 دقيقة');
    expect(formatMinuteCount(5, { locale: 'en' })).toBe('5 min');
  });
  it('ranges agree with their high end, the low end first in reading order (right in Arabic)', () => {
    expect(formatMinutesRange(6, 9)).toBe('\u20676–9\u2069 دقايق');
    expect(formatMinutesRange(10, 15)).toBe('\u206710–15\u2069 دقيقة');
    expect(formatMinutesRange(6, 9, { locale: 'en' })).toBe('\u20666–9\u2069 min');
  });
  it('a number range is isolated in the reading direction, so Arabic shows 30 on the right («30–40», not «40–30»)', () => {
    // Right-to-left isolate (RLI … PDI): the dash between two numbers takes the RTL direction and the
    // low end is drawn first, from the right. A left-to-right isolate would draw it on the left.
    expect(formatRange(30, 40)).toBe('\u206730–40\u2069');
    expect(formatRange('4:30', 6)).toBe('\u20674:30–6\u2069');
    expect(formatRange(30, 40, 'en')).toBe('\u206630–40\u2069');
    // Ends with words (dates, hours with their part of day) get a spaced dash, same direction.
    expect(formatRange('27 أيلول', '3 تشرين الأول', 'ar-IQ', { spaced: true })).toBe('⁧27 أيلول – 3 تشرين الأول⁩');
    expect(formatRange('Sep 27', 'Oct 3', 'en', { spaced: true })).toBe('⁦Sep 27 – Oct 3⁩');
    // Checkout's delivery window; minute agreement still reads the range's high end.
    expect(t('checkout.eta', { range: formatRange(30, 40) })).toBe('يوصلك خلال \u206730–40\u2069 دقيقة');
    expect(t('checkout.eta', { range: formatRange(5, 8) })).toBe('يوصلك خلال \u20675–8\u2069 دقايق');
    expect(t('checkout.eta', { range: formatRange(30, 40, 'en') }, 'en')).toBe('Arrives in \u206630–40\u2069 min');
  });
  it('every Arabic "{p} دقيقة" agrees through t(), counts and ranges alike', () => {
    expect(t('track.running_late', { minutes: 1 })).toBe('متأخرين دقيقة');
    expect(t('track.running_late', { minutes: 2 })).toBe('متأخرين دقيقتين');
    expect(t('track.running_late', { minutes: 8 })).toBe('متأخرين 8 دقايق');
    expect(t('track.running_late', { minutes: 25 })).toBe('متأخرين 25 دقيقة');
    expect(t('track.running_late', { minutes: '⁦8⁩' })).toBe('متأخرين ⁦8⁩ دقايق');
    expect(t('list.minutes', { range: '⁦25–35⁩' })).toBe('⁦25–35⁩ دقيقة');
    expect(t('list.minutes', { range: '⁦5–10⁩' })).toBe('⁦5–10⁩ دقايق');
    expect(t('track.running_late', { minutes: 8 }, 'en')).toBe('Running 8 min late');
  });
  it('leaves what is not a count alone', () => {
    expect(agreeMinutes('بعد {minutes} دقيقة', { minutes: 'شوية' })).toBe('بعد {minutes} دقيقة');
    expect(agreeMinutes('أول 3 دقايق مجاناً', {})).toBe('أول 3 دقايق مجاناً');
    expect(agreeMinutes('{n} دقيقتين', { n: 4 })).toBe('{n} دقيقتين');
    expect(agreeMinutes('عندك {minutes} دقيقة', undefined)).toBe('عندك {minutes} دقيقة');
  });
});

describe('the part of day on hours and windows (R-06)', () => {
  // Baghdad is UTC+3: 13:00Z is 4 pm there.
  it('names the part of day the Iraqi way', () => {
    const parts = [2, 6, 12, 15, 18, 21].map((h) => dayPart(at(`2026-10-01T${String((h + 21) % 24).padStart(2, '0')}:00:00Z`)));
    expect(parts).toEqual(['late', 'morning', 'noon', 'afternoon', 'evening', 'night']);
  });
  it('an hour with its part, minutes only when not on the hour', () => {
    expect(formatHourPart(at('2026-10-01T13:00:00Z'))).toBe('4 العصر');
    expect(formatHourPart(at('2026-10-01T15:15:00Z'))).toBe('6:15 المسا');
    expect(formatHourPart(at('2026-10-01T05:30:00Z'))).toBe('8:30 الصبح');
    expect(formatHourPart(at('2026-10-01T18:00:00Z'))).toBe('9 بالليل');
    expect(formatHourPart(at('2026-10-01T13:00:00Z'), { locale: 'en' })).toBe('4 PM');
  });
  it('a window says the part once when both ends share it; its end is read a minute early', () => {
    expect(hourWindow(at('2026-10-01T17:00:00Z'), at('2026-10-01T19:00:00Z'))).toEqual({ from: '8', to: '10 بالليل' });
    expect(hourWindow(at('2026-10-01T13:00:00Z'), at('2026-10-01T15:00:00Z'))).toEqual({ from: '4', to: '6 العصر' });
    expect(hourWindow(at('2026-10-01T14:50:00Z'), at('2026-10-01T15:55:00Z'))).toEqual({ from: '5:50 العصر', to: '6:55 المسا' });
    expect(hourWindow(at('2026-10-01T15:00:00Z'), at('2026-10-01T21:00:00Z'))).toEqual({ from: '6 المسا', to: '12 بالليل' });
    expect(hourWindow(at('2026-10-01T13:00:00Z'), at('2026-10-01T15:00:00Z'), { locale: 'en' })).toEqual({ from: '4', to: '6 PM' });
  });
  it('a chip-sized range reads its first hour first (right-to-left isolate in Arabic)', () => {
    expect(formatHourRange(at('2026-10-01T13:00:00Z'), at('2026-10-01T15:00:00Z'))).toBe('\u20674–6\u2069 العصر');
    expect(formatHourRange(at('2026-10-01T13:00:00Z'), at('2026-10-01T15:00:00Z'), { locale: 'en' })).toBe('\u20664–6\u2069 PM');
    expect(formatHourRange(at('2026-10-01T14:50:00Z'), at('2026-10-01T15:55:00Z'))).toBe('5:50 العصر – 6:55 المسا');
  });
});
