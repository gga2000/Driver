import { describe, expect, it } from 'vitest';
import type { HouseholdMemberView, MonthInsightsView } from '@driver/contracts';
import { baghdadDayMonth, budgetBar, monthRows, parseAmount, payerOf, presetChoice } from './family';
import { monthCardDue, monthLabel, monthSteps, warmLine } from './month';

const member = (p: Partial<HouseholdMemberView>): HouseholdMemberView => ({ personId: 'p', name: 'منار', phoneMasked: '+9647*', role: 'orderer', spendingLimitIqd: null, isMe: false, monthlyBudgetIqd: null, monthSpentIqd: null, ...p });

describe('«بيتنا» pieces (joy w4)', () => {
  it('a bullet bar: spend against the budget tick, clamped, over flagged; none without a budget', () => {
    expect(budgetBar(46_000, 100_000)).toEqual({ fraction: 0.46, over: false });
    expect(budgetBar(120_000, 100_000)).toEqual({ fraction: 1, over: true });
    expect(budgetBar(0, 50_000)).toEqual({ fraction: 0, over: false });
    expect(budgetBar(5_000, null)).toBeNull();
    expect(budgetBar(5_000, 0)).toEqual({ fraction: 1, over: true });
  });

  it('a stored limit shows as «بلا حد», a preset chip, or «غيره»', () => {
    expect(presetChoice(null, [10_000, 25_000])).toBe('none');
    expect(presetChoice(25_000, [10_000, 25_000])).toBe(25_000);
    expect(presetChoice(30_000, [10_000, 25_000])).toBe('other');
  });

  it('reads typed amounts in any digits, with or without separators', () => {
    expect(parseAmount('25,000')).toBe(25_000);
    expect(parseAmount('٢٥٠٠٠')).toBe(25_000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('بلا')).toBeNull();
  });

  it('month rows are the members the server lets the viewer see; the payer is found', () => {
    const members = [member({ personId: 'a', role: 'payer', monthSpentIqd: 0 }), member({ personId: 'b', monthSpentIqd: 46_000 }), member({ personId: 'c', monthSpentIqd: null })];
    expect(monthRows(members).map((m) => m.personId)).toEqual(['a', 'b']);
    expect(payerOf({ members })?.personId).toBe('a');
    expect(payerOf({ members: [] })).toBeNull();
  });

  it('an order’s day on the Baghdad calendar', () => {
    expect(baghdadDayMonth(new Date('2026-09-30T21:30:00Z'))).toEqual({ day: 1, month: 10 });
  });
});

const month = (p: Partial<MonthInsightsView>): MonthInsightsView => ({
  month: '2026-09',
  earliestMonth: '2025-10',
  meals: 0,
  kitchens: 0,
  topKitchen: null,
  topDish: null,
  rides: 0,
  rajaaTrips: 0,
  savedIqd: 0,
  pointsEarned: 0,
  hasActivity: true,
  ...p,
});
const amount = (n: number) => n.toLocaleString('en-US');

describe('«شهرك» pieces (joy w6)', () => {
  it('one warm line: safe travel, discovery, a favourite, savings, thanks; none for an empty month', () => {
    expect(warmLine(month({ rajaaTrips: 1, kitchens: 5 }), amount)).toEqual({ key: 'month.line_traveller' });
    expect(warmLine(month({ kitchens: 4 }), amount)).toEqual({ key: 'month.line_explorer', params: { n: 4 } });
    expect(warmLine(month({ kitchens: 1, topKitchen: { name: 'مطعم خالد', orders: 3 } }), amount)).toEqual({ key: 'month.line_loyal', params: { kitchen: 'مطعم خالد' } });
    expect(warmLine(month({ kitchens: 1, savedIqd: 3_250 }), amount)).toEqual({ key: 'month.line_saver', params: { amount: '3,250' } });
    expect(warmLine(month({ meals: 1, kitchens: 1 }), amount)).toEqual({ key: 'month.line_thanks' });
    expect(warmLine(month({ hasActivity: false }), amount)).toBeNull();
  });

  it('the month-start card: days 1–3 in Baghdad, once per device per month, never on a quiet day', () => {
    const first = new Date('2026-09-30T21:30:00Z'); // 00:30 on 1 October, Baghdad
    expect(monthCardDue(first, null, false)).toBe('2026-09');
    expect(monthCardDue(new Date('2026-10-03T20:00:00Z'), '2026-08', false)).toBe('2026-09'); // 23:00 on the 3rd
    expect(monthCardDue(new Date('2026-10-03T21:00:00Z'), null, false)).toBeNull(); // the 4th
    expect(monthCardDue(first, '2026-09', false)).toBeNull();
    expect(monthCardDue(first, null, true)).toBeNull();
  });

  it('labels and steps', () => {
    expect(monthLabel('2026-09')).toEqual({ nameKey: 'time.month_9', year: '2026' });
    expect(monthSteps('2026-10', '2025-10', '2026-10')).toEqual({ prev: '2026-09', next: null });
    expect(monthSteps('2025-10', '2025-10', '2026-10')).toEqual({ prev: null, next: '2025-11' });
  });
});
