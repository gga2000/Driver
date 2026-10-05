import { describe, expect, it } from 'vitest';
import { InMemoryQueue } from '../../shared/queue.js';
import { etaMin } from './geo.js';
import { OfferOrchestrator, type TimerJob } from './offer.orchestrator.js';
import { dispatchHarness, north } from './test-harness.js';

type H = ReturnType<typeof dispatchHarness>;

const taxi = (h: H, tripId = 't1', extra: Record<string, unknown> = {}) =>
  h.service.request({ tripId, cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0), ...extra });

const food = (h: H, tripId: string, extra: Record<string, unknown> = {}) =>
  h.service.request({ tripId, cityId: 'aziziyah', vertical: 'food', zoneId: 'centre', pickup: north(0), dropoffZoneId: 'centre', readyAt: h.clock.now(), hot: true, ...extra });

async function respond(h: H, tripId: string, driverId: string, accept = true) {
  const offer = await h.openOffer(tripId, driverId);
  if (!offer) throw new Error(`no open offer for ${driverId} on ${tripId}`);
  return h.service.respond(h.actor(driverId), { offerId: offer.id, accept });
}

async function seen(h: H, tripId: string, driverId: string, foregroundMs: number) {
  const offer = await h.openOffer(tripId, driverId);
  return h.service.offerSeen(h.actor(driverId), { offerId: offer!.id, foregroundMs });
}

const code = (e: unknown) => (e as { code?: string }).code;

/** Wave 1 within 1.5 km, wave 2 within 3 km, wave 3 the rest of the city. */
async function standardFleet(h: H) {
  for (const [id, km] of [['a1', 0.2], ['a2', 0.5], ['a3', 1.0], ['b1', 1.6], ['b2', 1.8], ['b3', 2.0], ['b4', 2.2], ['b5', 2.4], ['c1', 4], ['c2', 6]] as const) {
    await h.online(id, km);
  }
}

describe('smart_broadcast wave timing (spec §3: 3 / 1.5 km / 15 s → 5 / 3 km / 15 s → all / 30 s)', () => {
  it('sends wave 1 at once, wave 2 at 15 s, wave 3 at 30 s, each inside its radius', async () => {
    const h = dispatchHarness();
    await standardFleet(h);
    await taxi(h);
    expect(h.trips.offers).toEqual([{ tripId: 't1', driverIds: ['a1', 'a2', 'a3'], timeoutSec: 15 }]);
    await h.advance(14);
    expect(h.trips.offers).toHaveLength(1);
    await h.advance(1);
    expect(h.trips.offers[1]).toEqual({ tripId: 't1', driverIds: ['b1', 'b2', 'b3', 'b4', 'b5'], timeoutSec: 15 });
    expect((await h.offers('t1')).filter((o) => o.wave === 1).map((o) => o.state)).toEqual(['timed_out', 'timed_out', 'timed_out']);
    await h.advance(15);
    expect(h.trips.offers[2]).toEqual({ tripId: 't1', driverIds: ['c1', 'c2'], timeoutSec: 30 });
    expect(h.events.ofType('dispatch.wave_sent').map((e) => e.payload['wave'])).toEqual([1, 2, 3]);
  });

  it('wave 1 never reaches past 1.5 km even with fewer than 3 drivers inside it', async () => {
    const h = dispatchHarness();
    await h.online('in', 1.4);
    await h.online('out', 1.6);
    await taxi(h);
    expect(h.trips.offers[0]?.driverIds).toEqual(['in']);
    await h.advance(15);
    expect(h.trips.offers[1]?.driverIds).toEqual(['out']);
  });

  it('an empty wave opens the next one at once', async () => {
    const h = dispatchHarness();
    await h.online('mid', 2);
    await taxi(h);
    expect(h.trips.offers).toEqual([{ tripId: 't1', driverIds: ['mid'], timeoutSec: 15 }]);
    expect((await h.offers('t1'))[0]?.wave).toBe(2);
  });

  it('the board shows the wave card with its countdown', async () => {
    const h = dispatchHarness();
    await standardFleet(h);
    await taxi(h);
    await h.advance(5);
    const card = (await h.service.board('aziziyah')).cards[0]!;
    expect(card).toMatchObject({ tripId: 't1', status: 'searching', status_ar: 'دا ندوّر سايق', wave: 1, countdownSec: 10, elapsedSec: 5, red: false, compensationLabel_ar: null });
    expect(card.offers.map((o) => [o.driverId, o.expiresInSec])).toEqual([
      ['a1', 10],
      ['a2', 10],
      ['a3', 10],
    ]);
  });

  it('is idempotent per trip', async () => {
    const h = dispatchHarness();
    await standardFleet(h);
    await taxi(h);
    await taxi(h);
    expect(h.trips.offers).toHaveLength(1);
    expect(await h.offers('t1')).toHaveLength(3);
  });
});

describe('first accept wins (SET NX lock)', () => {
  it('two simultaneous accepts: exactly one winner, the other is told the job is taken', async () => {
    const h = dispatchHarness();
    await standardFleet(h);
    await taxi(h);
    const results = await Promise.allSettled([respond(h, 't1', 'a1'), respond(h, 't1', 'a2')]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(code((lost[0] as PromiseRejectedResult).reason)).toBe('offer_taken');
    expect(h.trips.assigns).toHaveLength(1);
    const offers = await h.offers('t1');
    expect(offers.filter((o) => o.state === 'accepted')).toHaveLength(1);
    expect(offers.find((o) => o.driverId === 'a3')?.state).toBe('withdrawn');
    expect(h.events.ofType('dispatch.assigned')).toHaveLength(1);
  });

  it('after assignment no timer fires: no wave 2, no re-broadcast, no free-cancel', async () => {
    const h = dispatchHarness();
    await standardFleet(h);
    await taxi(h);
    await respond(h, 't1', 'a3');
    await h.advance(200);
    expect(h.trips.offers).toHaveLength(1);
    expect(h.events.types()).not.toContain('dispatch.rebroadcast');
    expect(h.events.types()).not.toContain('dispatch.free_cancel_available');
    expect((await h.service.getRequest('t1'))?.status).toBe('assigned');
    await expect(respond(h, 't1', 'a1')).rejects.toThrow();
  });

  it('an expired offer cannot be accepted', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await taxi(h);
    const offer = (await h.offers('t1'))[0]!;
    await h.advance(15);
    await expect(h.service.respond(h.actor('a1'), { offerId: offer.id, accept: true })).rejects.toMatchObject({ code: 'offer_expired' });
  });

  it("a driver cannot answer someone else's offer", async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await taxi(h);
    const offer = (await h.offers('t1'))[0]!;
    await expect(h.service.respond(h.actor('intruder'), { offerId: offer.id, accept: true })).rejects.toMatchObject({ code: 'offer_not_yours' });
  });
});

describe('"seen" = 3 s in the foreground (edge-case §6)', () => {
  it('2.999 s does not count; 3 s does', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await taxi(h);
    expect(await seen(h, 't1', 'a1', 2999)).toEqual({ seen: false });
    expect((await h.offers('t1'))[0]?.state).toBe('sent');
    expect(await seen(h, 't1', 'a1', 3000)).toEqual({ seen: true });
    const offer = (await h.offers('t1'))[0]!;
    expect(offer.state).toBe('seen');
    expect(offer.seenAt).toEqual(h.clock.now());
    expect(h.events.ofType('dispatch.offer_seen')).toHaveLength(1);
  });
});

describe('re-broadcast at 60 s with +500 compensation (spec §3 + edge-case §6)', () => {
  async function scenario() {
    const h = dispatchHarness();
    await standardFleet(h);
    await taxi(h);
    await h.advance(2);
    await seen(h, 't1', 'a1', 3000); // seen, then ignored → excluded
    await seen(h, 't1', 'a2', 2999); // never really seen → may be re-offered, no compensation
    await respond(h, 't1', 'a3', false); // declined → excluded
    await h.advance(14); // t = 16, wave 2 open
    await seen(h, 't1', 'b1', 5000); // wave 2 ignorer → excluded
    await h.advance(15); // t = 31, wave 3 open
    await seen(h, 't1', 'c1', 3500); // wave 3 ignorer → excluded
    await h.advance(19); // t = 50
    await h.online('n1', 0.3); // came online after the waves
    await h.advance(9); // t = 59
    return h;
  }

  it('turns the card red at 60 s and re-broadcasts, not before', async () => {
    const h = await scenario();
    expect((await h.service.getRequest('t1'))?.status).toBe('searching');
    await h.advance(1);
    const r = await h.service.getRequest('t1');
    expect(r).toMatchObject({ status: 'rebroadcast', red: true, pass: 2 });
    const card = (await h.service.board('aziziyah')).cards[0]!;
    expect(card.red).toBe(true);
    expect(card.compensationLabel_ar).toBe('+500 تعويض');
  });

  it('pays +500 only to drivers not in waves 1–2, and excludes decliners and ignorers', async () => {
    const h = await scenario();
    await h.advance(1);
    const second = (await h.offers('t1')).filter((o) => o.pass === 2);
    expect(Object.fromEntries(second.map((o) => [o.driverId, o.compensationIqd]))).toEqual({
      n1: 500, // new: not in waves 1–2
      a2: 0, // wave 1, never saw it: re-offered without compensation
      b2: 0,
      b3: 0,
      b4: 0,
      b5: 0,
      c2: 500, // wave 3 only: eligible
    });
    for (const excluded of ['a1', 'a3', 'b1', 'c1']) expect(second.some((o) => o.driverId === excluded)).toBe(false);
    const ev = h.events.last('dispatch.rebroadcast')!;
    expect(ev.payload['excluded']).toEqual(['a1', 'a3', 'b1', 'c1']);
    expect(ev.payload['compensated']).toEqual(['n1', 'c2']);
    // Ignored = timed out after being seen; unseen time-outs are not ignores.
    const pass1 = (await h.offers('t1')).filter((o) => o.pass === 1);
    expect(pass1.find((o) => o.driverId === 'a1')).toMatchObject({ state: 'timed_out', seenAt: expect.any(Date) });
    expect(pass1.find((o) => o.driverId === 'a2')).toMatchObject({ state: 'timed_out', seenAt: null });
  });

  it('a compensated accept carries the +500 to trips and the platform-funded event', async () => {
    const h = await scenario();
    await h.advance(1);
    expect(await respond(h, 't1', 'n1')).toEqual({ outcome: 'assigned', tripId: 't1', compensationIqd: 500 });
    expect(h.trips.assigns).toEqual([{ tripId: 't1', driverId: 'n1', compensationIqd: 500, batchWith: [] }]);
    expect(h.events.last('dispatch.assigned')?.payload).toMatchObject({ compensationIqd: 500, compensationFundedBy: 'platform' });
  });

  it('a wave-1 driver accepting the re-broadcast gets no compensation', async () => {
    const h = await scenario();
    await h.advance(1);
    expect((await respond(h, 't1', 'a2')).compensationIqd).toBe(0);
  });

  it('at 180 s the customer may cancel free and the card goes to the dispatcher', async () => {
    const h = await scenario();
    await h.advance(120); // t = 179
    expect((await h.service.getRequest('t1'))?.customerMayCancelFree).toBe(false);
    await h.advance(1); // t = 180
    const r = await h.service.getRequest('t1');
    expect(r).toMatchObject({ customerMayCancelFree: true, status: 'needs_dispatcher', red: true });
    expect(h.events.types()).toContain('dispatch.free_cancel_available');
    expect((await h.offers('t1')).filter((o) => o.state === 'sent' || o.state === 'seen')).toEqual([]);
    const card = (await h.service.board('aziziyah')).cards[0]!;
    expect(card).toMatchObject({ customerMayCancelFree: true, status_ar: 'يحتاج الديسباتشر' });
  });
});

describe('eligibility', () => {
  it('over-cap drivers get no new offers and cannot accept one (money & ops §4)', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await h.online('a2', 0.5);
    h.caps.over.add('a1');
    await taxi(h);
    expect(h.trips.offers[0]?.driverIds).toEqual(['a2']);

    // Went over cap after the offer was sent (e.g. the cash of the job they were finishing).
    await taxi(h, 't2');
    h.caps.over.add('a2');
    await expect(respond(h, 't2', 'a2')).rejects.toMatchObject({ code: 'over_cap' });
  });

  it('over cap after the current job: the job runs on, the next one is not offered', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await taxi(h);
    await respond(h, 't1', 'a1');
    h.caps.over.add('a1');
    await h.service.jobFinished('t1');
    await taxi(h, 't2');
    expect(h.trips.offeredTo('t2')).toEqual([]);
    expect((await h.service.getRequest('t1'))?.status).toBe('assigned');
  });

  it('tuktuks never get edge-zone jobs unless they opted in', async () => {
    const h = dispatchHarness();
    await h.online('tk-plain', 0.2, { vehicle: 'tuktuk' });
    await h.online('tk-optin', 0.4, { vehicle: 'tuktuk', edgeOptIn: true });
    await h.service.request({ tripId: 'edge-drop', cityId: 'aziziyah', vertical: 'tuktuk', zoneId: 'centre', dropoffZoneId: 'bazl_hallata', pickup: north(0) });
    expect(h.trips.offeredTo('edge-drop')).toEqual(['tk-optin']);
    await h.service.request({ tripId: 'centre-only', cityId: 'aziziyah', vertical: 'tuktuk', zoneId: 'centre', dropoffZoneId: 'street_30', pickup: north(0) });
    expect(h.trips.offeredTo('centre-only')).toEqual(['tk-plain', 'tk-optin']);
  });

  it('edge pickups and food deliveries follow the same tuktuk rule; bikes are unaffected', async () => {
    const h = dispatchHarness();
    await h.online('tk', 0.1, { vehicle: 'tuktuk' });
    await h.online('bike', 1, { vehicle: 'bike' });
    await food(h, 'f-edge', { dropoffZoneId: 'mashrou_owaid' });
    expect(h.trips.offeredTo('f-edge')).toEqual(['bike']);
    await h.service.request({ tripId: 'edge-pick', cityId: 'aziziyah', vertical: 'parcel', zoneId: 'mashrou_jadhif', dropoffZoneId: 'centre', pickup: north(0) });
    expect(h.trips.offeredTo('edge-pick')).toEqual(['bike']);
  });

  it('vehicle fit: a taxi job never goes to a bike', async () => {
    const h = dispatchHarness();
    await h.online('bike', 0.1, { vehicle: 'bike' });
    await h.online('car', 0.9);
    await taxi(h);
    expect(h.trips.offers[0]?.driverIds).toEqual(['car']);
  });

  it('busy drivers are not broadcast to', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await h.online('a2', 0.4);
    await taxi(h);
    await respond(h, 't1', 'a1');
    await taxi(h, 't2');
    expect(h.trips.offeredTo('t2')).toEqual(['a2']);
  });

  it('ranks with time-in-zone decay: a camper loses wave priority to a fresher driver', async () => {
    const h = dispatchHarness();
    await h.online('camper', 0.3);
    h.keepAlive.add('camper');
    await h.advance(3600); // an hour idling outside the same restaurant
    await h.online('fresh', 1.3); // just drove in
    // Both in wave 1; the camper (60 min in zone) ranks below the fresh driver.
    await h.service.request({ tripId: 'camp', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0) });
    expect(h.trips.offeredTo('camp')).toEqual(['fresh', 'camper']);
  });
});

describe('auto_assign (food, grocery)', () => {
  it('first offer at readyAt − (ETA + 2 min), 20 s to accept', async () => {
    const h = dispatchHarness();
    await h.online('k1', 1, { vehicle: 'bike' });
    h.keepAlive.add('k1');
    const readyAt = new Date(h.clock.now().getTime() + 10 * 60_000);
    const r = await food(h, 'f1', { readyAt });
    expect(r.status).toBe('scheduled');
    const startSec = 600 - (etaMin(north(1), north(0)) + 2) * 60;
    await h.advance(Math.ceil(startSec) - 1);
    expect(h.trips.offers).toEqual([]);
    await h.advance(1);
    expect(h.trips.offers).toEqual([{ tripId: 'f1', driverIds: ['k1'], timeoutSec: 20 }]);
  });

  it('the kitchen marking ready early starts the search now (readyNow), and the stale timer does nothing', async () => {
    const h = dispatchHarness();
    await h.online('k1', 1, { vehicle: 'bike' });
    h.keepAlive.add('k1');
    const r = await food(h, 'f1', { readyAt: new Date(h.clock.now().getTime() + 15 * 60_000) });
    expect(r.status).toBe('scheduled');
    await h.advance(60);
    expect(h.trips.offers).toEqual([]);
    await h.orchestrator.readyNow('f1');
    expect(h.trips.offers).toEqual([{ tripId: 'f1', driverIds: ['k1'], timeoutSec: 20 }]);
    await h.advance(15 * 60);
    expect(h.trips.offeredTo('f1').filter((d) => d === 'k1').length).toBeGreaterThanOrEqual(1);
    // A request that is already searching is left alone.
    const before = h.trips.offers.length;
    await h.orchestrator.readyNow('f1');
    expect(h.trips.offers.length).toBe(before);
  });

  it('starts at once when the courier is already further than the time to ready (review J114)', async () => {
    const h = dispatchHarness();
    await h.online('k-far', 4, { vehicle: 'bike' });
    await food(h, 'f1', { readyAt: new Date(h.clock.now().getTime() + 5 * 60_000) });
    expect(h.trips.offeredTo('f1')).toEqual(['k-far']);
  });

  it('timeout or decline moves to the next courier; after 3 passes the dispatcher gets the card', async () => {
    const h = dispatchHarness();
    for (const [id, km] of [['k1', 0.2], ['k2', 0.4], ['k3', 0.6], ['k4', 0.8]] as const) await h.online(id, km, { vehicle: 'bike' });
    await food(h, 'f1');
    expect(h.trips.offeredTo('f1')).toEqual(['k1']);
    await h.advance(20); // pass 1 times out
    expect(h.trips.offeredTo('f1')).toEqual(['k1', 'k2']);
    await respond(h, 'f1', 'k2', false); // decline: pass 3 at once
    expect(h.trips.offeredTo('f1')).toEqual(['k1', 'k2', 'k3']);
    await h.advance(20);
    expect(h.trips.offeredTo('f1')).toEqual(['k1', 'k2', 'k3']); // k4 never offered: 3 passes
    expect(await h.service.getRequest('f1')).toMatchObject({ status: 'needs_dispatcher', red: true, pass: 3 });
    expect(h.events.last('dispatch.needs_dispatcher')?.payload['reason']).toBe('passes_exhausted');
  });

  it('batches onto a busy courier when all four rules hold, with the honest departure time', async () => {
    const h = dispatchHarness();
    await h.online('k1', 0.1, { vehicle: 'bike' });
    await food(h, 'o1');
    await respond(h, 'o1', 'k1');
    await h.online('k2', 2, { vehicle: 'bike' });
    await food(h, 'o2', { dropoffZoneId: 'street_30' }); // adjacent to centre, same restaurant
    expect(h.trips.offeredTo('o2')).toEqual(['k1']);
    expect(h.events.last('dispatch.offer_sent')?.payload).toMatchObject({ driverId: 'k1', batchWith: ['o1'], departAt: expect.any(String) });
    await respond(h, 'o2', 'k1');
    expect(h.trips.assigns.at(-1)).toEqual({ tripId: 'o2', driverId: 'k1', compensationIqd: 0, batchWith: ['o1'] });
  });

  it('two offers that reached a free courier at once: the second accept must still pass the batching rules (simulator regression)', async () => {
    // Found by the Aziziyah simulator: both kitchens' offers went to the same idle courier in one
    // pass; accepting both made a batch no rule ever checked (a hot item rode 36 min in the bag).
    const h = dispatchHarness();
    await h.online('k1', 0, { vehicle: 'tuktuk' });
    await food(h, 'near');
    await food(h, 'far', { pickup: north(3) }); // 3 km away: ≈ 10 min of detour, the limit is 4
    expect([h.trips.offeredTo('near'), h.trips.offeredTo('far')]).toEqual([['k1'], ['k1']]);
    await respond(h, 'near', 'k1');
    const err = await respond(h, 'far', 'k1').catch((e: unknown) => e);
    expect(code(err)).toBe('offer_conflicts_current_job');
    expect((await h.offers('far')).map((o) => o.state)).toEqual(['declined']);
    expect(h.trips.assigns.map((a) => a.tripId)).toEqual(['near']);
    expect(await h.service.getRequest('far')).toMatchObject({ status: 'searching', pass: 2 });

    // A second kitchen that does fit (same pickup, adjacent drop-off) is still taken as a batch.
    const b = dispatchHarness();
    await b.online('k1', 0, { vehicle: 'tuktuk' });
    await food(b, 'o1');
    await food(b, 'o2', { dropoffZoneId: 'street_30' });
    await respond(b, 'o1', 'k1');
    await respond(b, 'o2', 'k1');
    expect(b.trips.assigns.at(-1)).toEqual({ tripId: 'o2', driverId: 'k1', compensationIqd: 0, batchWith: ['o1'] });
  });

  it('a driver who took one broadcast ride cannot take a second one that reached him while he was free', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await taxi(h, 't1');
    await taxi(h, 't2');
    await respond(h, 't1', 'a1');
    expect(code(await respond(h, 't2', 'a1').catch((e: unknown) => e))).toBe('offer_conflicts_current_job');
    expect(h.trips.assigns.map((a) => a.tripId)).toEqual(['t1']);
  });

  it('M2 follow-up: two simultaneous accepts of different rides by one driver — the per-driver lock lets only one through', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await taxi(h, 't1');
    await taxi(h, 't2');
    const [o1, o2] = [await h.openOffer('t1', 'a1'), await h.openOffer('t2', 'a1')];
    const results = await Promise.allSettled([h.service.respond(h.actor('a1'), { offerId: o1!.id, accept: true }), h.service.respond(h.actor('a1'), { offerId: o2!.id, accept: true })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.map((r) => (r.status === 'rejected' ? code(r.reason) : 'ok')).sort()).toEqual(['offer_conflicts_current_job', 'ok']);
    expect(h.trips.assigns).toHaveLength(1);
    expect(await h.store.driverJobs('a1')).toHaveLength(1);
  });

  it('M2 follow-up: two simultaneous food accepts by one bike courier cannot both skip the batching rules', async () => {
    const h = dispatchHarness();
    await h.online('k1', 0, { vehicle: 'tuktuk' });
    await food(h, 'near');
    await food(h, 'far', { pickup: north(3) }); // would fail the 4-min detour rule against "near"
    const [o1, o2] = [await h.openOffer('near', 'k1'), await h.openOffer('far', 'k1')];
    const results = await Promise.allSettled([h.service.respond(h.actor('k1'), { offerId: o1!.id, accept: true }), h.service.respond(h.actor('k1'), { offerId: o2!.id, accept: true })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(h.trips.assigns).toHaveLength(1);
  });

  it('does not batch across far zones or past the bike limit; a tuktuk takes a third', async () => {
    const h = dispatchHarness();
    await h.online('k1', 0.1, { vehicle: 'bike' });
    await food(h, 'o1');
    await respond(h, 'o1', 'k1');
    await h.online('k2', 2, { vehicle: 'bike' });
    await food(h, 'o-far', { dropoffZoneId: 'khamas' });
    expect(h.trips.offeredTo('o-far')).toEqual(['k2']);
    await h.service.cancel('o-far');

    await food(h, 'o2');
    await respond(h, 'o2', 'k1'); // k1 now holds 2 (bike limit)
    await food(h, 'o3');
    expect(h.trips.offeredTo('o3')).toEqual(['k2']);

    const t = dispatchHarness();
    await t.online('tk', 0.1, { vehicle: 'tuktuk' });
    for (const id of ['p1', 'p2']) {
      await food(t, id);
      await respond(t, id, 'tk');
    }
    await food(t, 'p3');
    expect(t.trips.offeredTo('p3')).toEqual(['tk']);
  });
});

describe('suggest-only and runtime policy overrides', () => {
  it('suggest-only emits nothing to drivers: the card waits for the dispatcher', async () => {
    const h = dispatchHarness();
    await standardFleet(h);
    await h.service.setPolicy(h.actor('disp'), { cityId: 'aziziyah', vertical: 'taxi', suggestOnly: true });
    await taxi(h);
    await h.advance(200);
    expect(h.trips.offers).toEqual([]);
    expect(await h.offers('t1')).toEqual([]);
    expect(h.events.types()).not.toContain('dispatch.wave_sent');
    const card = (await h.service.board('aziziyah')).cards[0]!;
    expect(card).toMatchObject({ status: 'awaiting_dispatcher', status_ar: 'ينتظر قرار الديسباتشر' });
    expect(card.suggestion.slice(0, 3)).toEqual(['a1', 'a2', 'a3']);
    // The dispatcher picks one: exactly one offer goes out.
    await h.online('b2', 1.8); // back online after the 200 s
    await h.service.override(h.actor('disp'), { tripId: 't1', driverId: 'b2' });
    expect(h.trips.offers).toEqual([{ tripId: 't1', driverIds: ['b2'], timeoutSec: 15 }]);
  });

  it('suggest-only from the city config behaves the same', async () => {
    const h = dispatchHarness();
    h.config.city('aziziyah')!.dispatch.tuktuk!.suggestOnly = true;
    await h.online('tk', 0.2, { vehicle: 'tuktuk' });
    await h.service.request({ tripId: 'x', cityId: 'aziziyah', vertical: 'tuktuk', zoneId: 'centre', pickup: north(0) });
    expect(h.trips.offers).toEqual([]);
    expect((await h.service.getRequest('x'))?.status).toBe('awaiting_dispatcher');
  });

  it('setPolicy persists in the store (Redis) and survives a fresh orchestrator; clear falls back to config', async () => {
    const h = dispatchHarness();
    const out = await h.service.setPolicy(h.actor('disp'), { cityId: 'aziziyah', vertical: 'taxi', policy: 'auto_assign' });
    expect(out).toEqual({ vertical: 'taxi', policy: 'auto_assign', suggestOnly: false, overridden: true });
    const fresh = new OfferOrchestrator(h.config, h.presence, h.zones, h.repo, h.store, h.events, h.trips, h.caps, h.departures, new InMemoryQueue<TimerJob>('d2'), h.clock, h.uow);
    expect((await fresh.effectiveConfig('aziziyah', 'taxi')).cfg.policy).toBe('auto_assign');
    expect((await fresh.board('aziziyah')).policies.find((p) => p.vertical === 'taxi')).toEqual({ vertical: 'taxi', policy: 'auto_assign', suggestOnly: false, overridden: true });
    expect(h.events.last('dispatch.policy_changed')?.actorId).toBe('disp');

    // The override changes behaviour: a taxi request now auto-assigns to one driver.
    await h.online('a1', 0.2);
    await h.online('a2', 0.4);
    await taxi(h);
    expect(h.trips.offers).toEqual([{ tripId: 't1', driverIds: ['a1'], timeoutSec: 15 }]);

    await h.service.setPolicy(h.actor('disp'), { cityId: 'aziziyah', vertical: 'taxi', clear: true });
    expect((await fresh.effectiveConfig('aziziyah', 'taxi')).cfg.policy).toBe('smart_broadcast');
  });
});

describe('dispatcher override (review J116)', () => {
  it('refuses an offline or over-cap driver unless forced with a reason; the driver still accepts', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await h.online('capped', 0.3);
    h.caps.over.add('capped');
    await taxi(h);
    await expect(h.service.override(h.actor('disp'), { tripId: 't1', driverId: 'ghost' })).rejects.toMatchObject({ code: 'override_invalid' });
    await expect(h.service.override(h.actor('disp'), { tripId: 't1', driverId: 'capped' })).rejects.toMatchObject({ code: 'override_invalid' });
    await expect(h.service.override(h.actor('disp'), { tripId: 't1', driverId: 'capped', force: true })).rejects.toMatchObject({ code: 'override_reason_required' });
    const forced = await h.service.override(h.actor('disp'), { tripId: 't1', driverId: 'capped', force: true, reason: 'settled cash at the office' });
    expect(forced.warnings).toEqual(['over_cap']);
    expect((await h.offers('t1')).find((o) => o.driverId === 'a1')?.state).toBe('withdrawn');
    expect(h.events.last('dispatch.override')?.payload).toMatchObject({ driverId: 'capped', forced: true, reason: 'settled cash at the office' });
    // Wave timers died with the override: no wave 2 at 15 s.
    await h.advance(14);
    expect(h.trips.offers.at(-1)?.driverIds).toEqual(['capped']);
  });

  it('a declined or ignored override returns the card to the dispatcher', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await h.online('a2', 0.4);
    await taxi(h);
    await h.service.override(h.actor('disp'), { tripId: 't1', driverId: 'a2' });
    await respond(h, 't1', 'a2', false);
    expect((await h.service.getRequest('t1'))?.status).toBe('needs_dispatcher');
    await h.service.override(h.actor('disp'), { tripId: 't1', driverId: 'a1' });
    await h.advance(15);
    expect(h.events.last('dispatch.needs_dispatcher')?.payload['reason']).toBe('override_timed_out');
  });
});

describe('scheduled: low fill at T−30 (spec §3)', () => {
  const depart = (h: H, seats: number) => {
    h.departures.seats.set('dep1', seats);
    return h.service.request({ tripId: 'dep-trip', cityId: 'aziziyah', vertical: 'intercity', zoneId: 'centre', departureId: 'dep1', departureAt: new Date(h.clock.now().getTime() + 2 * 3600_000) });
  };

  it('< 3 seats including walk-ups at T−30 → cancelled_low_fill', async () => {
    const h = dispatchHarness();
    await depart(h, 2);
    h.clock.advanceSeconds(90 * 60 - 1);
    await h.queue.drain();
    expect(h.departures.cancelled).toEqual([]);
    h.clock.advanceSeconds(1);
    await h.queue.drain();
    expect(h.departures.cancelled).toEqual(['dep1']);
    expect(h.events.last('dispatch.low_fill_cancelled')?.payload).toMatchObject({ seats: 2, minSeats: 3 });
    expect((await h.service.board('aziziyah')).cards).toEqual([]);
  });

  it('checks when the owner (routes) says low fill may cancel (T−10, decision 2026-10-04), and re-checks after a refusal', async () => {
    const h = dispatchHarness();
    const departAt = new Date(h.clock.now().getTime() + 2 * 3600_000);
    let refuse = true;
    const checks = [10, 5]; // routes' answer: first T−10, then (after its refusal) T−5
    Object.assign(h.departures, {
      lowFillCheckAt: async () => new Date(departAt.getTime() - (checks.shift() ?? 5) * 60_000),
      cancelLowFill: async (id: string) => {
        if (refuse) return false;
        h.departures.cancelled.push(id);
        return true;
      },
    });
    await depart(h, 2);
    h.clock.advanceMinutes(90); // T−30: nothing happens any more
    await h.queue.drain();
    expect(h.events.ofType('dispatch.low_fill_cancelled')).toHaveLength(0);
    h.clock.advanceMinutes(20); // T−10: routes refuses (say the driver's car is still selling), next look at T−5
    await h.queue.drain();
    expect(h.departures.cancelled).toEqual([]);
    refuse = false;
    h.clock.advanceMinutes(5);
    await h.queue.drain();
    expect(h.departures.cancelled).toEqual(['dep1']);
    expect(h.events.last('dispatch.low_fill_cancelled')?.payload).toMatchObject({ seats: 2 });
  });

  it('3 seats at T−30 → the departure is confirmed', async () => {
    const h = dispatchHarness();
    await depart(h, 3);
    h.clock.advanceMinutes(90);
    await h.queue.drain();
    expect(h.departures.cancelled).toEqual([]);
    expect(h.events.last('dispatch.departure_confirmed')?.payload['seats']).toBe(3);
  });
});

describe('pre_assigned: substitute auction (2 waves × 3 vetted × 5 min, then dispatcher)', () => {
  async function khatFleet(h: H) {
    await h.online('route', 0.5, { vehicle: 'van', vetted: true });
    await h.online('x-unvetted', 0.1, { vehicle: 'van' });
    for (const [id, km] of [['v1', 0.2], ['v2', 0.3], ['v3', 0.4], ['v4', 0.6], ['v5', 0.7], ['v6', 0.8], ['v7', 0.9]] as const) {
      await h.online(id, km, { vehicle: 'van', vetted: true });
    }
    for (const id of ['route', 'x-unvetted', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']) h.keepAlive.add(id);
  }
  const khat = (h: H, extra: Record<string, unknown> = {}) =>
    h.service.request({ tripId: 'k1', cityId: 'aziziyah', vertical: 'khat', zoneId: 'centre', pickup: north(0), routeId: 'r1', routeDriverId: 'route', ...extra });

  it('offers the route driver first; on decline opens the auction to the 3 nearest vetted', async () => {
    const h = dispatchHarness();
    await khatFleet(h);
    await khat(h);
    expect(h.trips.offers).toEqual([{ tripId: 'k1', driverIds: ['route'], timeoutSec: 60 }]);
    await respond(h, 'k1', 'route', false);
    expect(h.trips.offers[1]).toEqual({ tripId: 'k1', driverIds: ['v1', 'v2', 'v3'], timeoutSec: 300 });
    expect(h.events.types()).toContain('substitute.auction_opened');
  });

  it('wave 2 after 5 min, the dispatcher after 10; unvetted drivers never', async () => {
    const h = dispatchHarness();
    await khatFleet(h);
    await h.presence.offline('route');
    await khat(h);
    expect(h.trips.offers[0]?.driverIds).toEqual(['v1', 'v2', 'v3']);
    await h.advance(299);
    expect(h.trips.offers).toHaveLength(1);
    await h.advance(1);
    expect(h.trips.offers[1]?.driverIds).toEqual(['v4', 'v5', 'v6']);
    await h.advance(300);
    expect(await h.service.getRequest('k1')).toMatchObject({ status: 'needs_dispatcher' });
    expect(h.events.last('dispatch.needs_dispatcher')?.payload['reason']).toBe('substitutes_exhausted');
    expect(h.trips.offeredTo('k1')).not.toContain('x-unvetted');
    expect(h.trips.offeredTo('k1')).not.toContain('v7');
  });

  it('a substitute accepting wins the trip; caller-filtered matching stops are honoured', async () => {
    const h = dispatchHarness();
    await khatFleet(h);
    await h.presence.offline('route');
    await khat(h, { eligibleDriverIds: ['v2', 'v5', 'v7'] });
    expect(h.trips.offers[0]?.driverIds).toEqual(['v2', 'v5', 'v7']);
    await respond(h, 'k1', 'v5');
    expect(h.events.last('substitute.assigned')?.payload['driverId']).toBe('v5');
  });

  it('the route driver timing out after 60 s also opens the auction', async () => {
    const h = dispatchHarness();
    await khatFleet(h);
    await khat(h);
    await h.advance(60);
    expect(h.trips.offers[1]?.driverIds).toEqual(['v1', 'v2', 'v3']);
  });
});

describe('cancel and persistence', () => {
  it('cancel withdraws open offers, retires the card and silences timers', async () => {
    const h = dispatchHarness();
    await standardFleet(h);
    await taxi(h);
    await h.advance(5);
    await h.service.cancel('t1', 'customer-1');
    expect((await h.offers('t1')).map((o) => o.state)).toEqual(['withdrawn', 'withdrawn', 'withdrawn']);
    expect((await h.service.board('aziziyah')).cards).toEqual([]);
    await h.advance(200);
    expect(h.trips.offers).toHaveLength(1);
    expect(h.events.last('dispatch.cancelled')?.actorId).toBe('customer-1');
  });

  it('persists every offer as a DispatchOffer row with wave, pass, rank, distance, compensation and expiry', async () => {
    const h = dispatchHarness();
    await standardFleet(h);
    await taxi(h);
    const [first] = await h.offers('t1');
    expect(first).toMatchObject({
      tripId: 't1',
      driverId: 'a1',
      policy: 'smart_broadcast',
      wave: 1,
      pass: 1,
      rank: 1,
      distanceKm: 0.2,
      compensationIqd: 0,
      state: 'sent',
      sentAt: h.clock.now(),
      expiresAt: new Date(h.clock.now().getTime() + 15_000),
    });
  });
});
