import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES as rules, MoneyRules, peakWindowAt, peakWindows, shiftGuarantee, type StatementLine } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { EventsShiftActivity, windowStats, type ShiftActivity } from './guarantee.js';
import { guaranteeGroupId } from './postings.js';
import { ledgerHarness, ScriptedShiftActivity, workedExample } from './test-harness.js';

/**
 * Aziziyah ships the guarantee switched off (Ali, 2026-10-06: "hold it, switch it off"); the rule and
 * the service are tested with the switch on, so turning it on later pays exactly this.
 */
const g: MoneyRules['guarantee'] = { ...rules.guarantee, enabled: true };
const on: MoneyRules = { ...rules, guarantee: g };
const ok = { offers: 20, accepted: 18, cancelsAfterAccept: 1, completedJobs: 3, earningsIqd: 6000 };
/**
 * Sunday 2026-10-04, Baghdad (UTC+3), Ali's shifts: day 06:00–15:00 = 03:00Z–12:00Z, evening
 * 15:00–02:00 (Monday) = 12:00Z–23:00Z.
 */
const at = (iso: string) => new Date(iso);

describe('shiftGuarantee: the G-91 rule for one shift', () => {
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

  it('Aziziyah ships it switched off (Ali, 2026-10-06), and off is the default for any city', () => {
    expect(rules.guarantee.enabled).toBe(false);
    expect(shiftGuarantee(ok, rules.guarantee)).toMatchObject({ qualified: false, topUpIqd: 0 });
    const withoutSwitch: Partial<MoneyRules['guarantee']> = { ...rules.guarantee };
    delete withoutSwitch.enabled;
    expect(MoneyRules.parse({ ...rules, guarantee: withoutSwitch }).guarantee.enabled).toBe(false);
  });
});

describe('the shifts on the Baghdad clock (Ali, 2026-10-06)', () => {
  it('day 06:00–15:00 and evening 15:00–02:00 local, ids by the date the shift starts on', () => {
    expect(rules.guarantee.peaks).toEqual([
      { key: 'day', startMin: 360, endMin: 900 },
      { key: 'evening', startMin: 900, endMin: 1560 },
    ]);
    const ws = peakWindows({ from: at('2026-10-03T21:00:00Z'), to: at('2026-10-05T21:00:00Z') }, g.peaks, 180);
    expect(ws.map((w) => [w.id, w.from.toISOString(), w.to.toISOString()])).toEqual([
      ['2026-10-03:evening', '2026-10-03T12:00:00.000Z', '2026-10-03T23:00:00.000Z'], // Saturday's, still running at Sunday 00:00
      ['2026-10-04:day', '2026-10-04T03:00:00.000Z', '2026-10-04T12:00:00.000Z'],
      ['2026-10-04:evening', '2026-10-04T12:00:00.000Z', '2026-10-04T23:00:00.000Z'],
      ['2026-10-05:day', '2026-10-05T03:00:00.000Z', '2026-10-05T12:00:00.000Z'],
      ['2026-10-05:evening', '2026-10-05T12:00:00.000Z', '2026-10-05T23:00:00.000Z'],
    ]);
  });

  it('past midnight: a job at 00:30 belongs to the previous day\'s evening shift; 02:00 starts nothing until 06:00', () => {
    expect(peakWindowAt(at('2026-10-04T21:30:00Z'), g.peaks, 180)).toMatchObject({ id: '2026-10-04:evening', localDate: '2026-10-04', to: at('2026-10-04T23:00:00Z') }); // Monday 00:30
    expect(peakWindowAt(at('2026-10-04T22:59:59.999Z'), g.peaks, 180)?.id).toBe('2026-10-04:evening'); // 01:59:59.999
    expect(peakWindowAt(at('2026-10-04T23:00:00Z'), g.peaks, 180)).toBeNull(); // 02:00, the end is exclusive
    expect(peakWindowAt(at('2026-10-05T02:59:59Z'), g.peaks, 180)).toBeNull(); // 05:59:59
    expect(peakWindowAt(at('2026-10-05T03:00:00Z'), g.peaks, 180)?.id).toBe('2026-10-05:day');
    // 15:00 sharp is the evening shift's first instant, not the day shift's last.
    expect(peakWindowAt(at('2026-10-04T11:59:59.999Z'), g.peaks, 180)?.id).toBe('2026-10-04:day');
    expect(peakWindowAt(at('2026-10-04T12:00:00Z'), g.peaks, 180)?.id).toBe('2026-10-04:evening');
    // A range that starts after midnight still finds the shift running into it.
    expect(peakWindows({ from: at('2026-10-04T22:00:00Z'), to: at('2026-10-05T04:00:00Z') }, g.peaks, 180).map((w) => w.id)).toEqual(['2026-10-04:evening', '2026-10-05:day']);
  });

  it('the rules take a shift past midnight up to 24 hours, refuse a longer, backwards or overlapping one', () => {
    const parse = (peaks: unknown) => () => MoneyRules.parse({ ...rules, guarantee: { ...g, peaks } });
    expect(parse([{ key: 'late', startMin: 23 * 60, endMin: 25 * 60 }])).not.toThrow();
    expect(parse([{ key: 'all', startMin: 6 * 60, endMin: 30 * 60 }])).not.toThrow(); // exactly 24 h
    expect(parse([{ key: 'late', startMin: 23 * 60, endMin: 60 }])).toThrow(); // ends before it starts: write 25 × 60
    expect(parse([{ key: 'long', startMin: 6 * 60, endMin: 30 * 60 + 1 }])).toThrow();
    expect(parse([{ key: 'day', startMin: 6 * 60, endMin: 15 * 60 }, { key: 'evening', startMin: 14 * 60, endMin: 26 * 60 }])).toThrow();
    expect(parse([{ key: 'day', startMin: 6 * 60, endMin: 15 * 60 }, { key: 'evening', startMin: 15 * 60, endMin: 30 * 60 + 60 }])).toThrow(); // runs into 06:00
    expect(parse([{ key: 'day', startMin: 1 * 60, endMin: 15 * 60 }, { key: 'evening', startMin: 15 * 60, endMin: 26 * 60 }])).toThrow(); // 01:00 is still last night's
    expect(parse([{ key: 'day', startMin: 6 * 60, endMin: 9 * 60 }, { key: 'day', startMin: 10 * 60, endMin: 12 * 60 }])).toThrow(); // same key
  });
});

function line(over: Partial<StatementLine> & Pick<StatementLine, 'type' | 'amountIqd'>): StatementLine {
  return { id: `l${Math.random()}`, occurredAt: at('2026-10-04T10:00:00Z'), label_ar: '', label_en: '', accountId: 'driver:k1', counterparty: 'x', balanceAfterIqd: 0, ...over };
}

describe('windowStats: what one shift counts', () => {
  const shift = { from: at('2026-10-04T09:00:00Z'), to: at('2026-10-04T13:00:00Z') };
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
    expect(windowStats(activity, [], shift)).toMatchObject({ offers: 3, accepted: 2, cancelsAfterAccept: 1, completedJobs: 2, tripIds: ['t1', 't2'] });
  });

  it("earnings are the shift's jobs' pay and tips less the take, whenever posted; penalties, settlements and an earlier top-up don't count", () => {
    const lines = [
      line({ type: 'delivery_fee', amountIqd: 1000, tripId: 't1' }),
      line({ type: 'tip', amountIqd: 500, tripId: 't1' }),
      line({ type: 'fare', amountIqd: 3000, tripId: 't2', occurredAt: at('2026-10-04T15:00:00Z') }), // a wallet order closes later
      line({ type: 'commission_accrued', amountIqd: -300, tripId: 't2' }),
      line({ type: 'departure_cancel_fee', amountIqd: -1000, tripId: 't2' }),
      line({ type: 'driver_payout', amountIqd: -4000, tripId: 't2' }),
      line({ type: 'driver_incentive', amountIqd: 2000, tripId: 't2', memo: 'guarantee:2026-10-03:day' }),
      line({ type: 'delivery_fee', amountIqd: 1500, tripId: 't0' }), // completed before the shift
    ];
    expect(windowStats(activity, lines, shift).earningsIqd).toBe(1000 + 500 + 3000 - 300);
  });
});

describe('EventsShiftActivity: from the real events log', () => {
  it('his answers and driver cancels; a trip counts when he holds its last accept and it completed in range; quarantined never', async () => {
    const { events } = createInMemoryEvents();
    const emit = (type: string, actorId: string, tripId: string, occurredAt: string, payload: Record<string, unknown> = {}) =>
      events.emit(undefined, { type, actorId, tripId, occurredAt: at(occurredAt), payload }, { name: 'trip', id: tripId });
    await emit('trip.accepted', 'k1', 't1', '2026-10-04T08:45:00Z', { driverId: 'k1' }); // accepted before the range
    await emit('trip.completed', 'cust', 't1', '2026-10-04T09:20:00Z'); // completed by the customer, in range
    await emit('trip.declined', 'k1', 't2', '2026-10-04T09:30:00Z', { driverId: 'k1' });
    await emit('trip.timed_out', 'k1', 't3', '2026-10-04T09:31:00Z', { driverId: 'k1' });
    await emit('trip.accepted', 'k1', 't4', '2026-10-04T10:00:00Z', { driverId: 'k1' });
    await emit('trip.cancelled', 'k1', 't4', '2026-10-04T10:05:00Z', { by: 'driver' });
    await emit('trip.cancelled', 'ops', 't5', '2026-10-04T10:06:00Z', { by: 'platform' });
    await emit('trip.accepted', 'k1', 't6', '2026-10-04T11:00:00Z', { driverId: 'k1' });
    await emit('trip.accepted', 'k2', 't6', '2026-10-04T11:30:00Z', { driverId: 'k2' }); // reassigned
    await emit('trip.completed', 'k2', 't6', '2026-10-04T11:50:00Z');
    await emit('trip.accepted', 'k1', 't7', '2026-10-04T12:30:00Z', { driverId: 'k1' });
    await emit('trip.completed', 'k1', 't7', '2026-10-04T13:10:00Z'); // after the range
    const a = await new EventsShiftActivity(events).activity('k1', { from: at('2026-10-04T09:00:00Z'), to: at('2026-10-04T13:00:00Z') });
    expect(a.offers.map((o) => o.accepted)).toEqual([false, false, true, true, true]);
    expect(a.cancelsAfterAccept.map((c) => c.tripId)).toEqual(['t4']);
    expect(a.completed.map((c) => c.tripId)).toEqual(['t1']);
  });
});

describe('ShiftGuaranteeService: counted live, paid once on the Sunday run', () => {
  /** k1 (courier) in Sunday's day shift (06:00–15:00): 18/20 accepted, 1 cancel, 3 jobs paying 1,000 + 1,000 + 1,000 + a 500 tip. */
  async function dayShift(start = '2026-10-04T03:00:00Z', cityRules: MoneyRules = on) {
    const activity = new ScriptedShiftActivity();
    const h = ledgerHarness({ start, activity, rules: cityRules });
    const a = activity.of('k1');
    for (let i = 0; i < 20; i++) a.offers.push({ at: new Date(at('2026-10-04T04:05:00Z').getTime() + i * 10 * 60_000), accepted: i >= 2 });
    a.cancelsAfterAccept.push({ at: at('2026-10-04T04:30:00Z'), tripId: 'tc' });
    for (const [i, done] of ['2026-10-04T04:40:00Z', '2026-10-04T05:40:00Z', '2026-10-04T11:40:00Z'].entries()) {
      a.completed.push({ at: at(done), tripId: `t${i + 1}` });
      await h.posting.orderClosed(workedExample({ orderId: `o${i + 1}`, tripId: `t${i + 1}`, courierId: 'k1', occurredAt: at(done), tipIqd: i === 0 ? 500 : 0 }));
    }
    return h;
  }

  it('live: the shift so far, with jobs to go and what it would pay', async () => {
    const h = await dayShift();
    h.clock.set('2026-10-04T05:00:00Z');
    const [w] = await h.facade.guaranteeWindows({ driverId: 'k1', from: at('2026-10-04T03:00:00Z'), to: at('2026-10-04T05:00:00Z') });
    expect(w).toMatchObject({ id: '2026-10-04:day', status: 'live', completedJobs: 1, jobsToGo: 2, qualified: false, earningsIqd: 1500, paysOn: at('2026-10-10T21:00:00Z') });
  });

  it('ended: 3,500 earned → 6,500 top-up waiting for Sunday', async () => {
    const h = await dayShift();
    h.clock.set('2026-10-04T14:00:00Z');
    const [w] = await h.guarantee.windows('k1', { from: at('2026-10-04T03:00:00Z'), to: at('2026-10-04T12:00:00Z') });
    expect(w).toMatchObject({ status: 'ended', offers: 20, accepted: 18, acceptance: 0.9, cancelsAfterAccept: 1, completedJobs: 3, earningsIqd: 3500, qualified: true, topUpIqd: 6500 });
  });

  it('nothing is paid nightly; the Sunday run pays it once (platform-funded, balanced) and it shows as paid', async () => {
    const h = await dayShift();
    h.clock.set('2026-10-05T23:00:00Z'); // Tuesday 02:00 local
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    h.clock.set('2026-10-10T23:00:00Z'); // Sunday 02:00 local
    const report = await h.nightly.run();
    expect(report.guaranteePaid).toEqual([{ driverId: 'k1', windowId: '2026-10-04:day', amountIqd: 6500 }]);
    expect(report.ok).toBe(true);
    // Posted before the weekly payout figures: his earnings balance carries the top-up (cash he holds nets against it).
    expect((await h.caps.status('k1')).earningsIqd).toBe(3500 + 6500);
    const rows = await h.ledger.eventsForGroups([guaranteeGroupId('k1', '2026-10-04:day')]);
    expect(rows).toMatchObject([{ type: 'driver_incentive', amount: 6500, fromAccount: 'platform', toAccount: 'driver:k1', memo: 'guarantee:2026-10-04:day' }]);
    // A re-run (manual, or the next Sunday re-checking the week) pays nothing twice.
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    h.clock.set('2026-10-17T23:00:00Z');
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    expect(await h.ledger.eventsForGroups([guaranteeGroupId('k1', '2026-10-04:day')])).toHaveLength(1);
    const [w] = await h.guarantee.windows('k1', { from: at('2026-10-04T03:00:00Z'), to: at('2026-10-04T12:00:00Z') });
    expect(w).toMatchObject({ status: 'paid', topUpIqd: 6500 });
  });

  /**
   * k1 in Saturday 10 Oct's evening shift (15:00 → Sunday 02:00 = 12:00Z–23:00Z): 4/4 accepted, 3 jobs
   * (the last at 01:30 Sunday, past midnight) paying 3,500; a 4th completes at 02:00 sharp, outside it.
   */
  async function saturdayEvening() {
    const activity = new ScriptedShiftActivity();
    const h = ledgerHarness({ start: '2026-10-10T12:00:00Z', activity, rules: on });
    const a = activity.of('k1');
    for (const t of ['12:30', '17:30', '21:45', '22:40']) a.offers.push({ at: at(`2026-10-10T${t}:00Z`), accepted: true });
    for (const [i, done] of ['2026-10-10T13:00:00Z', '2026-10-10T18:00:00Z', '2026-10-10T22:30:00Z', '2026-10-10T23:00:00Z'].entries()) {
      a.completed.push({ at: at(done), tripId: `e${i + 1}` });
      await h.posting.orderClosed(workedExample({ orderId: `oe${i + 1}`, tripId: `e${i + 1}`, courierId: 'k1', occurredAt: at(done), tipIqd: i === 0 ? 500 : 0 }));
    }
    return h;
  }

  it('past midnight: at 01:35 Sunday the live shift is Saturday\'s evening, with the job done after midnight', async () => {
    const h = await saturdayEvening();
    h.clock.set('2026-10-10T22:35:00Z'); // Sunday 01:35
    const ws = await h.guarantee.windows('k1', { from: at('2026-10-10T21:00:00Z'), to: at('2026-10-11T21:00:00Z') }); // Sunday's local day
    expect(ws.map((w) => [w.id, w.status, w.completedJobs])).toEqual([['2026-10-10:evening', 'live', 3]]);
    expect(ws[0]).toMatchObject({ earningsIqd: 3500, qualified: true, paysOn: at('2026-10-10T21:00:00Z') });
  });

  it('the Sunday 02:00 boundary: the run at 02:00:00 sharp pays the Saturday evening shift (02:00 is outside it), once; a run a millisecond earlier leaves it', async () => {
    const h = await saturdayEvening();
    h.clock.set('2026-10-10T22:59:59.999Z'); // Sunday 01:59:59.999: still running
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    h.clock.set('2026-10-10T23:00:00Z'); // Sunday 02:00, the nightly close
    const report = await h.nightly.run();
    expect(report.guaranteePaid).toEqual([{ driverId: 'k1', windowId: '2026-10-10:evening', amountIqd: 6500 }]);
    expect(report.ok).toBe(true);
    expect(await h.ledger.eventsForGroups([guaranteeGroupId('k1', '2026-10-10:evening')])).toMatchObject([{ amount: 6500, memo: 'guarantee:2026-10-10:evening' }]);
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    h.clock.set('2026-10-17T23:00:00Z'); // the next Sunday re-checks it: nothing twice
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    expect(await h.ledger.eventsForGroups([guaranteeGroupId('k1', '2026-10-10:evening')])).toHaveLength(1);
  });

  it('a Sunday run before 02:00 (and none at 02:00) leaves the Saturday evening shift to the next Sunday: paid late, once', async () => {
    const h = await saturdayEvening();
    h.clock.set('2026-10-10T22:00:00Z'); // Sunday 01:00, a manual run
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    h.clock.set('2026-10-17T23:00:00Z');
    expect((await h.nightly.run()).guaranteePaid).toEqual([{ driverId: 'k1', windowId: '2026-10-10:evening', amountIqd: 6500 }]);
  });

  it("Sunday's own shifts wait for the next Sunday: the evening that starts Sunday 15:00 is not the week that just ended", async () => {
    const activity = new ScriptedShiftActivity();
    const h = ledgerHarness({ start: '2026-10-11T12:00:00Z', activity, rules: on });
    const a = activity.of('k1');
    for (const [i, t] of ['12:30', '14:00', '16:00'].entries()) {
      a.offers.push({ at: at(`2026-10-11T${t}:00Z`), accepted: true });
      a.completed.push({ at: at(`2026-10-11T${t}:30Z`), tripId: `s${i}` });
      await h.posting.orderClosed(workedExample({ orderId: `os${i}`, tripId: `s${i}`, courierId: 'k1', occurredAt: at(`2026-10-11T${t}:30Z`) }));
    }
    h.clock.set('2026-10-11T23:00:00Z'); // Monday 02:00: not a Sunday run
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
    h.clock.set('2026-10-17T23:00:00Z');
    expect((await h.nightly.run()).guaranteePaid).toEqual([{ driverId: 'k1', windowId: '2026-10-11:evening', amountIqd: 7000 }]);
  });

  it('only covered roles: a car driver (cap role driver) is not paid', async () => {
    const h = await dayShift();
    h.profiles.set('k1', { role: 'driver', tier: 'bronze' });
    h.clock.set('2026-10-10T23:00:00Z');
    expect(await h.guarantee.covers('k1')).toBe(false);
    expect((await h.nightly.run()).guaranteePaid).toEqual([]);
  });

  it('Aziziyah as shipped (switched off): the same qualifying shift covers nobody, shows nothing and pays nothing', async () => {
    const h = await dayShift('2026-10-04T03:00:00Z', rules);
    h.clock.set('2026-10-10T23:00:00Z'); // Sunday 02:00 local
    expect(await h.guarantee.covers('k1')).toBe(false);
    expect(await h.facade.guaranteeCovers('k1')).toBe(false);
    const report = await h.nightly.run();
    expect(report.guaranteePaid).toEqual([]);
    expect(report.ok).toBe(true);
    expect(await h.guarantee.settle({ from: at('2026-10-04T00:00:00Z'), to: at('2026-10-10T00:00:00Z') })).toEqual([]);
    expect(await h.ledger.eventsForGroups([guaranteeGroupId('k1', '2026-10-04:day')])).toEqual([]);
    expect((await h.caps.status('k1')).earningsIqd).toBe(3500);
  });

  it('the city switch off pays nobody', async () => {
    const activity = new ScriptedShiftActivity();
    const h = ledgerHarness({ start: '2026-10-10T23:00:00Z', activity, rules: { ...rules, guarantee: { ...g, enabled: false } } });
    await h.posting.orderClosed(workedExample({ courierId: 'k1', tripId: 't1', occurredAt: at('2026-10-04T04:40:00Z') }));
    activity.of('k1').completed.push({ at: at('2026-10-04T04:40:00Z'), tripId: 't1' });
    expect(await h.guarantee.settleWeek(h.clock.now())).toEqual([]);
  });
});
