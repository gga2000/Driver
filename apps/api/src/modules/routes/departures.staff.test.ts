import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { DEFAULT_GARAGE_WATCH_RULES, DeparturesStaffService, garageWatchRulesFromEnv, type DepartureAuditPort, type GarageWatchRules } from './departures.staff.js';
import { BAB2, routesHarness } from './test-harness.js';

const ops = { personId: 'ops1', sessionId: 's' };
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof DriverError ? e.code : String(e)));

function make(rules: Partial<GarageWatchRules> = {}) {
  const h = routesHarness();
  const audits: Array<Parameters<DepartureAuditPort['record']>[0]> = [];
  const audit: DepartureAuditPort = {
    record: async (input) => {
      audits.push(input);
      return { id: `audit_${audits.length}` };
    },
  };
  const staff = new DeparturesStaffService(h.departures, audit, { ...DEFAULT_GARAGE_WATCH_RULES, ...rules });
  return { ...h, staff, audits };
}

describe('garage watch rules (M-11)', () => {
  it('auto-cancel is off by default and only GARAGE_NO_SHOW_AUTO_CANCEL turns it on', () => {
    expect(DEFAULT_GARAGE_WATCH_RULES).toEqual({ noShowAfterMin: 20, overdueAfterMin: 30, autoCancelNoShow: false });
    expect(garageWatchRulesFromEnv({}).autoCancelNoShow).toBe(false);
    expect(garageWatchRulesFromEnv({ GARAGE_NO_SHOW_AUTO_CANCEL: 'on' }).autoCancelNoShow).toBe(true);
    expect(garageWatchRulesFromEnv({ GARAGE_NO_SHOW_AUTO_CANCEL: 'off' }).autoCancelNoShow).toBe(false);
  });
});

describe('a driver who never came (NTF-14)', () => {
  it('shows on the overdue list 20 min after the latest departure time; with the switch off nothing cancels by itself', async () => {
    const h = make();
    const dep = await h.announce(); // departs +120, latest +150
    await h.book('r1', dep.id, ['front']);
    h.advance(169);
    expect(await h.staff.overdue({ limit: 10 })).toEqual([]);
    h.advance(2);
    expect(await h.staff.overdue({ limit: 10 })).toEqual([
      expect.objectContaining({ departureId: dep.id, reason: 'driver_no_show', minutes: 1, riders: 1, actions: ['cancel'], driverId: 'd1' }),
    ]);
    expect(await h.staff.sweep()).toBe(0);
    expect((await h.departures.departure(dep.id)).state).toBe('scheduled');
    expect(h.audits).toEqual([]);
  });

  it('staff cancel: riders moved to the next car, no fee and no credit, one audit row; a replay writes nothing', async () => {
    const h = make();
    const dep = await h.announce();
    const next = await h.announce({ driverId: 'd2', garageId: BAB2.id, departAt: h.at(200), latestDepartureAt: h.at(230) });
    await h.book('r1', dep.id, ['back_left']);
    h.advance(171);
    const r = await h.staff.cancel(ops, { departureId: dep.id, reason: 'السايق ما يرد' });
    expect(r).toEqual({ departureId: dep.id, state: 'cancelled_by_driver', changed: true, auditId: 'audit_1' });
    expect((await h.departures.bookings(next.id)).map((b) => [b.riderId, b.state, b.origin])).toEqual([['r1', 'booked', 'moved']]);
    expect(h.events.last('departure.cancelled')?.payload).toMatchObject({ cancelledBy: 'driver', feeIqd: 0, riderIds: ['r1'], driverId: 'd1' });
    expect(h.events.last('departure.ops_cancelled')?.payload).toMatchObject({ reason: 'السايق ما يرد', auto: false, riders: 1 });
    expect(h.events.types()).not.toContain('departure.driver_cancelled_late');
    expect(h.audits).toEqual([expect.objectContaining({ actorId: 'ops1', action: 'departure.ops_cancel', subjectKind: 'departure', subjectId: dep.id })]);
    expect(await h.staff.cancel(ops, { departureId: dep.id, reason: 'مرة ثانية' })).toMatchObject({ changed: false, auditId: null });
    expect(h.audits).toHaveLength(1);
    expect(await h.staff.overdue({ limit: 10 })).toEqual([]);
  });

  it('switch on: the watch cancels a no-show departure once, as system, with its audit row', async () => {
    const h = make({ autoCancelNoShow: true });
    const dep = await h.announce();
    await h.book('r1', dep.id, ['front']);
    h.advance(160);
    expect(await h.staff.sweep()).toBe(0);
    h.advance(11);
    expect(await h.staff.sweep()).toBe(1);
    expect((await h.departures.departure(dep.id)).state).toBe('cancelled_by_driver');
    expect(h.events.last('departure.ops_cancelled')?.payload).toMatchObject({ auto: true });
    expect(h.events.last('departure.cancelled')?.payload).toMatchObject({ feeIqd: 0 });
    expect(h.audits).toEqual([expect.objectContaining({ actorId: 'system', action: 'departure.ops_cancel', detail: expect.objectContaining({ auto: true }) })]);
    expect(await h.staff.sweep()).toBe(0);
  });
});

describe('a driver who never pressed «وصلت» (NTF-14) and closing (NTF-10)', () => {
  it('overdue past travel time + 30; staff arrive completes and settles every checked-in seat; close ends it now', async () => {
    const h = make();
    const dep = await h.announce();
    const a = await h.book('r1', dep.id, ['front']);
    const b = await h.book('r2', dep.id, ['back_left', 'back_middle'], { payment: 'cash' });
    const c = await h.book('r3', dep.id, ['back_right']);
    await h.driverAt(dep.id);
    for (const x of [a, b, c]) await h.checkIn(dep.id, x.id);
    await h.departures.depart('d1', dep.id);
    expect(await code(h.staff.close(ops, { departureId: dep.id, reason: 'مبكر' }))).toBe('departure_state_conflict');
    const travel = h.departures.corridor(dep.corridorId).travelMin;
    h.advance(travel + 29);
    expect(await h.staff.overdue({ limit: 10 })).toEqual([]);
    h.advance(2);
    expect(await h.staff.overdue({ limit: 10 })).toEqual([expect.objectContaining({ departureId: dep.id, reason: 'not_arrived', riders: 3, actions: ['arrive'] })]);

    const r = await h.staff.arrive(ops, { departureId: dep.id, reason: 'الركاب اتصلوا وصلنا' });
    expect(r).toMatchObject({ state: 'arrived', changed: true });
    expect(h.events.ofType('seat.completed')).toHaveLength(4);
    expect(h.events.last('departure.arrived')?.actorId).toBe('ops1');
    expect((await h.departures.bookings(dep.id)).every((x) => x.state === 'completed')).toBe(true);
    expect(await h.staff.arrive(ops, { departureId: dep.id, reason: 'مرة ثانية' })).toMatchObject({ changed: false });
    expect(h.events.ofType('seat.completed')).toHaveLength(4);

    expect(await h.staff.close(ops, { departureId: dep.id, reason: 'خلصت' })).toMatchObject({ state: 'closed', changed: true });
    expect(await h.staff.close(ops, { departureId: dep.id, reason: 'خلصت' })).toMatchObject({ changed: false });
    expect(h.audits.map((x) => x.action)).toEqual(['departure.ops_arrive', 'departure.ops_close']);
  });

  it('staff arrive refuses a departure still at the garage; staff cancel refuses one already on the road', async () => {
    const h = make();
    const dep = await h.announce();
    expect(await code(h.staff.arrive(ops, { departureId: dep.id, reason: 'غلط' }))).toBe('departure_state_conflict');
    const a = await h.book('r1', dep.id, ['front']);
    const b = await h.book('r2', dep.id, ['back_left', 'back_middle'], { payment: 'cash' });
    const c = await h.book('r3', dep.id, ['back_right']);
    await h.driverAt(dep.id);
    for (const x of [a, b, c]) await h.checkIn(dep.id, x.id);
    await h.departures.depart('d1', dep.id);
    expect(await code(h.staff.cancel(ops, { departureId: dep.id, reason: 'غلط' }))).toBe('departure_state_conflict');
    expect(h.audits).toEqual([]);
  });
});

describe('routes rpc without the staff service', () => {
  it('the procedures refuse instead of pretending', async () => {
    const h = make();
    expect(await code(h.rpc.overdueDepartures(ops, { limit: 5 }))).toBe('internal');
  });
});
