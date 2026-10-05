import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n-core';
import { addDismissed, adviceLine, dayCardKey, dayFacts, dayTitleKey, parseDismissed, showDayCard } from './logic';

const base = { merchantOrgId: 'org_1', localDate: '2026-10-05', due: true, reason: 'closed' as const, orders: 42, missed: 0, onTimeShare: 0.91, netIqd: 512_000 };

describe('end of day card (S-M6)', () => {
  it('shows when the server says it is due, until this device says "تمام" for that store and day', () => {
    expect(showDayCard(base, [])).toBe(true);
    expect(showDayCard({ ...base, due: false }, [])).toBe(false);
    expect(showDayCard(undefined, [])).toBe(false);
    const dismissed = addDismissed([], dayCardKey('org_1', '2026-10-05'));
    expect(showDayCard(base, dismissed)).toBe(false);
    expect(showDayCard({ ...base, localDate: '2026-10-06' }, dismissed)).toBe(true);
    expect(parseDismissed(JSON.stringify(dismissed))).toEqual(['org_1:2026-10-05']);
    expect(parseDismissed('not json')).toEqual([]);
    expect(Array.from({ length: 20 }, (_, i) => `k${i}`).reduce<string[]>((l, k) => addDismissed(l, k), [])).toHaveLength(14);
  });

  it('four facts, the net the one bold number (owner only); Iraqi plurals for طلب', () => {
    const facts = dayFacts(base);
    expect(facts.map((f) => f.key)).toEqual(['orders', 'missed', 'on_time', 'net']);
    expect(facts.filter((f) => f.hero).map((f) => f.key)).toEqual(['net']);
    expect(dayFacts({ ...base, netIqd: null }).map((f) => f.key)).toEqual(['orders', 'missed', 'on_time']);
    const say = (count: number) => {
      const v = dayFacts({ ...base, orders: count })[0]!.value as { key: Parameters<typeof translate>[0]; params: Record<string, number> };
      return translate(v.key, v.params, 'ar-IQ');
    };
    expect([1, 2, 3, 10, 11, 42].map(say)).toEqual(['طلب واحد', 'طلبين', '3 طلبات', '10 طلبات', '11 طلب', '42 طلب']);
    expect(dayFacts({ ...base, missed: 2 })[1]!.tone).toBe('danger');
    expect(dayFacts({ ...base, onTimeShare: null })[2]!.value).toEqual({ key: 'merchant.day.on_time_none', params: {} });
  });

  it('one advice line with its numbers; none on a day with nothing to judge', () => {
    expect(adviceLine({ kind: 'prep_late', minutes: 4, percent: null })).toEqual({ key: 'merchant.day.advice_prep_late', params: { minutes: 4 } });
    expect(adviceLine({ kind: 'prep_uneven', minutes: null, percent: 40 })).toEqual({ key: 'merchant.day.advice_prep_uneven', params: { percent: 40 } });
    expect(adviceLine(null)).toBeNull();
    expect(translate('merchant.day.advice_prep_late', { minutes: 4 }, 'ar-IQ')).toContain('4 دقايق');
  });

  it('"اليوم" at close, "البارحة" after midnight', () => {
    expect(dayTitleKey(base, '2026-10-05')).toBe('merchant.day.title_today');
    expect(dayTitleKey(base, '2026-10-06')).toBe('merchant.day.title_yesterday');
  });
});
