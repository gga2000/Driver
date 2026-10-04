import { describe, expect, it } from 'vitest';
import type { MerchantDispute, StatementOrderLine } from '@driver/contracts';
import { hour12, hourPeriod, localDayKey, localParts, relativeDay, startOfLocalWeek } from '@/lib/calendar';
import { balanceState, canRequest, canSendAnswer, disputeClock, exposure, holderRows, lateMinutes, requestBlocker, requestProgress, statementDays, ticketNumber, waitingCount, weekAnchor } from './logic';

const H = 3_600_000;

describe('calendar (Baghdad)', () => {
  it('local parts, day keys and the Sunday-start week', () => {
    const at = new Date('2026-10-03T18:36:00Z'); // Saturday 21:36 Baghdad
    expect(localParts(at)).toEqual({ year: 2026, month: 10, day: 3, dow: 6, hour: 21, minute: 36 });
    expect(localDayKey(new Date('2026-10-03T21:30:00Z'))).toBe('2026-10-04'); // 00:30 Sunday local
    expect(new Date(startOfLocalWeek(at)).toISOString()).toBe('2026-09-26T21:00:00.000Z');
    expect(relativeDay(new Date('2026-10-02T20:00:00Z'), at)).toBe('yesterday');
    expect(relativeDay(new Date('2026-10-02T22:00:00Z'), at)).toBe('today');
    expect(relativeDay(new Date('2026-09-30T10:00:00Z'), at)).toBeNull();
  });

  it('names the part of the day like people say it', () => {
    expect([2, 9, 13, 16, 19, 22].map(hourPeriod)).toEqual(['p_late_night', 'p_morning', 'p_noon', 'p_afternoon', 'p_evening', 'p_night']);
    expect([0, 9, 12, 13, 21].map(hour12)).toEqual([12, 9, 12, 1, 9]);
  });
});

describe('cash account', () => {
  it('exposure bar fills toward the 300,000 cap and turns red near it', () => {
    expect(exposure(150_000, 300_000)).toEqual({ fill: 0.5, tone: 'success', leftIqd: 150_000, over: false });
    expect(exposure(214_500, 300_000).tone).toBe('warning');
    expect(exposure(280_000, 300_000).tone).toBe('danger');
    expect(exposure(320_000, 300_000)).toMatchObject({ fill: 1, over: true, leftIqd: 0 });
    expect(exposure(-5_000, 300_000).fill).toBe(0);
    // M-07: clamped — a negative balance never reads as more room than the cap.
    expect(exposure(-4_250, 300_000)).toEqual({ fill: 0, tone: 'success', leftIqd: 300_000, over: false });
  });

  it('M-07: a negative balance is explained, and a blocked "اطلب فلوسك" always has a reason', () => {
    expect(balanceState(87_500)).toEqual({ kind: 'owed', amountIqd: 87_500 });
    expect(balanceState(-4_250)).toEqual({ kind: 'owe', amountIqd: 4_250 });
    expect(balanceState(0)).toEqual({ kind: 'zero', amountIqd: 0 });
    expect(requestBlocker({ balanceIqd: 87_500, request: null })).toBeNull();
    expect(requestBlocker({ balanceIqd: -4_250, request: null })).toBe('owe');
    expect(requestBlocker({ balanceIqd: 0, request: null })).toBe('zero');
    expect(requestBlocker({ balanceIqd: 87_500, request: { state: 'on_the_way' } as never })).toBe('open');
  });

  it('holder rows: couriers then Driver, with shares for the bars', () => {
    const rows = holderRows({ balanceIqd: 100_000, heldByPlatformIqd: 25_000, holders: [{ courierId: 'k1', name: 'حيدر', amountIqd: 50_000 }, { courierId: 'k2', name: null, amountIqd: 25_000 }] });
    expect(rows.map((r) => [r.kind, r.amountIqd, r.share])).toEqual([
      ['courier', 50_000, 0.5],
      ['courier', 25_000, 0.25],
      ['platform', 25_000, 0.25],
    ]);
  });

  it('request progress and when the button is live', () => {
    expect(requestProgress({ state: 'requested' })).toEqual({ current: 0, done: false });
    expect(requestProgress({ state: 'on_the_way' })).toEqual({ current: 1, done: false });
    expect(requestProgress({ state: 'handed_over' })).toEqual({ current: 2, done: true });
    const open = { state: 'on_the_way' } as never;
    expect(canRequest({ balanceIqd: 10_000, request: null })).toBe(true);
    expect(canRequest({ balanceIqd: 10_000, request: open })).toBe(false);
    expect(canRequest({ balanceIqd: 0, request: null })).toBe(false);
    expect(canRequest({ balanceIqd: 5_000, request: { state: 'handed_over' } as never })).toBe(true);
  });

  it('ticket numbers match the board (four digits, stable)', () => {
    expect(ticketNumber('ord_1')).toMatch(/^\d{4}$/);
    expect(ticketNumber('ord_1')).toBe(ticketNumber('ord_1'));
    expect(ticketNumber('ord_1')).not.toBe(ticketNumber('ord_2'));
  });
});

describe('weekly statement', () => {
  const line = (orderId: string, at: string, itemsIqd: number, commissionIqd: number): StatementOrderLine => ({
    orderId,
    at: new Date(at),
    payment: 'cash',
    itemsIqd,
    commissionTier: 'base',
    commissionPct: 12,
    commissionIqd,
    discountIqd: 0,
    discountFunder: null,
    dealIqd: 0,
    roundingIqd: 0,
    feesIqd: 0,
    netIqd: itemsIqd - commissionIqd,
  });

  it('groups lines by Baghdad day, newest first, with day totals', () => {
    const days = statementDays([line('a', '2026-10-01T10:00:00Z', 10_000, 1_200), line('b', '2026-10-01T22:30:00Z', 20_000, 2_400), line('c', '2026-10-01T18:00:00Z', 5_000, 600)]);
    expect(days.map((d) => [d.key, d.lines.map((l) => l.orderId), d.orders, d.netIqd])).toEqual([
      ['2026-10-02', ['b'], 1, 17_600],
      ['2026-10-01', ['c', 'a'], 2, 13_200],
    ]);
  });

  it('week anchors step back whole weeks', () => {
    const now = new Date('2026-10-03T18:36:00Z').getTime();
    expect(localDayKey(weekAnchor(now, 0))).toBe('2026-09-27');
    expect(localDayKey(weekAnchor(now, 1))).toBe('2026-09-20');
  });
});

describe('disputes', () => {
  const now = new Date('2026-10-03T18:00:00Z').getTime();
  const base = { response: null, respondBy: new Date(now + 30 * H) } as Pick<MerchantDispute, 'response' | 'respondBy'>;

  it('counts down 48 h, urgent under 12 h, then the default applies', () => {
    expect(disputeClock(base, now)).toEqual({ status: 'waiting', hoursLeft: 30, minutesLeft: 1800, urgent: false });
    expect(disputeClock({ ...base, respondBy: new Date(now + 5 * H) }, now)).toMatchObject({ hoursLeft: 5, urgent: true });
    expect(disputeClock({ ...base, respondBy: new Date(now - 1) }, now).status).toBe('default_applied');
    const answered = { ...base, response: { decision: 'contest' as const, note: 'x', evidencePhotos: 1, photoUrls: [], at: new Date(now) } };
    expect(disputeClock(answered, now).status).toBe('contested');
    expect(waitingCount([base, answered], now)).toBe(1);
  });

  it('late minutes against the promise, and a contest needs a note', () => {
    expect(lateMinutes(new Date(now), new Date(now + 7 * 60_000))).toBe(7);
    expect(lateMinutes(null, new Date(now))).toBeNull();
    expect(canSendAnswer('accept_default', '')).toBe(true);
    expect(canSendAnswer('contest', '  ')).toBe(false);
    expect(canSendAnswer('contest', 'انحط الكباب')).toBe(true);
    expect(canSendAnswer(null, 'x')).toBe(false);
  });
});
