import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, rideSearchStartsAt } from '@driver/contracts';
import { BOOKED_OFFER_POLICY, FAVOURITE_OFFER_POLICY } from './offer.orchestrator.js';
import { dispatchHarness, north } from './test-harness.js';

type H = ReturnType<typeof dispatchHarness>;

/** Wednesday 14:00 Baghdad; the ride is Thursday 05:00 (review #28's case: nobody online at 05:00). */
const NOW = '2026-10-07T11:00:00Z';
const T = new Date('2026-10-08T02:00:00Z');
const OPEN = '2026-10-07T15:00:00Z'; // 18:00 the evening before
const FAV_END = '2026-10-07T16:00:00Z';
const DEADLINE = '2026-10-07T19:00:00Z'; // 22:00
const REMIND = '2026-10-08T01:00:00Z'; // T−60
const SHOW = '2026-10-08T01:30:00Z'; // T−30

async function fleet(h: H) {
  for (const [id, km] of [['d1', 0.2], ['d2', 0.5], ['fav', 2.5]] as const) {
    await h.online(id, km);
    h.keepAlive.add(id);
  }
}

function book(h: H, extra: Record<string, unknown> = {}, at: Date = T, tripId = 't1', orderId = 'o1') {
  return h.service.request({ tripId, orderId, cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0), startAt: rideSearchStartsAt(at), scheduledFor: at, ...extra });
}

/** Minute steps (presence heartbeats in each), running every timer as it falls due. */
async function runTo(h: H, iso: string) {
  const until = Date.parse(iso);
  while (h.clock.now().getTime() < until) {
    h.clock.advanceSeconds(Math.min(60, (until - h.clock.now().getTime()) / 1000));
    await h.heartbeatAll([...h.keepAlive]);
    await h.queue.drain();
  }
}

const booked = async (h: H, tripId = 't1') => (await h.service.getRequest(tripId))?.booked;
const openIds = async (h: H, driverId: string) => (await h.service.bookedJobs(driverId, 'aziziyah')).open.map((i) => i.request.tripId);
const mineIds = async (h: H, driverId: string) => (await h.service.bookedJobs(driverId, 'aziziyah')).mine.map((i) => i.request.tripId);

describe('evening-before booked rides (review #28)', () => {
  it('offered → confirmed → reminded → started: the confirmed driver gets the trip at T−30, nobody else is asked', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h);
    expect(await booked(h)).toMatchObject({ state: 'waiting', offerAt: Date.parse(OPEN), confirmBy: Date.parse(DEADLINE) });
    expect(await openIds(h, 'd1')).toEqual([]);

    await runTo(h, OPEN);
    expect(h.events.last('dispatch.booked_opened')?.payload).toMatchObject({ orderId: 'o1', driverIds: ['d1', 'd2', 'fav'] });
    expect(await openIds(h, 'd1')).toEqual(['t1']);

    await h.service.answerBookedJob('d1', 't1', 'confirm');
    expect(h.events.last('dispatch.booked_confirmed')?.payload).toMatchObject({ orderId: 'o1', driverId: 'd1', favourite: false });
    await expect(h.service.answerBookedJob('d2', 't1', 'confirm')).rejects.toMatchObject({ code: 'booked_job_taken' });
    expect(await openIds(h, 'd2')).toEqual([]);
    expect(await mineIds(h, 'd1')).toEqual(['t1']);

    await runTo(h, REMIND);
    expect(h.events.ofType('dispatch.booked_unconfirmed')).toHaveLength(0);
    expect((await booked(h))?.state).toBe('reminded');
    expect(h.events.last('dispatch.booked_reminder')?.payload).toMatchObject({ orderId: 'o1', driverId: 'd1', showBy: SHOW.replace('Z', '.000Z') });
    expect(h.trips.offers).toEqual([]);

    await runTo(h, SHOW);
    expect(h.trips.offers).toEqual([{ tripId: 't1', driverIds: ['d1'], timeoutSec: 15 }]);
    expect(h.trips.assigns).toEqual([{ tripId: 't1', driverId: 'd1', compensationIqd: 0, batchWith: [] }]);
    const r = await h.service.getRequest('t1');
    expect(r).toMatchObject({ status: 'assigned', assignedDriverId: 'd1' });
    expect(r?.booked?.state).toBe('started');
    expect(h.events.last('dispatch.assigned')?.payload).toMatchObject({ driverId: 'd1', policy: BOOKED_OFFER_POLICY });

    // The confirmed driver has it: no «دا ندورلك سايق» push.
    expect(h.events.ofType('dispatch.booked_search_started')).toHaveLength(0);
    await runTo(h, '2026-10-08T02:10:00Z');
    expect(h.trips.offers).toHaveLength(1);
    expect(h.trips.assigns).toHaveLength(1);
  });

  it('nobody confirmed by 22:00: the rider is told, and the normal search starts at T−30', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h);
    await runTo(h, DEADLINE);
    expect(h.events.ofType('dispatch.booked_unconfirmed').map((e) => e.payload)).toEqual([
      expect.objectContaining({ orderId: 'o1', searchAt: SHOW.replace('Z', '.000Z') }),
    ]);
    await expect(h.service.answerBookedJob('d1', 't1', 'confirm')).rejects.toMatchObject({ code: 'booked_job_closed' });
    await runTo(h, '2026-10-08T01:29:00Z');
    expect(h.trips.offers).toEqual([]);
    expect(h.events.ofType('dispatch.booked_search_started')).toHaveLength(0);
    await runTo(h, SHOW);
    // NTF-05: the rider hears that the search for his driver started.
    expect(h.events.ofType('dispatch.booked_search_started').map((e) => e.payload)).toEqual([expect.objectContaining({ orderId: 'o1', scheduledFor: T.toISOString() })]);
    expect(h.trips.offers[0]).toEqual({ tripId: 't1', driverIds: ['d1', 'd2'], timeoutSec: 15 });
    expect((await h.offers('t1')).every((o) => o.compensationIqd === 0)).toBe(true);
  });

  it('released before 22:00: back on offer for the others (not him), and one of them takes it', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h);
    await runTo(h, OPEN);
    await h.service.answerBookedJob('d1', 't1', 'confirm');
    await runTo(h, '2026-10-07T16:30:00Z');
    await h.service.answerBookedJob('d1', 't1', 'release');
    expect(h.events.last('dispatch.booked_released')?.payload).toMatchObject({ driverId: 'd1', reason: 'driver', reopened: true });
    expect(h.events.last('dispatch.booked_opened')?.payload).toMatchObject({ driverIds: ['d2', 'fav'] });
    expect(await openIds(h, 'd1')).toEqual([]);
    await expect(h.service.answerBookedJob('d1', 't1', 'confirm')).rejects.toMatchObject({ code: 'booked_job_closed' });
    await h.service.answerBookedJob('d2', 't1', 'confirm');
    await runTo(h, SHOW);
    expect(h.trips.assigns.map((a) => a.driverId)).toEqual(['d2']);
  });

  it('released after 22:00: the T−30 search, and a favourite who dropped it is not asked first', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h, { preferDriverIds: ['fav'] });
    await runTo(h, OPEN);
    await h.service.answerBookedJob('fav', 't1', 'confirm');
    await runTo(h, '2026-10-07T20:00:00Z');
    await h.service.answerBookedJob('fav', 't1', 'release');
    expect((await booked(h))?.state).toBe('released');
    expect(h.events.last('dispatch.booked_released')?.payload).toMatchObject({ reopened: false });
    expect(await openIds(h, 'd1')).toEqual([]);
    await runTo(h, SHOW);
    const first = (await h.offers('t1'))[0];
    expect(first?.policy).toBe('smart_broadcast');
    expect(h.trips.offers[0]?.driverIds).toEqual(['d1', 'd2']);
  });

  it('no-show at T−30 (offline): released, the rider hears it, the search starts at once', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h);
    await runTo(h, OPEN);
    await h.service.answerBookedJob('d1', 't1', 'confirm');
    await runTo(h, REMIND);
    h.keepAlive.delete('d1');
    await h.presence.offline('d1');
    await runTo(h, SHOW);
    expect(h.events.last('dispatch.booked_released')?.payload).toMatchObject({ orderId: 'o1', driverId: 'd1', reason: 'no_show', reopened: false });
    expect((await booked(h))?.state).toBe('released');
    expect(h.trips.offers[0]).toEqual({ tripId: 't1', driverIds: ['d2'], timeoutSec: 15 });
    expect(h.trips.assigns).toEqual([]);
  });

  it('busy with another job at T−30: released too (he must be free to head to the pickup)', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h);
    await runTo(h, OPEN);
    await h.service.answerBookedJob('d1', 't1', 'confirm');
    await runTo(h, '2026-10-08T01:20:00Z');
    await h.store.addDriverJob('d1', 'other-trip');
    await runTo(h, SHOW);
    expect(h.events.last('dispatch.booked_released')?.payload).toMatchObject({ reason: 'no_show' });
    expect(h.trips.offers[0]?.driverIds).toEqual(['d2']);
  });

  it('the favourite has it alone for an hour, then everyone; his «مو إلي» opens it at once', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h, { preferDriverIds: ['fav'] });
    await runTo(h, OPEN);
    expect(h.events.last('dispatch.booked_offered')?.payload).toMatchObject({ orderId: 'o1', driverIds: ['fav'], favourite: true });
    expect(h.events.ofType('dispatch.booked_opened')).toHaveLength(0);
    const favView = await h.service.bookedJobs('fav', 'aziziyah');
    expect(favView.open.map((i) => [i.request.tripId, i.favourite])).toEqual([['t1', true]]);
    expect(await openIds(h, 'd1')).toEqual([]);
    await expect(h.service.answerBookedJob('d1', 't1', 'confirm')).rejects.toMatchObject({ code: 'booked_job_not_found' });
    await runTo(h, FAV_END);
    expect(h.events.last('dispatch.booked_opened')?.payload).toMatchObject({ driverIds: ['d1', 'd2'] });
    expect(await openIds(h, 'd1')).toEqual(['t1']);

    const h2 = dispatchHarness(NOW);
    await fleet(h2);
    await book(h2, { preferDriverIds: ['fav'] });
    await runTo(h2, OPEN);
    await h2.service.answerBookedJob('fav', 't1', 'pass');
    expect(h2.events.last('dispatch.booked_opened')?.payload).toMatchObject({ driverIds: ['d1', 'd2'] });
    expect(await openIds(h2, 'd1')).toEqual(['t1']);
    expect(await openIds(h2, 'fav')).toEqual([]);
    await runTo(h2, FAV_END);
    expect(h2.events.ofType('dispatch.booked_opened')).toHaveLength(1);
  });

  it('the favourite who confirms it: «الزبون طلبك إنت» on the confirmation event', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h, { preferDriverIds: ['fav'] });
    await runTo(h, OPEN);
    await h.service.answerBookedJob('fav', 't1', 'confirm');
    expect(h.events.last('dispatch.booked_confirmed')?.payload).toMatchObject({ driverId: 'fav', favourite: true });
  });

  it('a driver holds booked jobs at least an hour apart', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h);
    await book(h, {}, new Date(T.getTime() + 30 * 60_000), 't2', 'o2');
    await book(h, {}, new Date(T.getTime() + 90 * 60_000), 't3', 'o3');
    await runTo(h, OPEN);
    expect(await openIds(h, 'd1')).toEqual(['t1', 't2', 't3']);
    await h.service.answerBookedJob('d1', 't1', 'confirm');
    expect(await openIds(h, 'd1')).toEqual(['t3']);
    await expect(h.service.answerBookedJob('d1', 't2', 'confirm')).rejects.toMatchObject({ code: 'booked_job_clash' });
    await h.service.answerBookedJob('d1', 't3', 'confirm');
    expect(await mineIds(h, 'd1')).toEqual(['t1', 't3']);
  });

  it('«طالع هسة» from the reminder on: the trip is his; earlier is refused, and so is busy', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h);
    await runTo(h, OPEN);
    await h.service.answerBookedJob('d1', 't1', 'confirm');
    await runTo(h, '2026-10-08T00:30:00Z');
    await expect(h.service.answerBookedJob('d1', 't1', 'start')).rejects.toMatchObject({ code: 'booked_start_too_early' });
    await runTo(h, '2026-10-08T01:05:00Z');
    await h.store.addDriverJob('d1', 'other-trip');
    await expect(h.service.answerBookedJob('d1', 't1', 'start')).rejects.toMatchObject({ code: 'booked_start_not_ready' });
    await h.store.removeDriverJob('d1', 'other-trip');
    await h.service.answerBookedJob('d1', 't1', 'start');
    expect(h.trips.assigns.map((a) => a.driverId)).toEqual(['d1']);
    expect((await h.service.getRequest('t1'))?.status).toBe('assigned');
    await runTo(h, SHOW);
    expect(h.trips.offers).toHaveLength(1);
  });

  it('the rider cancels: the confirmed driver hears it, and nothing is offered later', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h);
    await runTo(h, OPEN);
    await h.service.answerBookedJob('d1', 't1', 'confirm');
    await h.service.cancel('t1', 'rider');
    expect(h.events.last('dispatch.booked_cancelled')?.payload).toMatchObject({ orderId: 'o1', driverId: 'd1' });
    expect(await mineIds(h, 'd1')).toEqual([]);
    await runTo(h, '2026-10-08T02:00:00Z');
    expect(h.trips.offers).toEqual([]);
  });

  it('drivers who don’t fit (roles, vehicle) never see it; offline drivers see only their own', async () => {
    const h = dispatchHarness(NOW);
    await h.online('food', 0.1, { verticals: ['food'] });
    h.keepAlive.add('food');
    await book(h);
    await runTo(h, OPEN);
    expect(await openIds(h, 'food')).toEqual([]);
    await expect(h.service.answerBookedJob('food', 't1', 'confirm')).rejects.toMatchObject({ code: 'booked_job_not_fit' });
    expect(await h.service.bookedJobs('away', 'aziziyah')).toEqual({ online: false, mine: [], open: [] });
  });

  it('with the money rule on, the fallback search carries the pickup compensation (off by default: 0)', async () => {
    const rules = { ...AZIZIYAH_MONEY_RULES, bookedRideFallback: { enabled: true, pickupCompensationIqd: 750 } };
    const h = dispatchHarness(NOW, undefined, { rules });
    await fleet(h);
    await book(h);
    await runTo(h, SHOW);
    const offers = await h.offers('t1');
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.compensationIqd === 750)).toBe(true);
  });

  it('booked too late for a pre-assignment: no offer to confirm, the search at T−30', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    const at = new Date(Date.parse(NOW) + 60 * 60_000);
    await book(h, {}, at);
    expect(await booked(h)).toBeNull();
    expect(await h.service.bookedRide('t1')).toEqual({ job: null, scheduledFor: at, searchAt: rideSearchStartsAt(at) });
    await runTo(h, '2026-10-07T11:30:00Z');
    expect(h.trips.offers[0]?.driverIds).toEqual(['d1', 'd2']);
  });

  it('a favourite-first fallback still rings him alone first when he did not drop it', async () => {
    const h = dispatchHarness(NOW);
    await fleet(h);
    await book(h, { preferDriverIds: ['fav'] });
    await runTo(h, SHOW);
    expect((await h.offers('t1'))[0]).toMatchObject({ policy: FAVOURITE_OFFER_POLICY, driverId: 'fav' });
  });
});
