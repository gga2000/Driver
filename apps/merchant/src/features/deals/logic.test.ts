import { describe, expect, it } from 'vitest';
import { baghdadDayStart, budgetUse, canToggle, dayMonth, dealDisplay, draftProblems, draftToInput, draftWindow, emptyDraft, kindOf, lastDay, projectionKey, sortDeals, spanDays, toggleDay, weekday, type DealLike } from './logic';

const NOW = Date.parse('2026-10-03T12:00:00Z'); // Saturday 15:00 Baghdad
const DAY = 86_400_000;

function deal(over: Partial<DealLike> & { createdAt?: Date } = {}): DealLike & { createdAt: Date } {
  return {
    type: 'percent',
    value: 20,
    itemIds: [],
    state: 'approved',
    active: true,
    schedule: { startsAt: new Date(NOW - DAY), endsAt: new Date(NOW + 6 * DAY), days: [] },
    budgetCapIqd: null,
    spentIqd: 0,
    createdAt: new Date(NOW - DAY),
    ...over,
  };
}

describe('deal state on the card', () => {
  it('splits approved into active, scheduled and budget reached', () => {
    expect(dealDisplay(deal(), NOW)).toBe('active');
    expect(dealDisplay(deal({ schedule: { startsAt: new Date(NOW + DAY), endsAt: new Date(NOW + 8 * DAY), days: [] } }), NOW)).toBe('scheduled');
    expect(dealDisplay(deal({ budgetCapIqd: 50_000, spentIqd: 50_000, active: false }), NOW)).toBe('capped');
    expect(dealDisplay(deal({ state: 'pending_approval', active: false }), NOW)).toBe('pending');
    expect(dealDisplay(deal({ state: 'paused', active: false }), NOW)).toBe('paused');
    expect(dealDisplay(deal({ state: 'ended', active: false }), NOW)).toBe('ended');
    expect(dealDisplay(deal({ state: 'rejected', active: false }), NOW)).toBe('rejected');
  });

  it('sorts running first and history last; only live deals have a switch', () => {
    const ended = deal({ state: 'ended' });
    const pending = deal({ state: 'pending_approval' });
    const active = deal();
    expect(sortDeals([ended, pending, active], NOW)).toEqual([active, pending, ended]);
    expect(canToggle('active')).toBe('pause');
    expect(canToggle('paused')).toBe('resume');
    expect(canToggle('ended')).toBeNull();
    expect(canToggle('pending')).toBeNull();
    expect(canToggle('rejected')).toBeNull();
    expect(budgetUse({ budgetCapIqd: 40_000, spentIqd: 10_000 })).toBe(0.25);
    expect(budgetUse({ budgetCapIqd: null, spentIqd: 10_000 })).toBeNull();
  });
});

describe('propose wizard', () => {
  it('checks each step', () => {
    const d = emptyDraft();
    expect(draftProblems(d)).toEqual(['kind']);
    expect(draftProblems({ ...d, kind: 'bogo' }, 'offer')).toEqual(['items']);
    expect(draftProblems({ ...d, kind: 'percent', percent: 60 }, 'offer')).toEqual(['percent']);
    expect(draftProblems({ ...d, kind: 'item_discount', amountIqd: 600, itemIds: ['a'] }, 'offer')).toEqual(['amount']);
    expect(draftProblems({ ...d, kind: 'free_delivery', nameAr: 'x' }, 'offer')).toEqual(['name']);
    expect(draftProblems({ ...d, kind: 'free_delivery', days: [0, 1, 2, 3, 4, 5, 6] }, 'kind')).toEqual([]);
    expect(draftProblems({ ...d, kind: 'free_delivery', days: [0, 1, 2, 3, 4, 5, 6] }, 'when')).toEqual(['days']);
  });

  it('starts now or at Baghdad midnight and ends at midnight after the last day', () => {
    expect(new Date(baghdadDayStart(NOW)).toISOString()).toBe('2026-10-02T21:00:00.000Z');
    const today = draftWindow({ startInDays: 0, durationDays: 7 }, NOW);
    expect(today.startsAt.getTime()).toBe(NOW);
    expect(today.endsAt.toISOString()).toBe('2026-10-09T21:00:00.000Z');
    const tomorrow = draftWindow({ startInDays: 1, durationDays: 3 }, NOW);
    expect(tomorrow.startsAt.toISOString()).toBe('2026-10-03T21:00:00.000Z');
    expect(tomorrow.endsAt.toISOString()).toBe('2026-10-06T21:00:00.000Z');
    expect(dayMonth(lastDay(tomorrow.endsAt))).toBe('6/10');
    expect(spanDays(tomorrow.startsAt, tomorrow.endsAt)).toBe(3);
    expect(weekday(NOW)).toBe(6);
  });

  it('builds the API input (item discount is a fixed amount, free delivery covers the whole menu)', () => {
    const base = { ...emptyDraft(), durationDays: 14, days: [5, 4], hours: 'dinner' as const, minOrderIqd: 15_000 };
    expect(draftToInput({ ...base, kind: 'item_discount', amountIqd: 1000, itemIds: ['a', 'b'] }, 'org_1', NOW, 'خصم')).toMatchObject({
      type: 'fixed',
      value: 1000,
      nameAr: 'خصم',
      itemIds: ['a', 'b'],
      schedule: { days: [4, 5], hours: { start: '19:00', end: '23:00' } },
      minOrderIqd: 15_000,
    });
    const fd = draftToInput({ ...base, kind: 'free_delivery', itemIds: ['a'], nameAr: '  توصيل ببلاش ', budgetCapIqd: 50_000 }, 'org_1', NOW, 'x');
    expect(fd).toMatchObject({ type: 'free_delivery', value: 0, itemIds: [], nameAr: 'توصيل ببلاش', budgetCapIqd: 50_000 });
    expect(draftToInput({ ...base, kind: 'bogo' }, 'org_1', NOW, 'x')).toBeNull();
    const pct = draftToInput({ ...base, kind: 'percent', percent: 20, hours: 'all' }, 'org_1', NOW + 30_123, 'x')!;
    expect(pct.schedule.hours).toBeUndefined();
    expect(projectionKey(pct).schedule.startsAt.getTime() % 60_000).toBe(0);
    expect(kindOf('fixed')).toBe('item_discount');
    expect(toggleDay([1, 3], 2)).toEqual([1, 2, 3]);
    expect(toggleDay([1, 2, 3], 2)).toEqual([1, 3]);
  });
});
