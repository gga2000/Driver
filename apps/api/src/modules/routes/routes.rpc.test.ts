import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { PIN_ATTEMPT_RULES, type AppContext, type RoleKind } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';
import { pinAlertFor } from './departures.service.js';
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
      ['aziziyah_baghdad', 5_000, false],
      ['aziziyah_kut', 5_000, false],
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
      ['front', 'free', 1_000],
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
      totalIqd: 6_000,
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
    expect((await rider.myBookings())[0]).toMatchObject({ state: 'completed', pin: null, rating: null });
    expect(await driver.driver.mine()).toHaveLength(1);

    // r2: «شلون كانت الرجعة؟» once, on the rider's own completed booking.
    expect(await codeOf(other.rateBooking({ bookingId: held.id, stars: 5 }))).toBe('NOT_FOUND');
    const rated = await rider.rateBooking({ bookingId: held.id, stars: 5, tags: ['on_time', 'clean_car', 'on_time'] });
    expect(rated.rating).toMatchObject({ stars: 5, tags: ['on_time', 'clean_car'] });
    expect(rated.completedAt).toBeInstanceOf(Date);
    expect(await codeOf(rider.rateBooking({ bookingId: held.id, stars: 1 }))).toBe('CONFLICT');
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
    // The ticket names its far city itself, so طلباتي never guesses the road when the network read fails.
    expect(bookings[0]!.departure).toMatchObject({ corridorId: 'aziziyah_baghdad', cityId: 'baghdad' });

    const rq = await rider.requestBoard.post({
      from: { label: 'كراج البوابة 1', garageId: BAB1.id },
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
      {
        departureId: dep.id,
        driverId: 'd1',
        firstName: 'حيدر',
        verifiedTodayAt: null,
        photoUrl: null,
        stats: { trips: 0, ratingAvg: null, ratingCount: 0, onTimeShare: null, topTags: [], badges: [], ridesWithYou: 0 },
      },
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

  it('ops.departureDrivers: staff see who drives a departed run (riders\' cards stop at the board), one logged read', async () => {
    const h = routesHarness();
    h.riderNames.set('d1', 'حيدر كاظم جواد');
    const ops = as(h, 'ops1', ['dispatcher']);
    const { dep } = await finishRun(h, [{ id: 'r1' }]);
    expect((await h.departures.departure(dep.id)).state).not.toBe('scheduled');
    expect(await as(h, 'r9', ['customer']).driverCards({ departureIds: [dep.id] })).toEqual([]);
    h.nameReads.length = 0;
    expect(await ops.ops.departureDrivers({ departureIds: [dep.id, dep.id, 'dep_missing'] })).toEqual([
      { departureId: dep.id, driverId: 'd1', displayName: 'حيدر ك.', phoneMasked: '0770 ••• ••01' },
    ]);
    expect(h.nameReads).toEqual([{ personId: 'd1', accessorId: 'ops1', purpose: 'intercity_ops_departure' }]);
    expect(await ops.ops.departureDrivers({ departureIds: ['dep_missing'] })).toEqual([]);
    // Ops roles only.
    expect(await codeOf(as(h, 'd1', ['intercity_driver']).ops.departureDrivers({ departureIds: [dep.id] }))).toBe('FORBIDDEN');
    expect(await codeOf(as(h, 'r1', ['customer']).ops.departureDrivers({ departureIds: [dep.id] }))).toBe('FORBIDDEN');
  });

  /** d1 announces, each rider books a back seat, the rest are walk-ups; he checks in on time, leaves, arrives. */
  async function finishRun(h: RoutesHarness, riders: readonly { id: string }[], late = 0) {
    const dep = await h.announce({ departAt: h.at(40), latestDepartureAt: h.at(70), vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 12345', modelKey: 'elantra', noSmoking: true } });
    const seats = ['back_left', 'back_middle', 'back_right', 'front'] as const;
    const booked = [];
    for (const [i, r] of riders.entries()) booked.push(await h.book(r.id, dep.id, [seats[i]!]));
    await h.departures.selfie('d1', dep.id, 'blob/selfie');
    for (const seat of seats.slice(riders.length)) await h.departures.markWalkUp('d1', dep.id, { seatId: seat, travellingAs: 'rijal' });
    h.advance(30 + late);
    await h.driverAt(dep.id);
    for (const b of booked) await h.checkIn(dep.id, b.id);
    h.advance(Math.max(0, 10 - late));
    await h.departures.depart('d1', dep.id);
    h.advance(90);
    await h.departures.arrive('d1', dep.id);
    return { dep, booked };
  }

  it('«ملفه» (x12–x17): record, bars, one-line reviews without names, «سافرت وياه قبل», and ops hiding a line', async () => {
    const h = routesHarness();
    h.riderNames.set('d1', 'حيدر كاظم جواد');
    const riders = ['r1', 'r2', 'r3'].map((id) => ({ id, api: as(h, id, ['customer']) }));
    const { booked } = await finishRun(h, [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]);
    const say = ['سايق محترم وسيارته نظيفة', 'وصلنا على الوقت', ''];
    for (const [i, r] of riders.entries()) {
      const out = await r.api.rateBooking({ bookingId: booked[i]!.id, stars: 5 - i, tags: i === 2 ? ['on_time'] : ['on_time', 'clean_car'], comment: `  ${say[i]}  ` });
      expect(out.rating?.comment).toBe(say[i] || null);
      h.advance(1);
    }

    // A line with a phone number (Arabic-Indic digits too) or a link is refused whole.
    const late = await finishRun(h, [{ id: 'r4' }]);
    const r4 = as(h, 'r4', ['customer']);
    expect(await codeOf(r4.rateBooking({ bookingId: late.booked[0]!.id, stars: 5, comment: 'كلموه ٠٧٧٠ ١٢٣ ٤٥٦٧' }))).toBe('BAD_REQUEST');
    expect(await codeOf(r4.rateBooking({ bookingId: late.booked[0]!.id, stars: 5, comment: 'شوفوا www.example.com' }))).toBe('BAD_REQUEST');
    expect((await r4.myBookings())[0]!.rating).toBeNull();

    // A third run where he reached the garage 10 minutes late (past the meter's 5-minute grace).
    await finishRun(h, [], 20);

    // A new run on the board: every rider sees his record; r1 rode with him once.
    const next = await h.announce({ vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 12345', modelKey: 'elantra', bigBags: true } });
    const [card] = await riders[0]!.api.driverCards({ departureIds: [next.id] });
    expect(card!.stats).toEqual({ trips: 3, ratingAvg: 4, ratingCount: 3, onTimeShare: 2 / 3, topTags: ['on_time', 'clean_car'], badges: ['big_bags'], ridesWithYou: 1 });
    expect((await as(h, 'r9', ['customer']).driverCards({ departureIds: [next.id] }))[0]!.stats.ridesWithYou).toBe(0);

    const profile = await riders[0]!.api.driverProfile({ departureId: next.id });
    expect(profile.card.firstName).toBe('حيدر');
    expect(profile.vehicle).toMatchObject({ modelKey: 'elantra', model: 'النترا', bigBags: true, noSmoking: false });
    expect(profile.firstTripAt).toBeInstanceOf(Date);
    expect(profile.qualities.map((q) => [q.tag, q.count])).toEqual([
      ['on_time', 3],
      ['calm_driving', 0],
      ['clean_car', 2],
      ['respectful', 0],
    ]);
    expect(profile.reviews.map((r) => [r.stars, r.text])).toEqual([
      [4, 'وصلنا على الوقت'],
      [5, 'سايق محترم وسيارته نظيفة'],
    ]);
    expect(profile.reviewCount).toBe(2);
    expect(JSON.stringify(profile)).not.toMatch(/r1|r2|كاظم/);
    // Asked by departure only, and only one the rider can see.
    expect(await codeOf(riders[0]!.api.driverProfile({ departureId: 'dep_missing' }))).toBe('NOT_FOUND');

    // Ops: support reads the lines and hides one; a rider can't; the profile drops it; unhide puts it back.
    const support = as(h, 'staff1', ['support']);
    expect(await codeOf(riders[0]!.api.ops.reviews({}))).toBe('FORBIDDEN');
    const list = await support.ops.reviews({});
    expect(list.map((r) => [r.text, r.driverFirstName, r.hiddenAt])).toEqual([
      ['وصلنا على الوقت', 'حيدر', null],
      ['سايق محترم وسيارته نظيفة', 'حيدر', null],
    ]);
    const hidden = await support.ops.hideReview({ bookingId: list[0]!.bookingId, reason: 'untrue' });
    expect(hidden).toMatchObject({ hiddenBy: 'staff1', hiddenReason: 'untrue' });
    expect((await riders[0]!.api.driverProfile({ departureId: next.id })).reviews.map((r) => r.text)).toEqual(['سايق محترم وسيارته نظيفة']);
    expect((await support.ops.reviews({ hidden: true })).map((r) => r.bookingId)).toEqual([list[0]!.bookingId]);
    expect(h.events.types()).toContain('review.hidden');
    // The writer still sees his own line.
    expect((await riders[1]!.api.myBookings())[0]!.rating?.comment).toBe('وصلنا على الوقت');
    await support.ops.unhideReview({ bookingId: list[0]!.bookingId });
    expect((await riders[0]!.api.driverProfile({ departureId: next.id })).reviewCount).toBe(2);
    expect(await codeOf(support.ops.hideReview({ bookingId: booked[2]!.id, reason: 'rude' }))).toBe('NOT_FOUND');
  });

  it('requestBoard offers carry the driver card for the rider: first name, today\'s check-in, his car (R-01)', async () => {
    const h = routesHarness();
    const rider = as(h, 'r1', ['customer']);
    const driver = as(h, 'd1', ['intercity_driver']);
    const fresh = as(h, 'd3', ['intercity_driver']);
    h.riderNames.set('d1', 'حيدر كاظم جواد');
    const dep = await h.announce({ vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 12345', model: 'سوناتا', color: 'بيضاء' } });
    await driver.driver.selfie({ departureId: dep.id, selfieRef: 'blob/selfie' });
    const rq = await rider.requestBoard.post({ from: { label: 'كراج البوابة 1', garageId: BAB1.id }, to: { label: 'الحلة' }, when: h.at(30), seats: 2, travellingAs: 'aila' });
    await driver.requestBoard.offer({ postId: rq.id, priceIqd: 45_000 });
    await fresh.requestBoard.offer({ postId: rq.id, priceIqd: 40_000 });
    const [mine] = await rider.requestBoard.mine();
    const byDriver = new Map(mine!.offers.map((o) => [o.driverId, o.driver]));
    expect(byDriver.get('d1')).toMatchObject({ firstName: 'حيدر', photoUrl: null, vehicle: { kind: 'saloon', plate: 'واسط 12345', model: 'سوناتا', color: 'بيضاء' } });
    expect(byDriver.get('d1')!.verifiedTodayAt).toBeInstanceOf(Date);
    expect(byDriver.get('d3')).toEqual({ firstName: null, verifiedTodayAt: null, photoUrl: null, vehicle: null, stats: null, privateTrips: 0 });
    // y5: a driver who has run a seat departure brings his record (no ratings yet → «جديد»).
    expect(byDriver.get('d1')!.stats).toMatchObject({ trips: 0, ratingAvg: null, ridesWithYou: 0 });
    expect(JSON.stringify(mine)).not.toContain('كاظم');
    // The driver's own view of the board does not read other drivers' names.
    const [seen] = await driver.requestBoard.list({});
    expect(seen!.offers.every((o) => o.driver === null)).toBe(true);
  });

  it('requestBoard: the rider sees how many drivers opened his request; drivers never see the count (y4)', async () => {
    const h = routesHarness();
    const rider = as(h, 'r1', ['customer']);
    const d1 = as(h, 'd1', ['intercity_driver']);
    const d2 = as(h, 'd2', ['intercity_driver']);
    const rq = await rider.requestBoard.post({
      from: { label: 'كراج البوابة 1', garageId: BAB1.id },
      to: { label: 'مطار بغداد' },
      when: h.at(60),
      seats: 2,
      travellingAs: 'aila',
      details: { trip: 'wait_return', waitHours: 3, bigBags: 2, carKind: 'suv', ac: true },
    });
    expect(rq.details).toMatchObject({ trip: 'wait_return', waitHours: 3, returnAt: null, bigBags: 2, carKind: 'suv', ac: true });
    expect(rq.seenBy).toBe(0);
    await d1.requestBoard.seen({ postId: rq.id });
    await d1.requestBoard.seen({ postId: rq.id });
    const forDriver = await d2.requestBoard.seen({ postId: rq.id });
    expect(forDriver.seenBy).toBe(0);
    expect(forDriver.details.trip).toBe('wait_return');
    expect((await rider.requestBoard.mine())[0]!.seenBy).toBe(2);
    expect(await codeOf(rider.requestBoard.seen({ postId: rq.id }))).toBe('FORBIDDEN');
  });

  it('requestBoard.myRides: only rides that picked his offer, with price, cash to collect and the no-show time', async () => {
    const h = routesHarness();
    const rider = as(h, 'r1', ['customer']);
    const driver = as(h, 'd1', ['intercity_driver']);
    const rival = as(h, 'd2', ['intercity_driver']);
    const rq = await rider.requestBoard.post({ from: { label: 'كراج البوابة 1', garageId: BAB1.id }, to: { label: 'الحلة' }, when: h.at(30), seats: 3, travellingAs: 'aila' });
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
    const rpc = new RoutesRpc(h.departures, h.demand, h.requests, h.agreements, h.repo, null, null, calls);
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
  });
});

describe('seat PIN safeguards (Ali 2026-10-06): every PIN typed is logged, cross-use and repeated wrong PINs alert ops', () => {
  const wrongPins = (...taken: Array<string | null | undefined>) => ['0000', '1111', '2222', '3333', '4444', '5555', '6666'].filter((p) => !taken.includes(p));

  it('a rider\'s PIN typed on another rider\'s seat stays refused, is logged and raises one cross-use alert with the attempt history', async () => {
    const h = routesHarness();
    h.riderNames.set('r1', 'زينب علي حسن');
    h.riderNames.set('r2', 'مصطفى كريم');
    h.riderNames.set('d1', 'حيدر كاظم جواد');
    const driver = as(h, 'd1', ['intercity_driver']);
    const ops = as(h, 'ops1', ['dispatcher']);
    const dep = await h.announce();
    const a = await h.book('r1', dep.id, ['front']);
    const b = await h.book('r2', dep.id, ['back_left']);

    expect(await codeOf(driver.driver.checkIn({ departureId: dep.id, pin: b.pin!, bookingId: a.id }))).toBe('BAD_REQUEST');
    expect((await h.departures.booking(a.id)).state).toBe('booked');
    expect((await h.departures.booking(b.id)).state).toBe('booked');

    const events = h.events.ofType('seat.pin_alert');
    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBe('d1');
    expect(events[0]!.payload).toMatchObject({ departureId: dep.id, cityId: 'aziziyah', alert: 'cross_use', targetBookingId: a.id, targetSeatIds: ['front'], matchedBookingId: b.id, matchedSeatIds: ['back_left'], result: 'other_booking', refusedOnSeat: 1 });

    // Then the right PIN on the right seat boards (and is logged too).
    await driver.driver.checkIn({ departureId: dep.id, pin: a.pin!, bookingId: a.id });

    const [alert, ...rest] = await ops.ops.pinAlerts({ cityId: 'aziziyah' });
    expect(rest).toEqual([]);
    expect(alert).toMatchObject({
      kind: 'cross_use',
      departureId: dep.id,
      garageNameAr: 'كراج البوابة 1',
      driver: { personId: 'd1', displayName: 'حيدر ك.', phoneMasked: '0770 ••• ••01' },
      targetBookingId: a.id,
      targetSeatIds: ['front'],
      matchedBookingId: b.id,
      matchedSeatIds: ['back_left'],
      refusedOnSeat: 1,
    });
    expect(alert!.attempts.map((x) => [x.result, x.driverId, x.targetBookingId, x.matchedBookingId, x.alert])).toEqual([
      ['other_booking', 'd1', a.id, b.id, 'cross_use'],
      ['checked_in', 'd1', a.id, a.id, null],
    ]);
    // The driver's card is a logged vault read for the staff member asking; riders' names are never read.
    expect(h.nameReads).toEqual([{ personId: 'd1', accessorId: 'ops1', purpose: 'intercity_pin_alert' }]);
    // Ids, seats and the driver's short name only: no PIN, no rider name, no number.
    const wire = JSON.stringify([alert, events[0]!.payload, await h.repo.pinAttemptsFor(dep.id)]);
    for (const secret of [a.pin!, b.pin!, 'زينب', 'مصطفى', 'كاظم جواد', '+964']) expect(wire).not.toContain(secret);
    // The same history straight from the departure.
    expect((await ops.ops.pinAttempts({ departureId: dep.id })).map((x) => x.result)).toEqual(['other_booking', 'checked_in']);

    // Ops roles only.
    expect(await codeOf(driver.ops.pinAlerts({ cityId: 'aziziyah' }))).toBe('FORBIDDEN');
    expect(await codeOf(as(h, 'r1', ['customer']).ops.pinAttempts({ departureId: dep.id }))).toBe('FORBIDDEN');

    // The row leaves the strip after PIN_ATTEMPT_RULES.alertShowMin; the log stays.
    h.advance(PIN_ATTEMPT_RULES.alertShowMin + 1);
    expect(await ops.ops.pinAlerts({ cityId: 'aziziyah' })).toEqual([]);
    expect(await ops.ops.pinAttempts({ departureId: dep.id })).toHaveLength(2);
  });

  it(`the ${PIN_ATTEMPT_RULES.wrongOnSeatAlertAt}rd refused PIN on one seat alerts once; the plain pad counts on its own`, async () => {
    const h = routesHarness();
    const driver = as(h, 'd1', ['intercity_driver']);
    const ops = as(h, 'ops1', ['support']);
    const dep = await h.announce();
    const a = await h.book('r1', dep.id, ['front']);
    const wrong = wrongPins(a.pin);
    const onSeat = (pin: string) => codeOf(driver.driver.checkIn({ departureId: dep.id, pin, bookingId: a.id }));
    const onPad = (pin: string) => codeOf(driver.driver.checkIn({ departureId: dep.id, pin }));

    for (const pin of wrong.slice(0, PIN_ATTEMPT_RULES.wrongOnSeatAlertAt - 1)) expect(await onSeat(pin)).toBe('BAD_REQUEST');
    // Wrong PINs on the pad do not add to the seat's count.
    for (const pin of wrong.slice(0, PIN_ATTEMPT_RULES.wrongOnSeatAlertAt - 1)) expect(await onPad(pin)).toBe('BAD_REQUEST');
    expect(await ops.ops.pinAlerts({ cityId: 'aziziyah' })).toEqual([]);

    expect(await onSeat(wrong[2]!)).toBe('BAD_REQUEST');
    const [seatAlert] = await ops.ops.pinAlerts({ cityId: 'aziziyah' });
    expect(seatAlert).toMatchObject({ kind: 'wrong_repeated', targetBookingId: a.id, targetSeatIds: ['front'], matchedBookingId: null, refusedOnSeat: PIN_ATTEMPT_RULES.wrongOnSeatAlertAt });

    // A 4th on the seat does not alert again; the pad's 3rd does (its own count, no seat).
    expect(await onSeat(wrong[3]!)).toBe('BAD_REQUEST');
    expect(await onPad(wrong[2]!)).toBe('BAD_REQUEST');
    const alerts = await ops.ops.pinAlerts({ cityId: 'aziziyah' });
    expect(alerts.map((x) => [x.kind, x.targetBookingId, x.refusedOnSeat])).toEqual([
      ['wrong_repeated', null, 3],
      ['wrong_repeated', a.id, 3],
    ]);
    expect(h.events.ofType('seat.pin_alert')).toHaveLength(2);
    expect(alerts[0]!.attempts).toHaveLength(7);

    // The seat still boards with its own PIN, and that is logged as a success.
    await driver.driver.checkIn({ departureId: dep.id, pin: a.pin!, bookingId: a.id });
    expect((await h.departures.booking(a.id)).state).toBe('checked_in');
    expect((await h.repo.pinAttemptsFor(dep.id)).at(-1)).toMatchObject({ result: 'checked_in', targetBookingId: a.id, matchedBookingId: a.id, alert: null, refusedOnSeat: 0 });
    // A rider already on board, his PIN again: refused as not boardable, not a cross-use.
    expect(await onSeat(a.pin!)).toBe('BAD_REQUEST');
    expect((await h.repo.pinAttemptsFor(dep.id)).at(-1)).toMatchObject({ result: 'not_boardable', matchedBookingId: a.id, alert: null });
  });

  it('a successful PIN on the plain pad is logged with whose booking it boarded', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const a = await h.book('r1', dep.id, ['back_right']);
    await h.checkIn(dep.id, a.id);
    expect(await h.repo.pinAttemptsFor(dep.id)).toEqual([
      expect.objectContaining({ departureId: dep.id, cityId: 'aziziyah', driverId: 'd1', targetBookingId: null, matchedBookingId: a.id, result: 'checked_in', alert: null, at: h.clock.now() }),
    ]);
    expect(h.events.ofType('seat.pin_alert')).toEqual([]);
  });

  it('another driver cannot type PINs on a car that is not his (nothing logged)', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const a = await h.book('r1', dep.id, ['front']);
    expect(await codeOf(as(h, 'd2', ['intercity_driver']).driver.checkIn({ departureId: dep.id, pin: a.pin!, bookingId: a.id }))).toBe('FORBIDDEN');
    expect(await h.repo.pinAttemptsFor(dep.id)).toEqual([]);
  });

  it('the strip\'s call: a masked call from the staff member to the driver, logged on the departure without numbers', async () => {
    const h = routesHarness();
    const opened: Array<{ orderId: string; callerId: string; calleeId: string }> = [];
    const calls = {
      open: async (req: { callId: string; orderId: string; callerId: string; calleeId: string }, now: Date) => {
        opened.push(req);
        return { mode: 'proxy' as const, dial: '+9647800000000', expiresAt: new Date(now.getTime() + 120_000) };
      },
    };
    const rpc = new RoutesRpc(h.departures, h.demand, h.requests, h.agreements, h.repo, null, null, calls);
    const ops = t.createCallerFactory(appRouter)({
      auth: { sub: 'ops1', sid: 's_ops1', iss: 'driver-api', iat: 0, exp: 0 },
      authError: null,
      identity: { hasRole: async (_: string, kind: RoleKind) => kind === 'dispatcher' },
      routes: rpc,
    } as unknown as AppContext).routes;
    const dep = await h.announce();
    const a = await h.book('r1', dep.id, ['front']);
    const b = await h.book('r2', dep.id, ['back_left']);
    await expect(h.departures.checkIn('d1', dep.id, b.pin!, a.id)).rejects.toMatchObject({ code: 'pin_invalid' });
    const [alert] = await ops.ops.pinAlerts({ cityId: 'aziziyah' });
    // No identity reader: the row still shows, without a name.
    expect(alert!.driver).toEqual({ personId: 'd1', displayName: null, phoneMasked: null });
    expect(await ops.ops.callPinAlertDriver({ alertId: alert!.alertId })).toMatchObject({ mode: 'proxy', dial: '+9647800000000' });
    expect(opened).toEqual([expect.objectContaining({ orderId: dep.id, callerId: 'ops1', calleeId: 'd1' })]);
    const logged = h.events.last('departure.pin_alert_call_requested');
    expect(logged?.actorId).toBe('ops1');
    expect(logged?.payload).toMatchObject({ departureId: dep.id, attemptId: alert!.alertId, driverId: 'd1', mode: 'proxy' });
    expect(JSON.stringify(logged?.payload)).not.toContain('+964');
    expect(await codeOf(ops.ops.callPinAlertDriver({ alertId: 'pa_nope' }))).toBe('NOT_FOUND');
  });
});

describe('pinAlertFor', () => {
  it('cross-use always alerts; wrong PINs alert at the limit, once per seat; a boarding never does', () => {
    expect(pinAlertFor('other_booking', 1, false)).toBe('cross_use');
    expect(pinAlertFor('other_booking', 5, true)).toBe('cross_use');
    expect(pinAlertFor('wrong_pin', PIN_ATTEMPT_RULES.wrongOnSeatAlertAt - 1, false)).toBeNull();
    expect(pinAlertFor('wrong_pin', PIN_ATTEMPT_RULES.wrongOnSeatAlertAt, false)).toBe('wrong_repeated');
    expect(pinAlertFor('not_boardable', PIN_ATTEMPT_RULES.wrongOnSeatAlertAt + 1, false)).toBe('wrong_repeated');
    expect(pinAlertFor('wrong_pin', PIN_ATTEMPT_RULES.wrongOnSeatAlertAt + 1, true)).toBeNull();
    expect(pinAlertFor('checked_in', 9, false)).toBeNull();
  });
});

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
