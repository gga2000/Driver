import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { AppContext, RoleKind } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';
import { RoutesRpc } from './routes.rpc.js';
import { BAB1, BAB2, NAHDHA, routesHarness, type RoutesHarness } from './test-harness.js';

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

  it('driverCards: a rider sees the driver of a board departure by first name, with today\'s check-in (C-19)', async () => {
    const h = routesHarness();
    const rider = as(h, 'r1', ['customer']);
    const driver = as(h, 'd1', ['intercity_driver']);
    h.riderNames.set('d1', 'حيدر كاظم جواد');
    const dep = await h.announce();
    expect(await rider.driverCards({ departureIds: [dep.id, 'dep_missing'] })).toEqual([
      { departureId: dep.id, driverId: 'd1', firstName: 'حيدر', verifiedTodayAt: null, photoUrl: null },
    ]);
    await driver.driver.selfie({ departureId: dep.id, selfieRef: 'blob/selfie' });
    const [card] = await rider.driverCards({ departureIds: [dep.id] });
    expect(card!.verifiedTodayAt).toBeInstanceOf(Date);
    expect(JSON.stringify(card)).not.toContain('كاظم');
    expect(h.nameReads.every((r) => r.personId === 'd1' && r.accessorId === 'r1' && r.purpose === 'intercity_driver_card')).toBe(true);

    // Off the board (cancelled): only a rider who held a seat on it still sees who it was.
    await h.book('r2', dep.id, ['front']);
    await h.departures.cancelByDriver('d1', dep.id, 'عطل بالسيارة');
    expect(await rider.driverCards({ departureIds: [dep.id] })).toEqual([]);
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

describe('garage mode (partner S-5): the PIN typed on a seat, and the late rider\'s call', () => {
  it('checkIn with bookingId boards only that rider: another rider\'s PIN on this seat is pin_invalid', async () => {
    const h = routesHarness();
    const driver = as(h, 'd1', ['intercity_driver']);
    const dep = await h.announce();
    const a = await h.book('r1', dep.id, ['front']);
    const b = await h.book('r2', dep.id, ['back_left']);
    expect(await codeOf(driver.driver.checkIn({ departureId: dep.id, pin: b.pin!, bookingId: a.id }))).toBe('BAD_REQUEST');
    expect((await h.departures.booking(b.id)).state).toBe('booked');
    const after = await driver.driver.checkIn({ departureId: dep.id, pin: a.pin!, bookingId: a.id });
    expect(after.bookings.find((x) => x.bookingId === a.id)?.state).toBe('checked_in');
    // Without bookingId the PIN pad still finds its rider (the old flow).
    await driver.driver.checkIn({ departureId: dep.id, pin: b.pin! });
    expect((await h.departures.booking(b.id)).state).toBe('checked_in');
  });

  it('callRider: a masked call to his own rider on a live run, logged without numbers; refused otherwise', async () => {
    const h = routesHarness();
    const opened: Array<{ orderId: string; callerId: string; calleeId: string }> = [];
    const calls = {
      open: async (req: { callId: string; orderId: string; callerId: string; calleeId: string }, now: Date) => {
        opened.push(req);
        return { mode: 'proxy' as const, dial: '+9647800000000', expiresAt: new Date(now.getTime() + 120_000) };
      },
    };
    const rpc = new RoutesRpc(h.departures, h.demand, h.requests, h.repo, null, null, calls);
    const ctx = (personId: string, roles: readonly RoleKind[]) =>
      t.createCallerFactory(appRouter)({
        auth: { sub: personId, sid: `s_${personId}`, iss: 'driver-api', iat: 0, exp: 0 },
        authError: null,
        identity: { hasRole: async (_: string, kind: RoleKind) => roles.includes(kind) },
        routes: rpc,
      } as unknown as AppContext).routes;
    const driver = ctx('d1', ['intercity_driver']);
    const rival = ctx('d2', ['intercity_driver']);
    const dep = await h.announce();
    const a = await h.book('r1', dep.id, ['front']);
    const s = await driver.driver.callRider({ departureId: dep.id, bookingId: a.id });
    expect(s).toMatchObject({ mode: 'proxy', dial: '+9647800000000', counterpart: 'customer' });
    expect(opened).toEqual([expect.objectContaining({ orderId: dep.id, callerId: 'd1', calleeId: 'r1' })]);
    const logged = h.events.last('departure.rider_call_requested');
    expect(logged?.payload).toMatchObject({ departureId: dep.id, bookingId: a.id, riderId: 'r1' });
    expect(JSON.stringify(logged?.payload)).not.toContain('+964');
    expect(await codeOf(rival.driver.callRider({ departureId: dep.id, bookingId: a.id }))).toBe('FORBIDDEN');
    expect(await codeOf(driver.driver.callRider({ departureId: dep.id, bookingId: 'bk_nope' }))).toBe('NOT_FOUND');
    // The harness's own RPC has no bridge: call_unavailable.
    expect(await codeOf(as(h, 'd1', ['intercity_driver']).driver.callRider({ departureId: dep.id, bookingId: a.id }))).toBe('CONFLICT');
describe('today (welcome screen, audit d-6)', () => {
  it('counts open cars still leaving today in both directions and names the garage of the next car to Baghdad', async () => {
    // 12:00Z = 15:00 Baghdad: the Baghdad day ends at 21:00Z.
    const h = routesHarness();
    expect(await h.rpc.today()).toEqual({ carsToday: 0, baghdadGarage: { id: BAB1.id, nameAr: BAB1.nameAr, nameEn: BAB1.nameEn } });
    await h.announce({ driverId: 'd1', garageId: BAB2.id, departAt: h.at(60), latestDepartureAt: h.at(90) });
    await h.announce({ driverId: 'd2', departAt: h.at(180), latestDepartureAt: h.at(200) });
    await h.announce({ driverId: 'd3', garageId: NAHDHA.id, departAt: h.at(120), latestDepartureAt: h.at(150) });
    // Tomorrow (Baghdad day) does not count.
    await h.announce({ driverId: 'd4', departAt: h.at(10 * 60), latestDepartureAt: h.at(10 * 60 + 30) });
    expect(await h.rpc.today()).toEqual({ carsToday: 3, baghdadGarage: { id: BAB2.id, nameAr: BAB2.nameAr, nameEn: BAB2.nameEn } });
  });
});
