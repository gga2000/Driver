import { orderTicketNumber, type TicketSummary } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import {
  compactDuration,
  filterQueue,
  isUnread,
  markSeen,
  matchesSearch,
  slaFraction,
  viewCounts,
} from './support-views';

const AT = new Date('2026-10-04T15:00:00Z');
function row(over: Partial<TicketSummary>): TicketSummary {
  return {
    id: 'tk_1',
    cityId: 'aziziyah',
    kind: 'complaint',
    kind_ar: 'شكوى',
    status: 'open',
    status_ar: 'مفتوحة',
    channel: 'in_app',
    subject: 'الطلب تأخّر',
    orderId: null,
    tripId: null,
    customerId: 'c1',
    customerName: 'زينب',
    openedAt: AT,
    firstResponseAt: null,
    resolvedAt: null,
    slaDueAt: new Date(AT.getTime() + 6 * 3_600_000),
    slaState: 'ok',
    overdue24h: false,
    urgency: 10,
    urgencyReasons: [],
    assigneeId: null,
    faultParty: 'none',
    refundedIqd: 0,
    escalatedTo: null,
    lastActivityAt: AT,
    ...over,
  };
}

const rows = [
  row({ id: 'a', assigneeId: 'me', kind: 'dispute', orderId: 'ord_77' }),
  row({ id: 'b', slaState: 'breached', customerName: 'مصطفى' }),
  row({ id: 'c', status: 'waiting', assigneeId: 'other', subject: 'المندوب ما رجّع الباقي' }),
  row({ id: 'd', status: 'escalated', assigneeId: 'me' }),
];

describe('support smart views', () => {
  it('counts each view from the active queue', () => {
    expect(viewCounts(rows, 'me')).toEqual({
      open: 4,
      mine: 2,
      unassigned: 1,
      breached: 1,
      disputes: 1,
      escalated: 1,
      waiting: 1,
      resolved: 0,
    });
  });
  it('"لي" is empty until the signed-in person is known', () => {
    expect(viewCounts(rows, null).mine).toBe(0);
  });
  it('filters by view and search together', () => {
    expect(filterQueue(rows, 'mine', 'me', '').map((r) => r.id)).toEqual(['a', 'd']);
    expect(filterQueue(rows, 'open', 'me', 'مصطفى').map((r) => r.id)).toEqual(['b']);
  });
});

describe('queue search', () => {
  it('finds the order number the customer reads out, with or without #', () => {
    const n = orderTicketNumber('ord_77');
    expect(matchesSearch(rows[0]!, n)).toBe(true);
    expect(matchesSearch(rows[0]!, `#${n}`)).toBe(true);
  });
  it('folds spelling (رجّع / رجع, hamza)', () => {
    expect(matchesSearch(rows[2]!, 'رجع الباقي')).toBe(true);
    expect(matchesSearch(row({ customerName: 'أحمد' }), 'احمد')).toBe(true);
  });
});

describe('unread markers', () => {
  it('unread until opened, and again after new activity', () => {
    const r = row({ id: 'x' });
    expect(isUnread(r, {})).toBe(true);
    const seen = markSeen({}, r);
    expect(isUnread(r, seen)).toBe(false);
    expect(isUnread({ ...r, lastActivityAt: new Date(AT.getTime() + 60_000) }, seen)).toBe(true);
    expect(isUnread({ ...r, status: 'resolved' }, {})).toBe(false);
  });
  it('keeps the store small', () => {
    let seen = {};
    for (let i = 0; i < 10; i += 1)
      seen = markSeen(seen, { id: `t${i}`, lastActivityAt: new Date(AT.getTime() + i) }, 5);
    expect(Object.keys(seen).sort()).toEqual(['t5', 't6', 't7', 't8', 't9']);
  });
});

describe('SLA fuse', () => {
  it('compact durations read as durations, not clock times', () => {
    expect(compactDuration(40 * 60_000)).toBe('40 د');
    expect(compactDuration(150 * 60_000)).toBe('2 س 30 د');
    expect(compactDuration(3 * 3_600_000)).toBe('3 س');
    expect(compactDuration(-20 * 3_600_000 - 7 * 60_000)).toBe('20 س');
  });
  it('burns down from 1 to 0 across the same-day window', () => {
    const r = row({});
    expect(slaFraction(r, AT)).toBe(1);
    expect(slaFraction(r, new Date(AT.getTime() + 3 * 3_600_000))).toBeCloseTo(0.5);
    expect(slaFraction(r, new Date(AT.getTime() + 9 * 3_600_000))).toBe(0);
    expect(slaFraction({ ...r, status: 'resolved', slaState: 'met' }, AT)).toBe(1);
  });
});
