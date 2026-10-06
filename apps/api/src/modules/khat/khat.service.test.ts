import { describe, expect, it } from 'vitest';
import { KHAT_RULES, type DispatchBoard } from '@driver/contracts';
import { InMemoryQueue } from '../../shared/queue.js';
import type { DispatchService } from '../dispatch/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { PINS, tripsHarness } from '../trips/test-harness.js';
import { InMemoryKhatRepository } from './khat.repository.js';
import { KhatService, type SweepCheckJob } from './khat.service.js';

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

describe('khat.confirmEmptyCar (partner S-6 sweep)', () => {
  it('is refused while a child is still in the car, then logged once for ops with the counts', async () => {
    const h = await setup();
    const [p1, p2, d1, d2] = h.trip.stops;
    await h.khat.tapIn(h.driver, { tripId: h.trip.id, stopId: p1!.id, pin: PINS.home });
    await h.khat.tapIn(h.driver, { tripId: h.trip.id, stopId: p2!.id, pin: PINS.home2 });
    await h.khat.tapOut(h.driver, { tripId: h.trip.id, stopId: d1!.id, pin: PINS.school });
    // علي is still on board: no sweep yet.
    await expect(h.khat.confirmEmptyCar(h.driver, { tripId: h.trip.id })).rejects.toMatchObject({ code: 'khat_run_not_finished' });
    expect((await h.khat.todayRun(h.driver, {})).trips[0]!.emptyCarCheckedAt).toBeNull();
    await h.khat.tapOut(h.driver, { tripId: h.trip.id, stopId: d2!.id, pin: PINS.school });
    h.t.clock.advance(90_000);
    const done = await h.khat.confirmEmptyCar(h.driver, { tripId: h.trip.id });
    expect(done.emptyCarCheckedAt).toEqual(h.t.clock.now());
    // Replaying the slide changes nothing: one event, the first time kept.
    h.t.clock.advance(60_000);
    expect((await h.khat.confirmEmptyCar(h.driver, { tripId: h.trip.id })).emptyCarCheckedAt).toEqual(done.emptyCarCheckedAt);
    const logged = (await h.ev.events.forTrip(h.trip.id)).filter((e) => e.type === 'khat.empty_car_confirmed');
    expect(logged).toHaveLength(1);
    expect(logged[0]!.payload).toMatchObject({ tripId: h.trip.id, driverId: h.driver.personId, childrenTotal: 2, delivered: 2, absent: 0, secondsAfterLastDrop: 90 });
    expect(JSON.stringify(logged[0]!.payload)).not.toContain('علي');
  });

  it('counts an absent child as settled, and only the run’s own driver may confirm', async () => {
    const h = await setup();
    const [p1, , d1] = h.trip.stops;
    await h.khat.reportAbsence(h.driver, { tripId: h.trip.id, childRef: h.ali, reason: 'sick' });
    await h.khat.tapIn(h.driver, { tripId: h.trip.id, stopId: p1!.id, pin: PINS.home });
    await h.khat.tapOut(h.driver, { tripId: h.trip.id, stopId: d1!.id, pin: PINS.school });
    await expect(h.khat.confirmEmptyCar(h.guardian, { tripId: h.trip.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await h.khat.confirmEmptyCar(h.driver, { tripId: h.trip.id })).emptyCarCheckedAt).not.toBeNull();
  });
});

describe('khat.callGuardian', () => {
  it("opens a masked call to the child's guardian, logs the vault read and the call, never a number in the event", async () => {
    const h = await setup();
    const opened: Array<{ callerId: string; calleeId: string; orderId: string }> = [];
    const calls = {
      open: async (req: { callId: string; orderId: string; callerId: string; calleeId: string }, now: Date) => {
        opened.push(req);
        return { mode: 'proxy' as const, dial: '+9647800000000', expiresAt: new Date(now.getTime() + 120_000) };
      },
    };
    const khat = new KhatService(h.repo, h.t.trips, h.id.service, {} as DispatchService, h.ev.events, h.t.uow, h.t.clock, calls);
    const s = await khat.callGuardian(h.driver, { tripId: h.trip.id, childRef: h.zainab });
    expect(s).toMatchObject({ mode: 'proxy', dial: '+9647800000000', counterpart: 'customer' });
    expect(opened).toEqual([expect.objectContaining({ orderId: h.trip.id, callerId: h.driver.personId, calleeId: h.guardian.personId })]);
    expect(h.id.repo.accessLogs.some((l) => l.accessorId === h.driver.personId && l.purpose === 'khat_guardian_call' && l.childRef === h.zainab)).toBe(true);
    const ev = (await h.ev.events.forTrip(h.trip.id)).find((e) => e.type === 'khat.guardian_call_requested');
    expect(ev?.payload).toMatchObject({ childRef: h.zainab, mode: 'proxy' });
    expect(JSON.stringify(ev?.payload)).not.toContain('+964');
    // Not his run, not on the run, or no bridge: refused.
    await expect(khat.callGuardian(h.guardian, { tripId: h.trip.id, childRef: h.zainab })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(khat.callGuardian(h.driver, { tripId: h.trip.id, childRef: 'chref_nope' })).rejects.toMatchObject({ code: 'khat_child_not_on_trip' });
    await expect(h.khat.callGuardian(h.driver, { tripId: h.trip.id, childRef: h.zainab })).rejects.toMatchObject({ code: 'call_unavailable' });
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

/**
 * The late sweep (Ali, 2026-10-06): the run's last child stop settled, `sweepAlertAfterMin` passed
 * and no "تأكدت، السيارة فاضية" → one alert for the Console and the driver's reminder; the late
 * confirm clears it.
 */
describe('khat sweep alert', () => {
  const MIN = 60_000;
  const AFTER = KHAT_RULES.sweepAlertAfterMin * MIN;

  async function sweepSetup() {
    const h = await setup();
    const queue = new InMemoryQueue<SweepCheckJob>('khat.timers', () => h.t.clock.now());
    const opened: Array<{ orderId: string; callerId: string; calleeId: string }> = [];
    const calls = {
      open: async (req: { callId: string; orderId: string; callerId: string; calleeId: string }, now: Date) => {
        opened.push(req);
        return { mode: 'proxy' as const, dial: '+9647800000000', expiresAt: new Date(now.getTime() + 120_000) };
      },
    };
    const khat = new KhatService(h.repo, h.t.trips, h.id.service, {} as DispatchService, h.ev.events, h.t.uow, h.t.clock, calls, queue);
    khat.onModuleInit();
    const dispatcher = (await h.id.login('07700000900')).actor;
    const [p1, p2, d1, d2] = h.trip.stops;
    /** Both children in at home, out at school; returns when the last one got out. */
    const finishRun = async () => {
      await khat.tapIn(h.driver, { tripId: h.trip.id, stopId: p1!.id, pin: PINS.home });
      await khat.tapIn(h.driver, { tripId: h.trip.id, stopId: p2!.id, pin: PINS.home2 });
      await khat.tapOut(h.driver, { tripId: h.trip.id, stopId: d1!.id, pin: PINS.school });
      h.t.clock.advance(30_000);
      await khat.tapOut(h.driver, { tripId: h.trip.id, stopId: d2!.id, pin: PINS.school });
      return h.t.clock.now();
    };
    /** Moves the clock and runs every sweep check now due. */
    const advance = async (ms: number) => {
      h.t.clock.advance(ms);
      return queue.drain();
    };
    const missed = async () => (await h.ev.events.forTrip(h.trip.id)).filter((e) => e.type === 'khat.sweep_missed');
    return { ...h, khat, queue, opened, dispatcher, finishRun, advance, missed };
  }

  it(`fires ${KHAT_RULES.sweepAlertAfterMin} minutes after the last drop when the car was not checked`, async () => {
    const h = await sweepSetup();
    const lastDrop = await h.finishRun();
    // Not a second before.
    await h.advance(AFTER - 1_000);
    expect(await h.missed()).toEqual([]);
    expect(await h.khat.sweepAlerts(h.dispatcher, { cityId: 'aziziyah' })).toEqual([]);
    expect(await h.advance(1_000)).toBe(1);
    const [ev] = await h.missed();
    // The event carries the driver: the notify subscriber turns it into his reminder push.
    expect(ev?.payload).toMatchObject({ tripId: h.trip.id, driverId: h.driver.personId, runEndedAt: lastDrop.toISOString(), afterMin: KHAT_RULES.sweepAlertAfterMin });
    const alerts = await h.khat.sweepAlerts(h.dispatcher, { cityId: 'aziziyah' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ tripId: h.trip.id, driver: { personId: h.driver.personId }, childrenTotal: 2, lastDropAt: lastDrop, lastDropZone: 'centre', runEndedAt: lastDrop, raisedAt: h.t.clock.now(), confirmedAt: null, confirmedLateMin: null });
    expect(alerts[0]!.driver.phoneMasked).toMatch(/\*{3,}/);
    // Never a child's name on the Console's alert; the driver's card is a logged vault read for the dispatcher.
    expect(JSON.stringify(alerts)).not.toMatch(/زينب|علي/);
    expect(h.id.repo.accessLogs.some((l) => l.accessorId === h.dispatcher.personId && l.purpose === 'khat_sweep_alert')).toBe(true);
    // Another city's desk sees nothing.
    expect(await h.khat.sweepAlerts(h.dispatcher, { cityId: 'kut' })).toEqual([]);
  });

  it('does not fire when the driver checked the car in time', async () => {
    const h = await sweepSetup();
    await h.finishRun();
    await h.advance(2 * MIN);
    await h.khat.confirmEmptyCar(h.driver, { tripId: h.trip.id });
    await h.advance(AFTER);
    expect(await h.missed()).toEqual([]);
    expect(await h.khat.sweepAlerts(h.dispatcher, { cityId: 'aziziyah' })).toEqual([]);
    expect(await h.khat.checkSweep(h.trip.id)).toBe('swept');
  });

  it('fires once per run, however often the check runs', async () => {
    const h = await sweepSetup();
    await h.finishRun();
    await h.advance(AFTER);
    expect(await h.khat.checkSweep(h.trip.id)).toBe('already');
    await h.khat.armSweepTimer(h.trip.id);
    await h.advance(AFTER);
    expect(await h.missed()).toHaveLength(1);
    expect(h.repo.sweepAlerts).toHaveLength(1);
  });

  it("is cleared by the driver's late confirm, shows how late, then leaves the strip", async () => {
    const h = await sweepSetup();
    const lastDrop = await h.finishRun();
    await h.advance(AFTER);
    // He slides "تأكدت" 7 minutes after the last child got out.
    h.t.clock.set(lastDrop.getTime() + 7 * MIN + 20_000);
    await h.khat.confirmEmptyCar(h.driver, { tripId: h.trip.id });
    const [alert] = await h.khat.sweepAlerts(h.dispatcher, { cityId: 'aziziyah' });
    expect(alert).toMatchObject({ confirmedAt: h.t.clock.now(), confirmedLateMin: 7 });
    const cleared = (await h.ev.events.forTrip(h.trip.id)).filter((e) => e.type === 'khat.sweep_alert_cleared');
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.payload).toMatchObject({ alertId: alert!.alertId, lateMin: 7 });
    // A repeated slide changes nothing.
    h.t.clock.advance(MIN);
    await h.khat.confirmEmptyCar(h.driver, { tripId: h.trip.id });
    expect((await h.khat.sweepAlerts(h.dispatcher, { cityId: 'aziziyah' }))[0]).toMatchObject({ confirmedLateMin: 7 });
    // Gone from the strip after `sweepClearedShowMin`; the record stays.
    h.t.clock.advance(KHAT_RULES.sweepClearedShowMin * MIN);
    expect(await h.khat.sweepAlerts(h.dispatcher, { cityId: 'aziziyah' })).toEqual([]);
    expect(h.repo.sweepAlerts[0]!.confirmedAt).not.toBeNull();
  });

  it('leaves a run alone where no child got in (everyone absent)', async () => {
    const h = await sweepSetup();
    await h.khat.reportAbsence(h.driver, { tripId: h.trip.id, childRef: h.zainab, reason: 'sick' });
    await h.khat.reportAbsence(h.driver, { tripId: h.trip.id, childRef: h.ali, reason: 'guardian_notice' });
    await h.advance(AFTER);
    expect(await h.khat.checkSweep(h.trip.id)).toBe('not_applicable');
    expect(await h.missed()).toEqual([]);
  });

  it("calls the driver from the alert through the masked bridge (on the run's timeline, no number in the event)", async () => {
    const h = await sweepSetup();
    await h.finishRun();
    await h.advance(AFTER);
    const [alert] = await h.khat.sweepAlerts(h.dispatcher, { cityId: 'aziziyah' });
    const s = await h.khat.callSweepDriver(h.dispatcher, { alertId: alert!.alertId });
    expect(s).toMatchObject({ mode: 'proxy', dial: '+9647800000000' });
    expect(h.opened).toEqual([expect.objectContaining({ orderId: h.trip.id, callerId: h.dispatcher.personId, calleeId: h.driver.personId })]);
    const ev = (await h.ev.events.forTrip(h.trip.id)).find((e) => e.type === 'khat.sweep_call_requested');
    expect(ev?.payload).toMatchObject({ alertId: alert!.alertId, mode: 'proxy' });
    expect(JSON.stringify(ev?.payload)).not.toContain('+964');
    await expect(h.khat.callSweepDriver(h.dispatcher, { alertId: 'ksw_nope' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
