import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { AppContext, RoleKind } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';
import { BAB1, NAHDHA, routesHarness, type RoutesHarness } from './test-harness.js';

/**
 * The real `RoutesRpc` behind the shared router: role gates, ownership and — above all — every view
 * the API builds passes the router's output schemas (what the customer and partner apps code against).
 */
function as(h: RoutesHarness, personId: string, roles: readonly RoleKind[]) {
  const ctx = {
    auth: { sub: personId, sid: `s_${personId}`, iss: 'driver-api', iat: 0, exp: 0 },
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => roles.includes(kind) },
    routes: h.rpc,
  } as unknown as AppContext;
  return t.createCallerFactory(appRouter)(ctx).routes;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

describe('routes over tRPC: a whole run through the router (outputs validate against the contracts)', () => {
  it('network → announce → board → hold → book → boarding pass → check-in → depart → arrive', async () => {
    const h = routesHarness();
    const driver = as(h, 'd1', ['intercity_driver']);
    const rider = as(h, 'r1', ['customer']);
    const other = as(h, 'r2', ['customer']);

    const net = await rider.network();
    expect(net.garages.map((g) => g.id)).toEqual([
      'mp_garage_bab1',
      'mp_garage_bab2',
      'mp_garage_souq',
      'mp_garage_nahdha',
      'mp_garage_kut',
    ]);
    expect(net.corridors.map((c) => [c.id, c.seatPriceIqd, c.placeholderPrice])).toEqual([
      ['aziziyah_baghdad', 10_000, true],
      ['aziziyah_kut', 5_000, true],
    ]);

    const dep = await driver.driver.announce({
      garageId: BAB1.id,
      corridorId: 'aziziyah_baghdad',
      departAt: h.at(40),
      latestDepartureAt: h.at(70),
      vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 12345', model: 'Sonata' },
    });
    expect(dep).toMatchObject({
      state: 'scheduled',
      frontSeat: 'free',
      fill: { seatsTotal: 4, filled: 0 },
      departBlockers: [{ bookingId: null, reason: 'too_early_not_full' }],
    });

    const board = await rider.board({ garageId: BAB1.id, travellingAs: 'nisa' });
    expect(board.garage?.nameAr).toBe('كراج البوابة 1');
    expect(board.departures.map((d) => d.id)).toEqual([dep.id]);
    expect(board.departures[0]!.seats.map((s) => [s.id, s.state, s.premiumIqd])).toEqual([
      ['front', 'free', 2_000],
      ['back_left', 'free', 0],
      ['back_middle', 'free', 0],
      ['back_right', 'free', 0],
    ]);
    expect(board.departures[0]!.meetingPoints).toHaveLength(3);

    const held = await rider.holdSeat({
      departureId: dep.id,
      selection: { kind: 'seats', seatIds: ['front'] },
      travellingAs: 'nisa',
    });
    expect(held).toMatchObject({
      state: 'held',
      totalIqd: 12_000,
      prepayRail: null,
      departure: { id: dep.id, garageId: BAB1.id },
    });
    expect(await codeOf(other.bookSeat({ bookingId: held.id, payment: 'cash' }))).toBe('NOT_FOUND');
    h.wallet.set('r1', 50_000);
    const booked = await rider.bookSeat({ bookingId: held.id, payment: 'wallet' });
    expect(booked).toMatchObject({ state: 'booked', prepaid: true, prepayRail: 'wallet' });
    expect(booked.pin).toMatch(/^\d{4}$/);

    const pass = await rider.boardingPass({ bookingId: held.id });
    expect(pass).toMatchObject({
      boardingOpen: false,
      car: null,
      idReminder: true,
      prepayRail: 'wallet',
      myStop: { kind: 'garage', nameAr: 'كراج البوابة 1' },
    });
    expect(await codeOf(other.boardingPass({ bookingId: held.id }))).toBe('NOT_FOUND');

    await driver.driver.selfie({ departureId: dep.id, selfieRef: 'blob/selfie' });
    for (const seat of ['back_left', 'back_middle', 'back_right'] as const)
      await driver.driver.markWalkUp({ departureId: dep.id, seatId: seat, travellingAs: 'rijal' });
    h.advance(15);
    const pos = await driver.driver.position({ departureId: dep.id, lat: BAB1.lat, lng: BAB1.lng });
    expect(pos).toMatchObject({ driverInsideGarage: true, fill: { filled: 4 } });
    const livePass = await rider.boardingPass({ bookingId: held.id });
    expect(livePass.boardingOpen).toBe(true);
    expect(livePass.car).toMatchObject({ lat: BAB1.lat, lng: BAB1.lng });

    const checked = await driver.driver.checkIn({ departureId: dep.id, pin: booked.pin! });
    expect(checked.bookings[0]).toMatchObject({ state: 'checked_in', atGarage: false });
    expect(
      await codeOf(as(h, 'd2', ['intercity_driver']).driver.depart({ departureId: dep.id })),
    ).toBe('FORBIDDEN');
    const gone = await driver.driver.depart({ departureId: dep.id });
    expect(gone.state).toBe('departed');
    const done = await driver.driver.arrive({ departureId: dep.id });
    expect(done.bookings[0]!.state).toBe('completed');
    expect((await rider.myBookings())[0]).toMatchObject({ state: 'completed', pin: null });
    expect(await driver.driver.mine()).toHaveLength(1);
  });

  it('demand board, request board and the ops garage view validate too', async () => {
    const h = routesHarness();
    const rider = as(h, 'r1', ['customer']);
    const driver = as(h, 'd1', ['intercity_driver']);
    const ops = as(h, 'ops', ['dispatcher']);

    const post = await rider.postDemand({
      corridorId: 'aziziyah_baghdad',
      direction: 'to_aziziyah',
      windowStart: h.at(60),
      windowEnd: h.at(120),
      seats: 2,
      travellingAs: 'nisa',
      pickup: { kind: 'garage', garageId: NAHDHA.id },
    });
    expect(post).toMatchObject({ state: 'open', garageId: NAHDHA.id, pickupKind: 'garage' });
    expect(
      await driver.driver.demand({ corridorId: 'aziziyah_baghdad', direction: 'to_aziziyah' }),
    ).toEqual([expect.objectContaining({ postedSeats: 2, claimedSeats: 0 })]);
    await driver.driver.announce({
      garageId: NAHDHA.id,
      corridorId: 'aziziyah_baghdad',
      departAt: h.at(90),
      latestDepartureAt: h.at(100),
      vehicle: { kind: 'suv', layout: 6, plate: 'بغداد 9' },
    });
    expect((await rider.myDemand())[0]).toMatchObject({ state: 'claimed' });
    const bookings = await rider.myBookings();
    expect(bookings[0]).toMatchObject({ origin: 'demand_claim', state: 'held' });

    const rq = await rider.requestBoard.post({
      from: { label: 'كراج البوابة ١', garageId: BAB1.id },
      to: { label: 'الصويرة' },
      when: h.at(60),
      seats: 2,
      travellingAs: 'aila',
      note: 'شنطتين',
    });
    const listed = await driver.requestBoard.list({});
    expect(listed.map((r) => r.id)).toEqual([rq.id]);
    const offered = await driver.requestBoard.offer({ postId: rq.id, priceIqd: 30_000 });
    h.wallet.set('r1', 20_000);
    const picked = await rider.requestBoard.pick({ postId: rq.id, offerId: offered.offers[0]!.id });
    expect(picked).toMatchObject({ state: 'matched', depositIqd: 6_000 });

    const view = await ops.ops.garage({ garageId: NAHDHA.id });
    expect(view.departures).toHaveLength(1);
    expect(view.demand).toEqual([expect.objectContaining({ claimedSeats: 2 })]);
    expect((await ops.ops.garage({ garageId: BAB1.id })).openRequests.map((r) => r.id)).toEqual([
      rq.id,
    ]);
  });
});

describe('partner wave 2 reads: the manifest names and the driver\'s request-board rides', () => {
  it('driver.riders: first names of his own riders only, every read logged as intercity_manifest', async () => {
    const h = routesHarness();
    const driver = as(h, 'd1', ['intercity_driver']);
    h.riderNames.set('r1', 'زهراء علي حسين');
    const dep = await h.announce();
    const zahraa = await h.book('r1', dep.id, ['front'], { travellingAs: 'nisa' });
    const nameless = await h.book('r2', dep.id, ['back_left']);
    const cancelled = await h.hold('r3', dep.id, ['back_right']);
    await h.departures.cancel('r3', cancelled.id);

    const riders = await driver.driver.riders({ departureId: dep.id });
    expect(riders).toEqual([
      { bookingId: zahraa.id, riderId: 'r1', firstName: 'زهراء' },
      { bookingId: nameless.id, riderId: 'r2', firstName: null },
    ]);
    expect(JSON.stringify(riders)).not.toContain('حسين');
    expect(h.nameReads).toEqual([
      { personId: 'r1', accessorId: 'd1', purpose: 'intercity_manifest' },
      { personId: 'r2', accessorId: 'd1', purpose: 'intercity_manifest' },
    ]);
    // Another driver may not read this manifest.
    expect(await codeOf(as(h, 'd2', ['intercity_driver']).driver.riders({ departureId: dep.id }))).toBe('FORBIDDEN');
  });

  it('requestBoard.myRides: only rides that picked his offer, with price, cash to collect and the no-show time', async () => {
    const h = routesHarness();
    const rider = as(h, 'r1', ['customer']);
    const driver = as(h, 'd1', ['intercity_driver']);
    const rival = as(h, 'd2', ['intercity_driver']);
    const rq = await rider.requestBoard.post({ from: { label: 'كراج البوابة ١', garageId: BAB1.id }, to: { label: 'الحلة' }, when: h.at(30), seats: 3, travellingAs: 'aila' });
    const mine = await driver.requestBoard.offer({ postId: rq.id, priceIqd: 45_000 });
    await rival.requestBoard.offer({ postId: rq.id, priceIqd: 50_000 });
    expect(await driver.requestBoard.myRides()).toEqual([]);
    h.wallet.set('r1', 100_000);
    await rider.requestBoard.pick({ postId: rq.id, offerId: mine.offers[0]!.id });

    const [ride] = await driver.requestBoard.myRides();
    expect(ride).toMatchObject({ id: rq.id, state: 'matched', priceIqd: 45_000, depositIqd: 9_000, cashToCollectIqd: 36_000, driverArrivedAt: null, riderNoShowAt: null });
    expect(await rival.requestBoard.myRides()).toEqual([]);

    h.advance(35);
    await driver.requestBoard.arrived({ postId: rq.id, lat: BAB1.lat, lng: BAB1.lng });
    const [arrived] = await driver.requestBoard.myRides();
    expect(arrived!.state).toBe('driver_arrived');
    expect(arrived!.riderNoShowAt?.getTime()).toBe(h.at(10).getTime());
    await driver.requestBoard.complete({ postId: rq.id });
    expect((await driver.requestBoard.myRides())[0]!.state).toBe('completed');
    // Closed rides drop off after 12 hours.
    h.advance(13 * 60);
    expect(await driver.requestBoard.myRides()).toEqual([]);
  });
});
