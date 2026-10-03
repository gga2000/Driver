import { describe, expect, it } from 'vitest';
import { liveDriver } from './driver-pins.js';
import { dispatchHarness, north } from './test-harness.js';

type H = ReturnType<typeof dispatchHarness>;

const taxi = (h: H, tripId: string) => h.service.request({ tripId, cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0) });

async function accept(h: H, tripId: string, driverId: string) {
  const offer = await h.openOffer(tripId, driverId);
  return h.service.respond(h.actor(driverId), { offerId: offer!.id, accept: true });
}

describe('liveDriver (pure)', () => {
  const p = { driverId: 'd1', cityId: 'aziziyah', lat: 0, lng: 0, vehicle: 'bike' as const, tier: 'bronze' as const, vetted: false, edgeOptIn: false, zoneId: null, zoneSince: 0, lastSeenAt: 1_000_000 };
  const none = { assigned: new Map<string, string>(), offered: new Map<string, string>() };

  it('free with a fresh heartbeat, offered with an open offer, on job when assigned', () => {
    expect(liveDriver(p, none, 1_000_000 + 59_000)).toMatchObject({ state: 'free', tripId: null });
    expect(liveDriver(p, { ...none, offered: new Map([['d1', 't1']]) }, 1_000_000)).toMatchObject({ state: 'offered', tripId: 't1' });
    expect(liveDriver(p, { ...none, assigned: new Map([['d1', 't2']]) }, 1_000_000)).toMatchObject({ state: 'on_job', tripId: 't2' });
  });

  it('a minute without a heartbeat reads as recently offline, unless he is on a job', () => {
    expect(liveDriver(p, none, 1_000_000 + 61_000).state).toBe('offline_recent');
    expect(liveDriver(p, { ...none, offered: new Map([['d1', 't1']]) }, 1_000_000 + 61_000).state).toBe('offline_recent');
    expect(liveDriver(p, { ...none, assigned: new Map([['d1', 't2']]) }, 1_000_000 + 61_000).state).toBe('on_job');
  });
});

describe('DispatchService console reads', () => {
  it('presence.list returns every live driver in the city, by id, and drops expired ones', async () => {
    const h = dispatchHarness();
    await h.online('b', 3);
    await h.online('a', 0.5);
    expect((await h.presence.list('aziziyah')).map((p) => p.driverId)).toEqual(['a', 'b']);
    expect(await h.presence.list('kut')).toEqual([]);
    h.clock.advanceSeconds(91);
    expect(await h.presence.list('aziziyah')).toEqual([]);
  });

  it('liveDrivers: offered drivers carry the trip; the winner is on the job and the others go back to free', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await h.online('a2', 0.4);
    await h.online('far', 8);
    await taxi(h, 't1');
    const offered = await h.service.liveDrivers('aziziyah', h.clock.now());
    expect(offered.map((d) => [d.presence.driverId, d.state, d.tripId])).toEqual([
      ['a1', 'offered', 't1'],
      ['a2', 'offered', 't1'],
      ['far', 'free', null],
    ]);
    await accept(h, 't1', 'a2');
    const after = await h.service.liveDrivers('aziziyah', h.clock.now());
    expect(after.map((d) => [d.presence.driverId, d.state, d.tripId])).toEqual([
      ['a1', 'free', null],
      ['a2', 'on_job', 't1'],
      ['far', 'free', null],
    ]);
    await h.service.jobFinished('t1');
    expect((await h.service.liveDrivers('aziziyah', h.clock.now())).find((d) => d.presence.driverId === 'a2')?.state).toBe('free');
  });

  it('acceptStats: mean seconds from send to accept over the window', async () => {
    const h = dispatchHarness();
    const since = h.clock.now();
    expect(await h.service.acceptStats(since)).toEqual({ accepted: 0, avgSec: null });
    await h.online('a1', 0.2);
    h.keepAlive.add('a1');
    await taxi(h, 't1');
    await h.advance(4);
    await accept(h, 't1', 'a1');
    await h.service.jobFinished('t1');
    await taxi(h, 't2');
    await h.advance(10);
    await accept(h, 't2', 'a1');
    expect(await h.service.acceptStats(since)).toEqual({ accepted: 2, avgSec: 7 });
    expect((await h.service.acceptStats(h.clock.now())).accepted).toBe(1);
  });
});
