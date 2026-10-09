import { describe, expect, it } from 'vitest';
import type { MerchantDispute, StatementOrderLine } from '@driver/contracts';
import { hour12, hourPeriod, localDayKey, localParts, relativeDay, startOfLocalWeek } from '@/lib/calendar';
import { balanceState, beforeFirstOrder, canRequest, canSendAnswer, disputeClock, exposure, holderRows, lateMinutes, moneyPill, requestBlocker, requestProgress, statementBridge, statementDays, ticketNumber, waitingCount, weekAnchor } from './logic';

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

describe('money in one line (S-M5) and the weekly bridge (M-17)', () => {
  it('owed: the amount, how it reaches him, and "اطلب فلوسك" beside it', () => {
    expect(moneyPill({ kind: 'owed', amountIqd: 87_500, arrives: 'tonight_courier', by: null })).toEqual({
      tone: 'neutral',
      main: { key: 'merchant.moneypill.owed', amountIqd: 87_500 },
      sub: 'merchant.moneypill.arrives_tonight_courier',
      action: 'request',
    });
    expect(moneyPill({ kind: 'owed', amountIqd: 1, arrives: 'bank_weekly', by: null }).sub).toBe('merchant.moneypill.arrives_bank_weekly');
  });

  it('owe: commission in warning words, never a dead button; requested: the promised time; zero: says so', () => {
    expect(moneyPill({ kind: 'owe', amountIqd: 4_250, arrives: null, by: null })).toMatchObject({ tone: 'warning', main: { key: 'merchant.moneypill.owe', amountIqd: 4_250 }, sub: 'merchant.moneypill.owe_when', action: 'open_money' });
    const by = new Date('2026-10-05T18:40:00Z');
    expect(moneyPill({ kind: 'requested', amountIqd: 87_500, arrives: null, by })).toMatchObject({ tone: 'success', main: { key: 'merchant.moneypill.requested', time: by } });
    expect(moneyPill({ kind: 'requested', amountIqd: 87_500, arrives: null, by: null }).main.key).toBe('merchant.moneypill.requested_pending');
    expect(moneyPill({ kind: 'zero', amountIqd: 0, arrives: null, by: null })).toMatchObject({ main: { key: 'merchant.money.pill_zero' }, action: 'open_money' });
  });

  it('the bridge: opening + net − received (+ adjustments) = closing; adjustments only when there are some', () => {
    const totals = { orders: 9, itemsIqd: 0, commissionIqd: 0, feesIqd: 0, netIqd: 15_620, settledIqd: 250_204, adjustmentsIqd: 87_500 };
    const b = statementBridge({ openingIqd: 142_834, closingIqd: -4_250, totals });
    expect(b.terms.map((x) => [x.key, x.op, x.amountIqd])).toEqual([
      ['opening', '', 142_834],
      ['net', '+', 15_620],
      ['settled', '−', 250_204],
      ['adjustments', '+', 87_500],
      ['closing', '=', -4_250],
    ]);
    expect(b.adds).toBe(true);
    expect(statementBridge({ openingIqd: 0, closingIqd: 0, totals: { ...totals, netIqd: 12_750, settledIqd: 12_750, adjustmentsIqd: 0 } }).terms.map((x) => x.key)).toEqual(['opening', 'net', 'settled', 'closing']);
  });
});

describe('d12 · before the first delivered order', () => {
  const fresh = { balanceIqd: 0, lastSettledAt: null, handovers: [], request: null, holders: [], heldByPlatformIqd: 0 };
  it('a zero balance that never moved says «فلوسك تبين هنا من أول طلب»', () => {
    expect(beforeFirstOrder(fresh)).toBe(true);
    expect(moneyPill({ kind: 'zero', amountIqd: 0, arrives: null, by: null }, { firstOrder: true }).main.key).toBe('merchant.money.pill_first');
  });
  it('anything that ever moved opens the gate', () => {
    expect(beforeFirstOrder(undefined)).toBe(false);
    expect(beforeFirstOrder(fresh, 1)).toBe(false);
    expect(beforeFirstOrder({ ...fresh, balanceIqd: 4_500 })).toBe(false);
    expect(beforeFirstOrder({ ...fresh, balanceIqd: -500 })).toBe(false);
    expect(beforeFirstOrder({ ...fresh, lastSettledAt: new Date('2026-10-01T10:00:00Z') })).toBe(false);
    expect(beforeFirstOrder({ ...fresh, heldByPlatformIqd: 2_000 })).toBe(false);
    expect(beforeFirstOrder({ ...fresh, holders: [{ courierId: 'c1', name: 'حيدر', amountIqd: 9_000 }] })).toBe(false);
    // Settled back to zero: an old shop keeps «ما عندك فلوس عند درايفر هسة».
    expect(beforeFirstOrder({ ...fresh, handovers: [{ handoverId: 'h1', at: new Date(), courierId: 'c1', courierName: null, amountIqd: 9_000, balanceAfterIqd: 0, confirmedBy: 'pin' }] })).toBe(false);
    expect(moneyPill({ kind: 'zero', amountIqd: 0, arrives: null, by: null }).main.key).toBe('merchant.money.pill_zero');
  });
});
