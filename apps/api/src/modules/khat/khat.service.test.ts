import { describe, expect, it } from 'vitest';
import type { DispatchBoard } from '@driver/contracts';
import type { DispatchService } from '../dispatch/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { PINS, tripsHarness } from '../trips/test-harness.js';
import { InMemoryKhatRepository } from './khat.repository.js';
import { KhatService } from './khat.service.js';

/** A morning خطوط run: two children picked up at home, both dropped at school. */
async function setup() {
  const t = tripsHarness('2026-10-04T04:00:00Z'); // 07:00 Baghdad
  const id = identityHarness('2026-10-04T04:00:00Z');
  const ev = createInMemoryEvents({ clock: t.clock });
  const guardian = (await id.login('07700000100')).actor;
  const driver = (await id.login('07700000200')).actor;
  const zainab = (await id.service.registerChild(guardian, { name: 'زينب علي حسين' })).childRef;
  const ali = (await id.service.registerChild(guardian, { name: 'علي حسن' })).childRef;
  const w = (min: number) => new Date(t.clock.now().getTime() + min * 60_000);
  const trip = await t.trips.createForOrders({
    cityId: 'aziziyah',
    vertical: 'khat',
    orders: [],
    stops: [
      { type: 'pickup', zoneKey: 'zakur', target: PINS.home, childRef: zainab, windowStart: w(10), windowEnd: w(15) },
      { type: 'pickup', zoneKey: 'zakur', target: PINS.home2, childRef: ali, windowStart: w(15), windowEnd: w(20) },
      { type: 'dropoff', zoneKey: 'centre', target: PINS.school, childRef: zainab, windowStart: w(30), windowEnd: w(35) },
      { type: 'dropoff', zoneKey: 'centre', target: PINS.school, childRef: ali, windowStart: w(30), windowEnd: w(35) },
    ],
  });
  await t.trips.offer(trip.id, { driverIds: [driver.personId] });
  await t.trips.accept(trip.id, driver.personId, { vehicleClass: 'van' });
  const board: DispatchBoard = { cityId: 'aziziyah', at: t.clock.now(), policies: [], cards: [] };
  const responses: Array<{ offerId: string; accept: boolean }> = [];
  const dispatch = {
    board: async () => board,
    respond: async (_a: unknown, input: { offerId: string; accept: boolean }) => {
      responses.push(input);
      return { outcome: 'assigned' as const, tripId: trip.id, compensationIqd: 0 };
    },
  } as unknown as DispatchService;
  const repo = new InMemoryKhatRepository();
  const khat = new KhatService(repo, t.trips, id.service, dispatch, ev.events, t.uow, t.clock);
  return { t, id, ev, khat, repo, guardian, driver, zainab, ali, trip, board, responses };
}

describe('khat.todayRun', () => {
  it("lists today's run with children by FIRST name only, every vault read logged for the driver", async () => {
    const h = await setup();
    const run = await h.khat.todayRun(h.driver, {});
    expect(run.localDate).toBe('2026-10-04');
    expect(run.trips).toHaveLength(1);
    const r = run.trips[0]!;
    expect(r.childrenTotal).toBe(2);
    expect(r.stops.map((s) => s.child?.firstName)).toEqual(['زينب', 'علي', 'زينب', 'علي']);
    expect(JSON.stringify(run)).not.toContain('حسين');
    const logs = h.id.repo.accessLogs.filter((l) => l.accessorId === h.driver.personId && l.purpose === 'khat_today_run');
    expect(new Set(logs.map((l) => l.childRef))).toEqual(new Set([h.zainab, h.ali]));
    // Another day: nothing; another driver: nothing.
    expect((await h.khat.todayRun(h.driver, { date: new Date('2026-10-05T05:00:00Z') })).trips).toEqual([]);
    expect((await h.khat.todayRun(h.guardian, {})).trips).toEqual([]);
  });
});

describe('khat.tapIn / tapOut', () => {
  it('taps each child in at home and out at school; the guardian push rides on the school tap-out', async () => {
    const h = await setup();
    const [p1, , d1] = h.trip.stops;
    const after = await h.khat.tapIn(h.driver, { tripId: h.trip.id, stopId: p1!.id, pin: PINS.home });
    expect(after.onBoard).toBe(1);
    expect(after.stops[0]!.tappedInAt).not.toBeNull();
    // A pickup stop cannot be tapped out, a dropoff cannot be tapped in.
    await expect(h.khat.tapOut(h.driver, { tripId: h.trip.id, stopId: p1!.id })).rejects.toMatchObject({ code: 'khat_not_child_stop' });
    await expect(h.khat.tapIn(h.driver, { tripId: h.trip.id, stopId: d1!.id })).rejects.toMatchObject({ code: 'khat_not_child_stop' });
    const out = await h.khat.tapOut(h.driver, { tripId: h.trip.id, stopId: d1!.id, pin: PINS.school });
    expect(out.delivered).toBe(1);
    expect(out.onBoard).toBe(0);
    const tapOut = h.t.events.events.find((e) => e.type === 'khat.child_tapped_out');
    expect(tapOut?.payload).toMatchObject({ childRef: h.zainab, notifyGuardian: true });
    // Replaying the tap is a no-op.
    expect((await h.khat.tapOut(h.driver, { tripId: h.trip.id, stopId: d1!.id })).delivered).toBe(1);
  });

  it('never taps a child out at school who was not tapped in at home (review 2026-10-04 #4)', async () => {
    const h = await setup();
    const [, , d1] = h.trip.stops;
    await expect(h.khat.tapOut(h.driver, { tripId: h.trip.id, stopId: d1!.id, pin: PINS.school })).rejects.toMatchObject({ code: 'khat_child_not_tapped_in' });
    // Nor straight through trips.completeStop with a hand-made child tap.
    await h.t.trips.arrive(h.trip.id, d1!.id, h.driver.personId, { pin: PINS.school });
    await expect(h.t.trips.completeStop(h.trip.id, d1!.id, h.driver.personId, { handover: { childTap: 'out' } })).rejects.toMatchObject({ code: 'khat_child_not_tapped_in' });
    // No "arrived" push went to the guardian.
    expect(h.t.events.events.some((e) => e.type === 'khat.child_tapped_out')).toBe(false);
  });

  it('only the run’s own driver may tap', async () => {
    const h = await setup();
    await expect(h.khat.tapIn(h.guardian, { tripId: h.trip.id, stopId: h.trip.stops[0]!.id })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('khat.reportAbsence', () => {
  it("skips the child's stops, records it once, emits the event and blocks taps for that child", async () => {
    const h = await setup();
    const a = await h.khat.reportAbsence(h.driver, { tripId: h.trip.id, childRef: h.ali, reason: 'guardian_notice' });
    expect(a.skippedStopIds).toEqual([h.trip.stops[1]!.id, h.trip.stops[3]!.id]);
    expect((await h.khat.reportAbsence(h.driver, { tripId: h.trip.id, childRef: h.ali, reason: 'sick' })).absenceId).toBe(a.absenceId);
    const run = (await h.khat.todayRun(h.driver, {})).trips[0]!;
    expect(run.absent).toBe(1);
    expect(run.stops.filter((s) => s.absent).map((s) => s.state)).toEqual(['skipped', 'skipped']);
    expect((await h.ev.events.forTrip(h.trip.id)).map((e) => e.type)).toContain('khat.absence_reported');
    await expect(h.khat.tapIn(h.driver, { tripId: h.trip.id, stopId: h.trip.stops[1]!.id })).rejects.toMatchObject({ code: 'khat_child_absent' });
  });

  it('refuses a child not on the run and a child already on board', async () => {
    const h = await setup();
    await expect(h.khat.reportAbsence(h.driver, { tripId: h.trip.id, childRef: 'chref_nope', reason: 'other' })).rejects.toMatchObject({ code: 'khat_child_not_on_trip' });
    await h.khat.tapIn(h.driver, { tripId: h.trip.id, stopId: h.trip.stops[0]!.id });
    await expect(h.khat.reportAbsence(h.driver, { tripId: h.trip.id, childRef: h.zainab, reason: 'not_at_stop' })).rejects.toMatchObject({ code: 'stop_state_conflict' });
  });
});

describe('khat substitutes', () => {
  it("lists only this driver's open offers on khat cards, and accepting goes through dispatch.respond", async () => {
    const h = await setup();
    const offer = (driverId: string, state: 'sent' | 'seen' | 'declined') => ({ offerId: `of_${driverId}_${state}`, driverId, wave: 1, pass: 2, state, compensationIqd: 0, expiresInSec: 240 });
    const card = { tripId: h.trip.id, zoneId: 'zakur', policy: 'pre_assigned' as const, status: 'searching' as const, status_ar: '', wave: 1, pass: 2, elapsedSec: 10, countdownSec: 240, red: false, compensationLabel_ar: null, customerMayCancelFree: false, assignedDriverId: null, suggestion: [] };
    h.board.cards.push({ ...card, vertical: 'khat', offers: [offer(h.driver.personId, 'sent'), offer('someone_else', 'sent'), offer(h.driver.personId, 'declined')] });
    h.board.cards.push({ ...card, vertical: 'food', offers: [offer(h.driver.personId, 'seen')] });
    const offers = await h.khat.substituteOffers(h.driver, { cityId: 'aziziyah' });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ offerId: `of_${h.driver.personId}_sent`, tripId: h.trip.id, stopsCount: 4, childrenCount: 2, zones: ['zakur', 'centre'] });
    expect(await h.khat.acceptSubstitute(h.driver, { offerId: offers[0]!.offerId })).toEqual({ outcome: 'assigned', tripId: h.trip.id });
    expect(h.responses).toEqual([{ offerId: offers[0]!.offerId, accept: true }]);
  });
});
