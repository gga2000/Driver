import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES as rules, MoneyRules, peakWindowAt, peakWindows, shiftGuarantee, type StatementLine } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { EventsShiftActivity, windowStats, type ShiftActivity } from './guarantee.js';
import { guaranteeGroupId } from './postings.js';
import { ledgerHarness, ScriptedShiftActivity, workedExample } from './test-harness.js';

const g = rules.guarantee;
const ok = { offers: 20, accepted: 18, cancelsAfterAccept: 1, completedJobs: 3, earningsIqd: 6000 };
/** Sunday 2026-10-04, Baghdad (UTC+3): lunch 12:00–16:00 = 09:00Z–13:00Z, dinner 19:00–23:00 = 16:00Z–20:00Z. */
const at = (iso: string) => new Date(iso);

describe('shiftGuarantee: the G-91 rule for one peak shift', () => {
  it('qualified: tops earnings up to 10,000 (the difference, not a flat bonus)', () => {
    expect(shiftGuarantee(ok, g)).toEqual({ acceptance: 0.9, meets: { acceptance: true, cancels: true, jobs: true }, qualified: true, jobsToGo: 0, topUpIqd: 4000 });
  });

  it('exactly 85 % acceptance qualifies, whatever the float (17/20, 34/40, 85/100, 0.85 × n)', () => {
    for (const [accepted, offers] of [[17, 20], [34, 40], [85, 100], [51, 60], [119, 140]] as const) {
      expect(shiftGuarantee({ ...ok, accepted, offers }, g).meets.acceptance, `${accepted}/${offers}`).toBe(true);
    }
    expect(shiftGuarantee({ ...ok, accepted: 16, offers: 19 }, g)).toMatchObject({ qualified: false, topUpIqd: 0 }); // 84.2 %
    expect(shiftGuarantee({ ...ok, accepted: 84, offers: 100 }, g).meets.acceptance).toBe(false);
  });

  it('no offers at all is no acceptance to judge: not qualified', () => {
    expect(shiftGuarantee({ ...ok, offers: 0, accepted: 0 }, g)).toMatchObject({ acceptance: null, meets: { acceptance: false }, qualified: false, topUpIqd: 0 });
  });

  it('2 cancels after accept → nothing; 1 is allowed', () => {
    expect(shiftGuarantee({ ...ok, cancelsAfterAccept: 2 }, g)).toMatchObject({ meets: { cancels: false }, qualified: false, topUpIqd: 0 });
    expect(shiftGuarantee({ ...ok, cancelsAfterAccept: 1 }, g).qualified).toBe(true);
  });

  it('2 completed jobs → nothing, one job to go; 3 qualifies', () => {
    expect(shiftGuarantee({ ...ok, completedJobs: 2 }, g)).toMatchObject({ meets: { jobs: false }, qualified: false, jobsToGo: 1, topUpIqd: 0 });
    expect(shiftGuarantee({ ...ok, completedJobs: 0 }, g).jobsToGo).toBe(3);
  });

  it('earnings at or above 10,000 → qualified, top-up 0; never more than the amount', () => {
    expect(shiftGuarantee({ ...ok, earningsIqd: 10_000 }, g)).toMatchObject({ qualified: true, topUpIqd: 0 });
    expect(shiftGuarantee({ ...ok, earningsIqd: 14_500 }, g)).toMatchObject({ qualified: true, topUpIqd: 0 });
    expect(shiftGuarantee({ ...ok, earningsIqd: -500 }, g).topUpIqd).toBe(10_000);
  });

  it('the city switch off qualifies nobody', () => {
    expect(shiftGuarantee(ok, { ...g, enabled: false })).toMatchObject({ qualified: false, topUpIqd: 0 });
  });
});

describe('peak shifts on the Baghdad clock', () => {
  it('lunch 12:00–16:00 and dinner 19:00–23:00 local, ids by local date', () => {
    const ws = peakWindows({ from: at('2026-10-03T21:00:00Z'), to: at('2026-10-05T21:00:00Z') }, g.peaks, 180);
    expect(ws.map((w) => [w.id, w.from.toISOString(), w.to.toISOString()])).toEqual([
      ['2026-10-04:lunch', '2026-10-04T09:00:00.000Z', '2026-10-04T13:00:00.000Z'],
      ['2026-10-04:dinner', '2026-10-04T16:00:00.000Z', '2026-10-04T20:00:00.000Z'],
      ['2026-10-05:lunch', '2026-10-05T09:00:00.000Z', '2026-10-05T13:00:00.000Z'],
      ['2026-10-05:dinner', '2026-10-05T16:00:00.000Z', '2026-10-05T20:00:00.000Z'],
    ]);
  });

  it('a range overlapping part of a shift includes it; between peaks there is none', () => {
    expect(peakWindows({ from: at('2026-10-04T12:00:00Z'), to: at('2026-10-04T14:00:00Z') }, g.peaks, 180).map((w) => w.id)).toEqual(['2026-10-04:lunch']);
    expect(peakWindowAt(at('2026-10-04T12:59:59Z'), g.peaks, 180)?.id).toBe('2026-10-04:lunch');
    expect(peakWindowAt(at('2026-10-04T13:00:00Z'), g.peaks, 180)).toBeNull();
    expect(peakWindowAt(at('2026-10-04T21:30:00Z'), g.peaks, 180)).toBeNull(); // 00:30 local
  });

  it('the rules refuse a shift that wraps past midnight', () => {
    expect(() => MoneyRules.parse({ ...rules, guarantee: { ...g, peaks: [{ key: 'late', startMin: 23 * 60, endMin: 60 }] } })).toThrow();
  });
});

function line(over: Partial<StatementLine> & Pick<StatementLine, 'type' | 'amountIqd'>): StatementLine {
  return { id: `l${Math.random()}`, occurredAt: at('2026-10-04T10:00:00Z'), label_ar: '', label_en: '', accountId: 'driver:k1', counterparty: 'x', balanceAfterIqd: 0, ...over };
}

describe('windowStats: what one shift counts', () => {
  const lunch = { from: at('2026-10-04T09:00:00Z'), to: at('2026-10-04T13:00:00Z') };
  const activity: ShiftActivity = {
    offers: [
      { at: at('2026-10-04T08:59:00Z'), accepted: false }, // before the shift
      { at: at('2026-10-04T09:10:00Z'), accepted: true },
      { at: at('2026-10-04T10:10:00Z'), accepted: true },
      { at: at('2026-10-04T11:10:00Z'), accepted: false },
      { at: at('2026-10-04T13:00:00Z'), accepted: false }, // the end is exclusive
    ],
    cancelsAfterAccept: [{ at: at('2026-10-04T10:00:00Z'), tripId: 'tx' }],
    completed: [
      { at: at('2026-10-04T08:50:00Z'), tripId: 't0' },
      { at: at('2026-10-04T09:40:00Z'), tripId: 't1' },
      { at: at('2026-10-04T12:55:00Z'), tripId: 't2' },
    ],
  };

  it('counts offers, cancels and completed jobs inside [from, to)', () => {
    expect(windowStats(activity, [], lunch)).toMatchObject({ offers: 3, accepted: 2, cancelsAfterAccept: 1, completedJobs: 2, tripIds: ['t1', 't2'] });
  });

  it("earnings are the shift's jobs' pay and tips less the take, whenever posted; penalties, settlements and an earlier top-up don't count", () => {
    const lines = [
      line({ type: 'delivery_fee', amountIqd: 1000, tripId: 't1' }),
      line({ type: 'tip', amountIqd: 500, tripId: 't1' }),
      line({ type: 'fare', amountIqd: 3000, tripId: 't2', occurredAt: at('2026-10-04T15:00:00Z') }), // a wallet order closes later
      line({ type: 'commission_accrued', amountIqd: -300, tripId: 't2' }),
      line({ type: 'departure_cancel_fee', amountIqd: -1000, tripId: 't2' }),
      line({ type: 'driver_payout', amountIqd: -4000, tripId: 't2' }),
      line({ type: 'driver_incentive', amountIqd: 2000, tripId: 't2', memo: 'guarantee:2026-10-03:lunch' }),
      line({ type: 'delivery_fee', amountIqd: 1500, tripId: 't0' }), // completed before the shift
    ];
    expect(windowStats(activity, lines, lunch).earningsIqd).toBe(1000 + 500 + 3000 - 300);
  });
});

describe('EventsShiftActivity: from the real events log', () => {
  it('his answers and driver cancels; a trip counts when he holds its last accept and it completed in range; quarantined never', async () => {
    const { events } = createInMemoryEvents();
    const emit = (type: string, actorId: string, tripId: string, occurredAt: string, payload: Record<string, unknown> = {}) =>
      events.emit(undefined, { type, actorId, tripId, occurredAt: at(occurredAt), payload }, { name: 'trip', id: tripId });
    await emit('trip.accepted', 'k1', 't1', '2026-10-04T08:45:00Z', { driverId: 'k1' }); // accepted before lunch
    await emit('trip.completed', 'cust', 't1', '2026-10-04T09:20:00Z'); // completed by the customer, in lunch
    await emit('trip.declined', 'k1', 't2', '2026-10-04T09:30:00Z', { driverId: 'k1' });
    await emit('trip.timed_out', 'k1', 't3', '2026-10-04T09:31:00Z', { driverId: 'k1' });
    await emit('trip.accepted', 'k1', 't4', '2026-10-04T10:00:00Z', { driverId: 'k1' });
    await emit('trip.cancelled', 'k1', 't4', '2026-10-04T10:05:00Z', { by: 'driver' });
    await emit('trip.cancelled', 'ops', 't5', '2026-10-04T10:06:00Z', { by: 'platform' });
    await emit('trip.accepted', 'k1', 't6', '2026-10-04T11:00:00Z', { driverId: 'k1' });
    await emit('trip.accepted', 'k2', 't6', '2026-10-04T11:30:00Z', { driverId: 'k2' }); // reassigned
    await emit('trip.completed', 'k2', 't6', '2026-10-04T11:50:00Z');
    await emit('trip.accepted', 'k1', 't7', '2026-10-04T12:30:00Z', { driverId: 'k1' });
    await emit('trip.completed', 'k1', 't7', '2026-10-04T13:10:00Z'); // after lunch
    const a = await new EventsShiftActivity(events).activity('k1', { from: at('2026-10-04T09:00:00Z'), to: at('2026-10-04T13:00:00Z') });
    expect(a.offers.map((o) => o.accepted)).toEqual([false, false, true, true, true]);
    expect(a.cancelsAfterAccept.map((c) => c.tripId)).toEqual(['t4']);
    expect(a.completed.map((c) => c.tripId)).toEqual(['t1']);
  });
});

describe('ShiftGuaranteeService: counted live, paid once on the Sunday run', () => {
  /** k1 (courier) on Sunday lunch: 18/20 accepted, 1 cancel, 3 jobs paying 1,000 + 1,000 + 1,000 + a 500 tip. */
  async function lunchShift(start = '2026-10-04T08:00:00Z') {
    const activity = new ScriptedShiftActivity();
    const h = ledgerHarness({ start, activity });
    const a = activity.of('k1');
    for (let i = 0; i < 20; i++) a.offers.push({ at: new Date(at('2026-10-04T09:05:00Z').getTime() + i * 10 * 60_000), accepted: i >= 2 });
    a.cancelsAfterAccept.push({ at: at('2026-10-04T09:30:00Z'), tripId: 'tc' });
    for (const [i, done] of ['2026-10-04T09:40:00Z', '2026-10-04T10:40:00Z', '2026-10-04T12:40:00Z'].entries()) {
      a.completed.push({ at: at(done), tripId: `t${i + 1}` });
      await h.posting.orderClosed(workedExample({ orderId: `o${i + 1}`, tripId: `t${i + 1}`, courierId: 'k1', occurredAt: at(done), tipIqd: i === 0 ? 500 : 0 }));
    }
    return h;
  }

  it('live: the shift so far, with jobs to go and what it would pay', async () => {
    const h = await lunchShift();
    h.clock.set('2026-10-04T10:00:00Z');
    const [w] = await h.facade.guaranteeWindows({ driverId: 'k1', from: at('2026-10-04T09:00:00Z'), to: at('2026-10-04T10:00:00Z') });
    expect(w).toMatchObject({ id: '2026-10-04:lunch', status: 'live', completedJobs: 1, jobsToGo: 2, qualified: false, earningsIqd: 1500, paysOn: at('2026-10-10T21:00:00Z') });
  });

  it('ended: 3,500 earned → 6,500 top-up waiting for Sunday', async () => {
    const h = await lunchShift();
    h.clock.set('2026-10-04T14:00:00Z');
    const [w] = await h.guarantee.windows('k1', { from: at('2026-10-04T09:00:00Z'), to: at('2026-10-04T13:00:00Z') });
    expect(w).toMatchObject({ status: 'ended', offers: 20, accepted: 18, acceptance: 0.9, cancelsAfterAccept: 1, completedJobs: 3, earningsIqd: 3500, qualified: true, topUpIqd: 6500 });
  });

  it('nothing is paid nightly; the Sunday run pays it once (platform-funded, balanced) and it shows as paid', async () => {
    const h = await lunchShift();
    h.clock.set('2026-10-05T23:00:00Z'); // Tuesday 02:00 local
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    h.clock.set('2026-10-10T23:00:00Z'); // Sunday 02:00 local
    const report = await h.nightly.run();
    expect(report.guaranteePaid).toEqual([{ driverId: 'k1', windowId: '2026-10-04:lunch', amountIqd: 6500 }]);
    expect(report.ok).toBe(true);
    // Posted before the weekly payout figures: his earnings balance carries the top-up (cash he holds nets against it).
    expect((await h.caps.status('k1')).earningsIqd).toBe(3500 + 6500);
    const rows = await h.ledger.eventsForGroups([guaranteeGroupId('k1', '2026-10-04:lunch')]);
    expect(rows).toMatchObject([{ type: 'driver_incentive', amount: 6500, fromAccount: 'platform', toAccount: 'driver:k1', memo: 'guarantee:2026-10-04:lunch' }]);
    // A re-run (manual, or the next Sunday re-checking the week) pays nothing twice.
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    h.clock.set('2026-10-17T23:00:00Z');
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    expect(await h.ledger.eventsForGroups([guaranteeGroupId('k1', '2026-10-04:lunch')])).toHaveLength(1);
    const [w] = await h.guarantee.windows('k1', { from: at('2026-10-04T09:00:00Z'), to: at('2026-10-04T13:00:00Z') });
    expect(w).toMatchObject({ status: 'paid', topUpIqd: 6500 });
  });

  it('only covered roles: a car driver (cap role driver) is not paid', async () => {
    const h = await lunchShift();
    h.profiles.set('k1', { role: 'driver', tier: 'bronze' });
    h.clock.set('2026-10-10T23:00:00Z');
    expect(await h.guarantee.covers('k1')).toBe(false);
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
  });

  it('the city switch off pays nobody', async () => {
    const activity = new ScriptedShiftActivity();
    const h = ledgerHarness({ start: '2026-10-10T23:00:00Z', activity, rules: { ...rules, guarantee: { ...g, enabled: false } } });
    await h.posting.orderClosed(workedExample({ courierId: 'k1', tripId: 't1', occurredAt: at('2026-10-04T09:40:00Z') }));
    activity.of('k1').completed.push({ at: at('2026-10-04T09:40:00Z'), tripId: 't1' });
    expect(await h.guarantee.settleWeek(h.clock.now())).toEqual([]);
  });
});
