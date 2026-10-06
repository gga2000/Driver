import { describe, expect, it } from 'vitest';
import { changedCells, departureCountdown, departureMinutesLeft, departureParts, departureTickMs, flapCells } from './departure';

// 2026-10-05 is a Monday. Baghdad is UTC+3: 16:30Z is 7:30 م there.
const at = (iso: string) => new Date(iso).getTime();
const NOW = at('2026-10-05T16:00:00Z'); // 7:00 م in Aziziyah

describe('departureParts', () => {
  it('shows the city clock, the part of day and a countdown for today', () => {
    const p = departureParts(at('2026-10-05T16:52:00Z'), NOW);
    expect(p.digits).toBe('7:52');
    expect(p.period).toBe('م');
    expect(p.day).toBeNull();
    expect(p.countdown).toBe('بعد 52 دقيقة');
    expect(p.minutesLeft).toBe(52);
    expect(p.past).toBe(false);
    expect(p.label).toBe('7:52 م، بعد 52 دقيقة');
  });

  it('says "باچر" for tomorrow and counts hours as a duration', () => {
    const p = departureParts(at('2026-10-06T03:30:00Z'), NOW); // 6:30 ص tomorrow
    expect(p.digits).toBe('6:30');
    expect(p.period).toBe('ص');
    expect(p.day).toBe('باچر');
    expect(p.countdown).toBe('بعد 11 ساعة و30 دقيقة');
  });

  it('names the weekday further out and drops the countdown', () => {
    const p = departureParts(at('2026-10-08T06:00:00Z'), NOW); // Thursday 9:00 ص
    expect(p.day).toBe('الخميس');
    expect(p.countdown).toBeNull();
  });

  it('reads "هسة" in the last minute and nothing once passed', () => {
    expect(departureParts(NOW + 30_000, NOW).countdown).toBe('هسة');
    const late = departureParts(NOW - 4 * 60_000, NOW);
    expect(late.countdown).toBeNull();
    expect(late.past).toBe(true);
    expect(late.minutesLeft).toBe(-4);
  });

  it('uses the Baghdad clock whatever the phone says (midnight and noon read 12)', () => {
    expect(departureParts(at('2026-10-05T21:05:00Z'), NOW).digits).toBe('12:05'); // 12:05 ص the next day
    expect(departureParts(at('2026-10-05T21:05:00Z'), NOW).period).toBe('ص');
    expect(departureParts(at('2026-10-05T09:00:00Z'), at('2026-10-05T05:00:00Z')).digits).toBe('12:00');
  });

  it('can switch the countdown off, and speaks English', () => {
    expect(departureParts(at('2026-10-05T16:52:00Z'), NOW, { countdown: false }).countdown).toBeNull();
    const en = departureParts(at('2026-10-05T16:52:00Z'), NOW, { locale: 'en' });
    expect(en.period).toBe('PM');
    expect(en.countdown).toBe('In 52 min');
  });
});

describe('the boarding pass: the day always, the part of day in words (R-06)', () => {
  it('says «اليوم» and «المسا»', () => {
    const p = departureParts(at('2026-10-05T15:15:00Z'), at('2026-10-05T14:37:00Z'), { alwaysDay: true, partOfDay: true });
    expect(p.digits).toBe('6:15');
    expect(p.period).toBe('المسا');
    expect(p.day).toBe('اليوم');
    expect(p.countdown).toBe('بعد 38 دقيقة');
    expect(p.label).toBe('6:15 المسا، اليوم، بعد 38 دقيقة');
  });
  it('tomorrow still reads «باچر», and English keeps AM/PM', () => {
    const p = departureParts(at('2026-10-06T03:30:00Z'), NOW, { alwaysDay: true, partOfDay: true });
    expect([p.day, p.period]).toEqual(['باچر', 'الصبح']);
    expect(departureParts(at('2026-10-05T16:52:00Z'), NOW, { alwaysDay: true, partOfDay: true, locale: 'en' }).period).toBe('PM');
  });
});

describe('countdown helpers', () => {
  it('rounds minutes up while ahead', () => {
    expect(departureMinutesLeft(NOW + 61_000, NOW)).toBe(2);
    expect(departureMinutesLeft(NOW - 61_000, NOW)).toBe(-2);
    expect(departureCountdown(NOW + 90 * 60_000, NOW)).toBe('بعد ساعة و30 دقيقة');
  });

  it('ticks every 15 s within the hour, every minute further out', () => {
    expect(departureTickMs(NOW + 30 * 60_000, NOW)).toBe(15_000);
    expect(departureTickMs(NOW + 3 * 3600_000, NOW)).toBe(60_000);
  });
});

describe('split-flap cells', () => {
  it('keys cells from the right end so the minutes flip in place', () => {
    expect(flapCells('7:05').map((c) => `${c.key}=${c.char}`)).toEqual(['c3=7', 'c2=:', 'c1=0', 'c0=5']);
    expect(flapCells('10:00')[0]).toEqual({ key: 'c4', char: '1', colon: false });
    expect(flapCells('7:05')[1]!.colon).toBe(true);
  });

  it('flips only the cells that changed', () => {
    expect([...changedCells('7:05', '7:06')]).toEqual(['c0']);
    expect([...changedCells('7:59', '8:00')].sort()).toEqual(['c0', 'c1', 'c3']);
    expect([...changedCells('9:59', '10:00')].sort()).toEqual(['c0', 'c1', 'c3', 'c4']);
    expect(changedCells('7:05', '7:05').size).toBe(0);
  });
});
