import { describe, expect, it } from 'vitest';
import type { DriverError } from '@driver/contracts';
import { offsetNorth } from '../trips/index.js';
import { INTERCITY_NETWORK } from './intercity.config.js';
import { seatHoldUntil } from './late-meter.js';
import { BAB1, BAB2, routesHarness, type RoutesHarness } from './test-harness.js';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as DriverError).code ?? String(err);
  }
  return 'no error';
}

const MADAIN_CHECKPOINT = INTERCITY_NETWORK.corridors[0]!.checkpoints.find(
  (c) => c.id === 'cp_madain',
)!;

/** 12:00Z start; the run leaves at 12:30 (latest 13:00); r1 front and r2 back_left, both prepaid. */
async function twoRiders(h: RoutesHarness, payment: 'wallet' | 'cash' = 'wallet') {
  const dep = await h.announce({ departAt: h.at(30), latestDepartureAt: h.at(60) });
  const a = await h.book('r1', dep.id, ['front'], { payment });
  const b = await h.book('r2', dep.id, ['back_left']);
  return { dep, a, b };
}

const settled = (h: RoutesHarness, kind: 'rider' | 'driver') =>
  h.events
    .ofType('seat.late_meter_settled')
    .map((e) => e.payload)
    .filter((p) => (p['late'] as { kind: string }).kind === kind);

describe('rider late meter, server-side (decisions §8, review C-38)', () => {
  it('reference = announced time; runs once the driver is inside the 150 m geofence and another rider has checked in', async () => {
    const h = routesHarness();
    const { dep, a, b } = await twoRiders(h);
    h.advance(20);
    await h.driverAt(dep.id, BAB1, 120); // 12:20, inside 150 m
    h.advance(5);
    await h.checkIn(dep.id, b.id); // 12:25
    h.advance(17);
    const view = await h.rpc.driverDeparture(
      { personId: 'd1', sessionId: 's' },
      { departureId: dep.id },
    );
    expect(view.bookings.find((x) => x.bookingId === a.id)?.meterMinutes).toBe(12);
    const pass = await h.rpc.boardingPass({ personId: 'r1', sessionId: 's' }, { bookingId: a.id });
    expect(pass.graceEndsAt?.toISOString()).toBe('2026-10-03T12:35:00.000Z');
    expect(pass.meterMinutes).toBe(12);
    await h.checkIn(dep.id, a.id); // 12:42
    expect((await h.departures.booking(a.id)).lateMinutes).toBe(12);
    expect(settled(h, 'rider')).toEqual([
      expect.objectContaining({
        minutesLate: 12,
        late: { kind: 'rider', id: 'r1' },
        driverId: 'd1',
        waitingRiderIds: ['r2'],
        departureId: dep.id,
      }),
    ]);
  });

  it('a driver whose fixes stay outside the geofence (GPS under the bridge) runs no meter', async () => {
    const h = routesHarness();
    const { dep, a, b } = await twoRiders(h);
    h.advance(20);
    await h.driverAt(dep.id, BAB1, 200);
    await h.checkIn(dep.id, b.id);
    h.advance(25);
    await h.checkIn(dep.id, a.id);
    expect((await h.departures.booking(a.id)).lateMinutes).toBeNull();
    expect(settled(h, 'rider')).toHaveLength(0);
  });

  it('no other rider checked in → no meter; cash reservations never get one', async () => {
    const h = routesHarness();
    const { dep, a } = await twoRiders(h, 'cash');
    h.advance(20);
    await h.driverAt(dep.id);
    h.advance(25);
    const view = await h.rpc.driverDeparture(
      { personId: 'd1', sessionId: 's' },
      { departureId: dep.id },
    );
    expect(view.bookings.map((x) => x.meterMinutes)).toEqual([null, null]);
    await h.checkIn(dep.id, a.id);
    expect((await h.departures.booking(a.id)).lateMinutes).toBeNull();
  });

  it('the meter freezes when the driver leaves the geofence before departing; within grace nothing is posted', async () => {
    const h = routesHarness();
    const { dep, a, b } = await twoRiders(h);
    h.advance(20);
    await h.driverAt(dep.id);
    h.advance(5);
    await h.checkIn(dep.id, b.id);
    h.advance(10);
    await h.driverAt(dep.id, BAB1, 400); // 12:35, off to fetch tea
    h.advance(15);
    await h.checkIn(dep.id, a.id); // 12:50
    expect((await h.departures.booking(a.id)).lateMinutes).toBe(5);
    expect(settled(h, 'rider')).toHaveLength(0);
    expect(h.events.types()).toContain('departure.driver_left_garage');
  });
});

describe('driver late meter at the garage departure (review C-31/39)', () => {
  async function lateDriver(h: RoutesHarness, opts: { checkpoint?: boolean } = {}) {
    const { dep, a, b } = await twoRiders(h);
    if (opts.checkpoint) {
      h.advance(10);
      await h.departures.driverPosition('d1', dep.id, offsetNorth(MADAIN_CHECKPOINT, 50));
      h.advance(35);
    } else h.advance(45);
    await h.driverAt(dep.id); // 12:45: 15 min late
    h.advance(1);
    await h.checkIn(dep.id, a.id);
    await h.checkIn(dep.id, b.id);
    h.advance(1);
    await h.departures.depart('d1', dep.id);
    return dep;
  }

  it('from the announced time to his check-in fix, paid to every rider who waited', async () => {
    const h = routesHarness();
    const dep = await lateDriver(h);
    expect(settled(h, 'driver')).toEqual([
      expect.objectContaining({
        departureId: dep.id,
        minutesLate: 15,
        late: { kind: 'driver', id: 'd1' },
        waitingRiderIds: ['r1', 'r2'],
      }),
    ]);
    expect(h.events.last('departure.departed')?.payload['driverMeter']).toMatchObject({
      arrivalMin: 15,
      pastLatestMin: 0,
      waived: false,
      minutes: 15,
    });
  });

  it('waived when his trail stopped inside a seeded checkpoint geofence (default hook)', async () => {
    const h = routesHarness();
    await lateDriver(h, { checkpoint: true });
    expect(settled(h, 'driver')).toHaveLength(0);
    expect(h.events.last('departure.departed')?.payload['driverMeter']).toMatchObject({
      arrivalMin: 0,
      waived: true,
    });
  });

  it('the waiver is a hook: a custom one decides (always / never)', async () => {
    const always = routesHarness({ waiver: { waives: () => true } });
    await lateDriver(always);
    expect(settled(always, 'driver')).toHaveLength(0);
    const never = routesHarness({ waiver: { waives: () => false } });
    await lateDriver(never, { checkpoint: true });
    expect(settled(never, 'driver')).toEqual([expect.objectContaining({ minutesLate: 15 })]);
  });

  it('sitting past the hard latest departure with riders on board counts too', async () => {
    const h = routesHarness();
    const { dep, a, b } = await twoRiders(h);
    h.advance(25);
    await h.driverAt(dep.id);
    await h.checkIn(dep.id, a.id);
    await h.checkIn(dep.id, b.id);
    h.advance(47); // 13:12, latest was 13:00
    await h.departures.depart('d1', dep.id);
    expect(settled(h, 'driver')).toEqual([
      expect.objectContaining({ minutesLate: 12, waitingRiderIds: ['r1', 'r2'] }),
    ]);
  });
});

describe('forfeit after 20 minutes → automatic hold on the next car within 2 h (decisions §8, review C-40)', () => {
  it('the prepaid rider is moved at no extra charge; the driver keeps the meter; nothing posts as a no-show', async () => {
    const h = routesHarness();
    const { dep, a, b } = await twoRiders(h);
    const next = await h.announce({
      driverId: 'd2',
      garageId: BAB2.id,
      departAt: h.at(90),
      latestDepartureAt: h.at(100),
    });
    h.advance(20);
    await h.driverAt(dep.id);
    h.advance(5);
    await h.checkIn(dep.id, b.id);
    h.advance(24); // 12:49 → 19 min on the meter
    expect(await code(h.departures.depart('d1', dep.id))).toBe('depart_blocked');
    h.advance(1);
    const view = await h.rpc.driverDeparture(
      { personId: 'd1', sessionId: 's' },
      { departureId: dep.id },
    );
    expect(view.bookings.find((x) => x.bookingId === a.id)).toMatchObject({
      meterMinutes: 20,
      canNoShow: true,
    });
    expect(view.departBlockers).toEqual([]);
    await h.departures.depart('d1', dep.id);
    const old = await h.departures.booking(a.id);
    expect(old).toMatchObject({ state: 'moved', lateMinutes: 20 });
    const hold = await h.departures.booking(old.movedToBookingId!);
    expect(hold).toMatchObject({
      departureId: next.id,
      state: 'booked',
      origin: 'forfeit_hold',
      prepaid: true,
      payment: 'wallet',
      seatIds: ['front'],
      seatPriceIqd: 5_000,
      frontPremiumIqd: 1_000,
    });
    expect(settled(h, 'rider')).toEqual([
      expect.objectContaining({
        minutesLate: 20,
        late: { kind: 'rider', id: 'r1' },
        waitingRiderIds: ['r2'],
      }),
    ]);
    expect(h.events.ofType('seat.no_show')).toHaveLength(0);
    expect(h.events.types()).toContain('seat.forfeited');
    // a forfeit hold can be refused for a refund any time before that car leaves
    expect((await h.departures.cancel('r1', hold.id)).state).toBe('cancelled_by_rider');
  });

  it('no car within 2 h: dispatcher paged and the private-car board opened for her at the seat price', async () => {
    const h = routesHarness();
    const { dep, a, b } = await twoRiders(h);
    h.advance(20);
    await h.driverAt(dep.id);
    h.advance(5);
    await h.checkIn(dep.id, b.id);
    h.advance(25);
    await h.departures.markNoShow('d1', dep.id, a.id);
    expect((await h.departures.booking(a.id)).state).toBe('cancelled');
    expect(h.events.last('intercity.rider_stranded')?.payload).toMatchObject({
      riderId: 'r1',
      reason: 'forfeit_hold',
    });
    const [post] = await h.requests.mine('r1');
    expect(post).toMatchObject({
      origin: 'stranded',
      priceCapIqd: 6_000,
      state: 'open',
      from: { garageId: BAB1.id },
    });
    const ops = await h.rpc.garageView({ personId: 'ops', sessionId: 's' }, { garageId: BAB1.id });
    expect(ops.stranded).toEqual([expect.objectContaining({ bookingId: a.id, riderId: 'r1' })]);
    expect(ops.openRequests.map((r) => r.id)).toEqual([post!.id]);
  });

  it('a rider who tapped أني بالكراج inside the geofence is never forfeited or no-showed', async () => {
    const h = routesHarness();
    const { dep, a, b } = await twoRiders(h);
    h.advance(20);
    await h.driverAt(dep.id);
    await h.checkIn(dep.id, b.id);
    h.advance(15);
    await h.departures.imHere('r1', a.id, offsetNorth(BAB1, 90));
    h.advance(20);
    expect(await code(h.departures.markNoShow('d1', dep.id, a.id))).toBe('no_show_not_allowed');
    expect(await code(h.departures.depart('d1', dep.id))).toBe('depart_blocked');
  });
});

describe('seatHoldUntil (x3, pure)', () => {
  const dep = { departAt: new Date('2026-10-03T12:30:00Z') } as Parameters<typeof seatHoldUntil>[0];
  const seat = (over: Partial<Parameters<typeof seatHoldUntil>[1]>) => ({ pickup: { kind: 'garage' }, taxiLateUntil: new Date('2026-10-03T12:41:00Z'), ...over }) as Parameters<typeof seatHoldUntil>[1];
  it('the taxi’s due time, capped at the meter cap after the car’s time', () => {
    expect(seatHoldUntil(dep, seat({}), 20, true)).toEqual(new Date('2026-10-03T12:41:00Z'));
    expect(seatHoldUntil(dep, seat({ taxiLateUntil: new Date('2026-10-03T13:20:00Z') }), 20, true)).toEqual(new Date('2026-10-03T12:50:00Z'));
  });
  it('none when switched off, with no late taxi, or off the garage', () => {
    expect(seatHoldUntil(dep, seat({}), 20, false)).toBeNull();
    expect(seatHoldUntil(dep, seat({ taxiLateUntil: null }), 20, true)).toBeNull();
    expect(seatHoldUntil(dep, seat({ pickup: { kind: 'door' } as never }), 20, true)).toBeNull();
  });
});
