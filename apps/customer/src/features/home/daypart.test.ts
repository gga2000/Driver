import { describe, expect, it } from 'vitest';
import { bandTitleKey, bandWords, baghdadClock, daypart, greetingKey, kitchenRank, orderForDaypart } from './daypart';

/** A Baghdad wall-clock time on Tuesday 6 Oct 2026 (UTC+3) as an instant. */
const at = (hhmm: string, day = '2026-10-06') => new Date(`${day}T${hhmm}:00+03:00`);

describe('daypart (h1, D-02)', () => {
  it.each([
    ['03:59', 'late'],
    ['04:00', 'dawn'],
    ['10:59', 'dawn'],
    ['11:00', 'lunch'],
    ['15:59', 'lunch'],
    ['16:00', 'asr'],
    ['18:59', 'asr'],
    ['19:00', 'dinner'],
    ['22:59', 'dinner'],
    ['23:00', 'late'],
    ['00:30', 'late'],
  ])('%s Baghdad is %s', (hhmm, key) => {
    expect(daypart(at(hhmm)).key).toBe(key);
  });

  it('reads Baghdad time whatever the phone zone (UTC instant)', () => {
    expect(baghdadClock(new Date('2026-10-06T21:30:00Z'))).toEqual({ hour: 0, minute: 30, dow: 3 });
  });

  it('knows Friday by the Baghdad date (Thursday 21:30 UTC is Friday 00:30)', () => {
    expect(daypart(new Date('2026-10-08T21:30:00Z')).friday).toBe(true);
    expect(daypart(at('13:00', '2026-10-09')).friday).toBe(true);
    expect(daypart(at('13:00', '2026-10-08')).friday).toBe(false);
  });
});

describe('greeting and band', () => {
  const friLunch = daypart(at('13:00', '2026-10-09'));
  it('greets by daypart, with the name when we have it', () => {
    expect(greetingKey(daypart(at('07:00')), { quiet: false, named: true })).toBe('home.daypart.dawn');
    expect(greetingKey(daypart(at('07:00')), { quiet: false, named: false })).toBe('home.daypart.dawn_anon');
    expect(greetingKey(daypart(at('01:00')), { quiet: false, named: true })).toBe('home.daypart.late');
    expect(greetingKey(friLunch, { quiet: false, named: true })).toBe('home.daypart.friday_lunch');
  });

  it('has no playful line on a quiet day', () => {
    expect(greetingKey(daypart(at('01:00')), { quiet: true, named: true })).toBe('home.daypart.quiet_late');
    expect(greetingKey(daypart(at('17:00')), { quiet: true, named: false })).toBe('home.daypart.quiet_evening_anon');
    expect(greetingKey(daypart(at('20:00')), { quiet: true, named: true })).toBe('home.daypart.quiet_evening');
    expect(greetingKey(friLunch, { quiet: true, named: true })).toBe('home.daypart.quiet_lunch');
    expect(bandTitleKey(friLunch, true)).toBe('home.band.lunch');
    expect(bandTitleKey(friLunch, false)).toBe('home.band.friday_lunch');
  });

  it('asks the server for dishes that suit the hour', () => {
    expect(bandWords(daypart(at('07:00')))[0]).toBe('باچة');
    expect(bandWords(friLunch)).toContain('مشكّل');
    expect(bandWords(daypart(at('20:00')))).toContain('كباب');
  });
});

describe('ordering by the hour', () => {
  const terms = ['كباب', 'تكة', 'كبد', 'مشويات', 'دجاج', 'تمن ومرق', 'شاورما', 'باجه'];
  it('puts breakfast first at dawn (folded: باجه = باچة)', () => {
    expect(orderForDaypart(terms, 'dawn')[0]).toBe('باجه');
  });
  it('puts rice first at lunch and keeps the rest in their order', () => {
    expect(orderForDaypart(terms, 'lunch')).toEqual(['تمن ومرق', 'مشويات', 'دجاج', 'كباب', 'تكة', 'كبد', 'شاورما', 'باجه']);
  });
  it('ranks kitchens by the tags that suit the hour', () => {
    expect(kitchenRank(['breakfast', 'pacha'], 'dawn')).toBe(0);
    expect(kitchenRank(['grill', 'kebab'], 'dawn')).toBe(3);
    expect(kitchenRank(['shawarma', 'falafel'], 'late')).toBe(0);
  });
});
