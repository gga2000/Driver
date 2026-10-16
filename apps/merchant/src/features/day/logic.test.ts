import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '@driver/contracts';
import { translate } from '@/lib/i18n-core';
import { clock12 } from '@/lib/time';
import { visibleText } from '@/lib/order-no';
import { ACTIVITY_COLLAPSED, activityRows, addDismissed, adviceLine, dayCardKey, dayFacts, dayTitleKey, orderWhoLine, parseDismissed, showDayCard, visibleActivity } from './logic';

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

describe('«منو سوّى شنو» (owner only)', () => {
  const ar = (key: Parameters<typeof translate>[0], params?: Record<string, string | number>) => translate(key, params, 'ar-IQ');
  // 9:41 Baghdad = 06:41Z
  const at = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00+03:00`);
  const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({ at: at('09:41'), kind: 'accept', orderId: 'ord_1', orderNumber: '6347', dishName: null, until: null, who: { personId: 'p_mun', name: 'منتظر', you: false }, reason: null, ...over });

  it('one row per action: who · what · when, Western digits', () => {
    const rows = activityRows(
      [
        entry({ kind: 'reject', reason: null }),
        entry({ kind: 'reject', reason: 'too_busy', at: at('21:05') }),
        entry({ kind: 'reject', reason: 'other: الغاز خلص' }),
        entry({ kind: 'sold_out', orderId: null, orderNumber: null, dishName: 'كص', until: at('23:59'), who: { personId: 'p_ali', name: 'علي', you: false } }),
        entry({ kind: 'back_on', orderId: null, orderNumber: null, dishName: null, who: { personId: 'p_ali', name: 'علي', you: false } }),
        entry({ kind: 'ready', who: { personId: 'p_owner', name: 'خالد', you: true } }),
        entry({ kind: 'auto_reject', who: null, reason: 'merchant_timeout' }),
        entry({ kind: 'hand_over', who: { personId: 'p_gone', name: null, you: false } }),
      ],
      ar,
    );
    expect(rows.map((r) => visibleText(r.line))).toEqual([
      `منتظر · رفض #6347 · ${clock12(at('09:41'))}`,
      `منتظر · رفض #6347 (زحمة) · ${clock12(at('21:05'))}`,
      `منتظر · رفض #6347 (الغاز خلص) · ${clock12(at('09:41'))}`,
      `علي · خلص اليوم: كص · ${clock12(at('09:41'))}`,
      `علي · رجّع: صنف · ${clock12(at('09:41'))}`,
      `انت · جهّز #6347 · ${clock12(at('09:41'))}`,
      `تلقائي · فات #6347، محد رد · ${clock12(at('09:41'))}`,
      `موظف سابق · سلّم #6347 للدليفري · ${clock12(at('09:41'))}`,
    ]);
    expect(rows.map((r) => r.auto)).toEqual([false, false, false, false, false, false, true, false]);
    expect(rows.every((r) => !/[٠-٩]/.test(r.line))).toBe(true);
    expect(clock12(at('09:41'))).toContain('9:41');
  });

  it('collapses after 8 rows until «شوف الكل»', () => {
    const many = Array.from({ length: 11 }, (_, i) => i);
    expect(visibleActivity(many, false)).toEqual({ rows: many.slice(0, ACTIVITY_COLLAPSED), hidden: 3 });
    expect(visibleActivity(many, true)).toEqual({ rows: many, hidden: 0 });
    expect(visibleActivity(many.slice(0, 8), false).hidden).toBe(0);
    expect(ar('merchant.activity.show_all', { count: 11 })).toBe('شوف الكل (11)');
  });

  it('the order sheet line: oldest first, for the owner only (staff never get it)', () => {
    const entries = [entry({ kind: 'accept', at: at('09:32') }), entry({ kind: 'ready', at: at('09:51'), who: { personId: 'p_ali', name: 'علي', you: false } })];
    expect(orderWhoLine(entries, true, ar)).toBe(`قبله منتظر ${clock12(at('09:32'))} · جهّزه علي ${clock12(at('09:51'))}`);
    expect(orderWhoLine(entries, false, ar)).toBeNull();
    expect(orderWhoLine(undefined, true, ar)).toBeNull();
    expect(orderWhoLine([], true, ar)).toBeNull();
    expect(orderWhoLine([entry({ kind: 'auto_accept', who: null, at: at('09:30') })], true, ar)).toBe(`انقبل تلقائي ${clock12(at('09:30'))}`);
  });
});
