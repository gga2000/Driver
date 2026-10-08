import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AnnounceInput,
  AZIZIYAH_MONEY_RULES,
  HoldSeatInput,
  PostDemandInput,
  PostRequestInput,
} from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { LEDGER_SUBSCRIBED_EVENTS } from '../ledger/index.js';
import { PrismaLedgerRepository, type LedgerEventDelegate } from '../ledger/prisma.repository.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { DemandService } from './demand.service.js';
import { DeparturesService } from './departures.service.js';
import { RecordingRoutesEvents } from './events.adapter.js';
import { INTERCITY_NETWORK, INTERCITY_RULES } from './intercity.config.js';
import { TrailCheckpointWaiver } from './late-meter.js';
import { PrismaRoutesRepository } from './prisma.repository.js';
import { RequestBoardService } from './request-board.service.js';
import { RoutesScheduler } from './scheduler.js';
import { randomIds } from './support.js';
import { FakeWallet } from './wallet.js';
import { RoutesWriter } from './writer.js';

/**
 * The routes module on a real Postgres (migrations deployed, seed loaded): departures with their
 * run state, seat bookings, demand posts and the request board round-trip through
 * `PrismaRoutesRepository`, under the advisory-locked writer. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('routes on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const clock = new FakeClock(new Date(Date.now() + 3600_000).toISOString());
  const repo = new PrismaRoutesRepository(prisma);
  const events = new RecordingRoutesEvents();
  const wallet = new FakeWallet();
  const writer = new RoutesWriter(uow, repo);
  const requests = new RequestBoardService(
    repo,
    events,
    wallet,
    clock,
    writer,
    INTERCITY_NETWORK,
    INTERCITY_RULES,
    randomIds,
  );
  const departures = new DeparturesService(
    repo,
    events,
    wallet,
    clock,
    writer,
    requests,
    INTERCITY_NETWORK,
    INTERCITY_RULES,
    AZIZIYAH_MONEY_RULES,
    new TrailCheckpointWaiver(),
    randomIds,
  );
  const demand = new DemandService(
    repo,
    events,
    clock,
    writer,
    departures,
    INTERCITY_NETWORK,
    randomIds,
  );
  const scheduler = new RoutesScheduler(writer, departures, demand, requests);
  const ids = { driver: '', d2: '', r1: '', r2: '' };
  const at = (min: number) => new Date(clock.now().getTime() + min * 60_000);

  beforeAll(async () => {
    const db = prisma.prisma;
    ids.driver = (await db.person.create({ data: {} })).id;
    ids.r1 = (await db.person.create({ data: {} })).id;
    ids.r2 = (await db.person.create({ data: {} })).id;
    ids.d2 = (await db.person.create({ data: {} })).id;
  });

  afterAll(async () => {
    const db = prisma.prisma;
    const deps = await db.departure.findMany({
      where: { driverId: { in: [ids.driver, ids.d2] } },
      select: { id: true },
    });
    await db.seatBooking.deleteMany({ where: { departureId: { in: deps.map((d) => d.id) } } });
    await db.departure.deleteMany({ where: { driverId: { in: [ids.driver, ids.d2] } } });
    await db.demandPost.deleteMany({ where: { riderId: { in: [ids.r1, ids.r2] } } });
    const rqs = await db.rideRequest.findMany({
      where: { riderId: { in: [ids.r1, ids.r2] } },
      select: { id: true },
    });
    await db.rideRequestOffer.deleteMany({ where: { requestId: { in: rqs.map((r) => r.id) } } });
    await db.rideRequest.deleteMany({ where: { id: { in: rqs.map((r) => r.id) } } });
    await db.person.deleteMany({ where: { id: { in: [ids.driver, ids.d2, ids.r1, ids.r2] } } });
    await prisma.onModuleDestroy();
  });

  it('a demand claim, a booking, walk-ups and the driver fix survive the round-trip', async () => {
    const post = await demand.post(
      ids.r2,
      PostDemandInput.parse({
        corridorId: 'aziziyah_baghdad',
        direction: 'from_aziziyah',
        windowStart: at(60),
        windowEnd: at(180),
        seats: 1,
        travellingAs: 'nisa',
        pickup: { kind: 'garage' },
      }),
    );
    const dep = await departures.announce(
      ids.driver,
      AnnounceInput.parse({
        garageId: 'mp_garage_bab1',
        corridorId: 'aziziyah_baghdad',
        departAt: at(120),
        latestDepartureAt: at(150),
        vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 1' },
      }),
    );
    expect((await repo.getDemand(post.id))?.state).toBe('claimed');
    const held = await departures.hold(
      ids.r1,
      HoldSeatInput.parse({
        departureId: dep.id,
        selection: { kind: 'seats', seatIds: ['front'] },
        travellingAs: 'rijal',
      }),
    );
    wallet.set(ids.r1, 50_000);
    const booked = await departures.book(ids.r1, held.id, 'wallet');
    expect(booked).toMatchObject({ state: 'booked', prepaid: true, payment: 'wallet' });
    await departures.markWalkUp(ids.driver, dep.id, {
      seatId: 'back_right',
      travellingAs: 'rijal',
    });
    await departures.selfie(ids.driver, dep.id, 'blob/1');
    await departures.driverPosition(ids.driver, dep.id, { lat: 32.9032, lng: 45.0578 });

    const back = await repo.getDeparture(dep.id);
    expect(back).toMatchObject({
      id: dep.id,
      corridorId: 'aziziyah_baghdad',
      direction: 'from_aziziyah',
      layout: 4,
      walkUps: [{ seatId: 'back_right', travellingAs: 'rijal' }],
      selfieRef: 'blob/1',
    });
    expect(back?.driverCheckIn?.at).toBeInstanceOf(Date);
    expect(back?.vehicle.plate).toBe('واسط 1');
    const bookings = await repo.bookingsFor(dep.id);
    expect(bookings.map((b) => [b.riderId, b.state, b.origin])).toEqual([
      [ids.r2, 'held', 'demand_claim'],
      [ids.r1, 'booked', 'rider'],
    ]);
    expect(bookings[1]!.pickup).toMatchObject({ kind: 'garage', status: 'accepted' });
    expect(await departures.seatsFilled(dep.id)).toBe(2);
    expect(await repo.listDepartures({ driverId: ids.driver, states: ['scheduled'] })).toHaveLength(
      1,
    );

    clock.advanceMinutes(11);
    await scheduler.tick();
    expect((await repo.getBooking(bookings[0]!.id))?.state).toBe('expired');
    expect((await repo.getDemand(post.id))?.state).toBe('lapsed');
    expect(await repo.riderStats(ids.r2)).toEqual({ completedBookings: 0, cashStrikes: 1 });
  });

  it('the driver\'s record: a finished run, a rating with its line, the car\'s promises, and a hide round-trip (x12–x15)', async () => {
    const dep = await departures.announce(
      ids.d2,
      AnnounceInput.parse({
        garageId: 'mp_garage_bab1',
        corridorId: 'aziziyah_baghdad',
        departAt: at(40),
        latestDepartureAt: at(70),
        vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 2', modelKey: 'elantra', noSmoking: true, bigBags: true },
      }),
    );
    expect((await repo.getDeparture(dep.id))?.vehicle).toMatchObject({ modelKey: 'elantra', noSmoking: true, bigBags: true });
    const held = await departures.hold(ids.r1, HoldSeatInput.parse({ departureId: dep.id, selection: { kind: 'seats', seatIds: ['back_left'] }, travellingAs: 'rijal' }));
    wallet.set(ids.r1, 50_000);
    const booked = await departures.book(ids.r1, held.id, 'wallet');
    for (const seatId of ['front', 'back_middle', 'back_right'] as const) await departures.markWalkUp(ids.d2, dep.id, { seatId, travellingAs: 'rijal' });
    await departures.selfie(ids.d2, dep.id, 'blob/2');
    clock.advanceMinutes(30);
    await departures.driverPosition(ids.d2, dep.id, { lat: 32.9032, lng: 45.0578 });
    await departures.checkIn(ids.d2, dep.id, booked.pin);
    clock.advanceMinutes(10);
    await departures.depart(ids.d2, dep.id);
    clock.advanceMinutes(90);
    await departures.arrive(ids.d2, dep.id);

    await departures.rate(ids.r1, booked.id, { stars: 5, tags: ['on_time', 'calm_driving'], comment: 'سياقته هادئة' });
    const record = await repo.driverRecord(ids.d2);
    expect(record.runs.map((d) => d.id)).toContain(dep.id);
    expect(departures.runOnTime(record.runs.find((d) => d.id === dep.id)!)).toBe(true);
    const mine = record.rated.find((b) => b.id === booked.id)!;
    expect(mine.rating).toMatchObject({ stars: 5, tags: ['on_time', 'calm_driving'] });
    expect(mine.review).toMatchObject({ text: 'سياقته هادئة', hiddenAt: null, hiddenBy: null, hiddenReason: null });

    await departures.hideReview(ids.r2, booked.id, 'personal_info');
    const hidden = await repo.reviews({ hidden: true, limit: 200 });
    expect(hidden.find((b) => b.id === booked.id)?.review).toMatchObject({ hiddenBy: ids.r2, hiddenReason: 'personal_info' });
    expect((await repo.reviews({ hidden: false, limit: 200 })).some((b) => b.id === booked.id)).toBe(false);
    await departures.unhideReview(ids.r2, booked.id);
    expect((await repo.getBooking(booked.id))?.review?.hiddenAt).toBeNull();
    expect((await repo.reviews({ limit: 1, before: new Date(clock.now().getTime() + 1) }))[0]?.id).toBe(booked.id);
  });

  it('seat PIN attempts: a refused cross-use PIN is committed with its alert, and the log is append-only', async () => {
    const dep = await departures.announce(
      ids.driver,
      AnnounceInput.parse({
        garageId: 'mp_garage_bab1',
        corridorId: 'aziziyah_baghdad',
        departAt: at(400),
        latestDepartureAt: at(430),
        vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 2' },
      }),
    );
    const book = async (riderId: string, seat: 'front' | 'back_left') => {
      const held = await departures.hold(riderId, HoldSeatInput.parse({ departureId: dep.id, selection: { kind: 'seats', seatIds: [seat] }, travellingAs: 'rijal' }));
      wallet.set(riderId, 100_000);
      return departures.book(riderId, held.id, 'wallet');
    };
    const a = await book(ids.r1, 'front');
    const b = await book(ids.r2, 'back_left');
    await expect(departures.checkIn(ids.driver, dep.id, b.pin, a.id)).rejects.toMatchObject({ code: 'pin_invalid' });
    await departures.checkIn(ids.driver, dep.id, a.pin, a.id);
    const log = await repo.pinAttemptsFor(dep.id);
    expect(log.map((x) => [x.result, x.targetBookingId, x.matchedBookingId, x.alert, x.refusedOnSeat])).toEqual([
      ['other_booking', a.id, b.id, 'cross_use', 1],
      ['checked_in', a.id, a.id, null, 0],
    ]);
    const alerts = await repo.pinAlertsSince('aziziyah', at(-1));
    expect(alerts.find((x) => x.departureId === dep.id)).toMatchObject({ driverId: ids.driver, alert: 'cross_use' });
    expect(await repo.getPinAttempt(log[0]!.id)).toMatchObject({ id: log[0]!.id, result: 'other_booking' });
    // The table holds no PIN column at all, and rejects edits and deletes.
    const row = await prisma.prisma.intercityPinAttempt.findUniqueOrThrow({ where: { id: log[0]!.id } });
    expect(JSON.stringify(row)).not.toContain(`"${b.pin}"`);
    await expect(prisma.prisma.intercityPinAttempt.update({ where: { id: log[0]!.id }, data: { result: 'checked_in' } })).rejects.toThrow(/append-only/);
    await expect(prisma.prisma.intercityPinAttempt.delete({ where: { id: log[0]!.id } })).rejects.toThrow(/append-only/);
  });

  it('x3: the late-taxi time on a seat survives the round-trip and clears', async () => {
    const dep = await departures.announce(
      ids.d2,
      AnnounceInput.parse({
        garageId: 'mp_garage_bab1',
        corridorId: 'aziziyah_baghdad',
        departAt: at(1500),
        latestDepartureAt: at(1530),
        vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 3' },
      }),
    );
    const held = await departures.hold(
      ids.r2,
      HoldSeatInput.parse({ departureId: dep.id, selection: { kind: 'seats', seatIds: ['back_left'] }, travellingAs: 'rijal' }),
    );
    wallet.set(ids.r2, 50_000);
    const booked = await departures.book(ids.r2, held.id, 'wallet');
    const due = new Date(Math.floor(at(1510).getTime() / 1000) * 1000);
    await departures.taxiLate(ids.r2, booked.id, due);
    expect((await repo.getBooking(booked.id))?.taxiLateUntil).toEqual(due);
    await departures.taxiLate(ids.r2, booked.id, null);
    expect((await repo.getBooking(booked.id))?.taxiLateUntil).toBeNull();
  });

  it('the request board keeps offers and the deposit', async () => {
    const r = await requests.post(
      ids.r1,
      PostRequestInput.parse({
        from: { label: 'البوابة ١', garageId: 'mp_garage_bab1' },
        to: { label: 'الصويرة' },
        when: at(200),
        seats: 2,
        travellingAs: 'aila',
        details: { trip: 'two_days', returnAt: at(200 + 2 * 24 * 60), bigBags: 1, ac: true },
      }),
    );
    const offered = await requests.offer(ids.driver, r.id, 30_000);
    wallet.set(ids.r1, 100_000);
    await requests.pick(ids.r1, r.id, offered.offers[0]!.id);
    const back = await repo.getRequest(r.id);
    expect(back).toMatchObject({
      state: 'matched',
      depositIqd: 6_000,
      from: { garageId: 'mp_garage_bab1' },
      to: { label: 'الصويرة' },
    });
    expect(back?.offers.map((o) => [o.driverId, o.priceIqd, o.state])).toEqual([
      [ids.driver, 30_000, 'picked'],
    ]);
    // y1, y4: the details come back with the return date revived; the offer counted him as having seen it.
    expect(back?.details).toEqual({ trip: 'two_days', waitHours: null, returnAt: at(200 + 2 * 24 * 60), bigBags: 1, carKind: null, ac: true });
    expect(back?.seenDriverIds).toEqual([ids.driver]);
    expect(
      (await repo.listRequests({ riderId: ids.r1, states: ['matched'] })).map((x) => x.id),
    ).toEqual([r.id]);
    // y5: a completed ride counts as one of his private trips.
    expect(await repo.privateTripCounts([ids.driver])).toEqual({ [ids.driver]: 0 });
    await requests.complete(ids.driver, r.id);
    expect(await repo.privateTripCounts([ids.driver])).toEqual({ [ids.driver]: 1 });
  });

  it('waiting terms survive the round-trip, and finished trips feed the usual range by place and kind (w1, p1)', async () => {
    const since = new Date(clock.now().getTime() - 60_000);
    const pricesBefore = await repo.completedPrivatePrices({ placeId: 'medical_city', trip: 'wait_return', since });
    const r = await requests.post(
      ids.r1,
      PostRequestInput.parse({
        from: { label: 'العزيزية' },
        to: { label: 'مدينة الطب', placeId: 'medical_city' },
        when: at(120),
        seats: 1,
        travellingAs: 'rijal',
        details: { trip: 'wait_return', waitHours: 5 },
      }),
    );
    const offered = await requests.offer(ids.driver, r.id, 47_000, { includedHours: 4, extraHourIqd: 6_000 });
    expect((await repo.getRequest(r.id))?.offers[0]?.wait).toEqual({ includedHours: 4, extraHourIqd: 6_000 });
    expect((await repo.getRequest(r.id))?.to).toEqual({ label: 'مدينة الطب', placeId: 'medical_city' });
    wallet.set(ids.r1, 100_000);
    await requests.pick(ids.r1, r.id, offered.offers[0]!.id);
    // w2: the waiting clock's two times survive the round-trip; completion keeps the stop time.
    await requests.waitStart(ids.driver, r.id);
    const started = (await repo.getRequest(r.id))?.waitStartedAt;
    expect(started).toBeInstanceOf(Date);
    await requests.waitEnd(ids.driver, r.id);
    const ended = (await repo.getRequest(r.id))?.waitEndedAt;
    expect(ended!.getTime()).toBeGreaterThanOrEqual(started!.getTime());
    await requests.complete(ids.driver, r.id);
    expect((await repo.getRequest(r.id))?.waitEndedAt?.getTime()).toBe(ended!.getTime());
    const after = await repo.completedPrivatePrices({ placeId: 'medical_city', trip: 'wait_return', since });
    expect(after.length).toBe(pricesBefore.length + 1);
    expect(after).toContain(47_000);
    // Another kind of trip, or a later window, does not see it.
    expect(await repo.completedPrivatePrices({ placeId: 'medical_city', trip: 'one_way', since })).not.toContain(47_000);
    expect(await repo.completedPrivatePrices({ placeId: 'medical_city', trip: 'wait_return', since: new Date(clock.now().getTime() + 60_000) })).toEqual([]);
  });

  it('a driver opening the request while the rider picks never reopens it (two writers, one database)', async () => {
    // A second writer stands in for a second API machine: its own in-process mutex, the same database,
    // so only the transaction's advisory lock keeps «seen» and «pick» apart. Its reads are slowed, so
    // without the lock the pick would commit between seen's read and its write.
    const slow = Object.create(repo) as PrismaRoutesRepository;
    slow.getRequest = async (id, tx) => {
      const r = await repo.getRequest(id, tx);
      await new Promise((done) => setTimeout(done, 200));
      return r;
    };
    const otherMachine = new RequestBoardService(slow, events, wallet, clock, new RoutesWriter(uow, slow), INTERCITY_NETWORK, INTERCITY_RULES, randomIds);
    const r = await requests.post(
      ids.r2,
      PostRequestInput.parse({ from: { label: 'البوابة ١', garageId: 'mp_garage_bab1' }, to: { label: 'الكوت' }, when: at(300), seats: 1, travellingAs: 'aila' }),
    );
    const offered = await requests.offer(ids.driver, r.id, 20_000);
    wallet.set(ids.r2, 100_000);
    const seen = otherMachine.seen(ids.d2, r.id);
    await new Promise((done) => setTimeout(done, 50));
    await Promise.all([seen, requests.pick(ids.r2, r.id, offered.offers[0]!.id)]);
    const back = await repo.getRequest(r.id);
    expect(back).toMatchObject({ state: 'matched', pickedOfferId: offered.offers[0]!.id, depositIqd: 5_000 });
    expect(back?.offers.map((o) => o.state)).toEqual(['picked']);
    expect(back?.seenDriverIds).toEqual([ids.driver, ids.d2]);
    // Once picked, a driver who didn't offer can't read it.
    await expect(requests.seen(ids.d2, r.id)).rejects.toMatchObject({ code: 'request_not_found' });
  });
  it('request-board money posts on Postgres under request:<id> groups, with no trip/order/departure refs (RDB-01/02)', async () => {
    // The ledger on this database, fed the events the board emits the way the bus delivers them. Before
    // the payloads carried `requestId`, these postings failed on the trip / order / departure foreign keys.
    const l = ledgerHarness({ repo: new PrismaLedgerRepository(prisma.prisma.ledgerEvent as unknown as LedgerEventDelegate) });
    const deliver = async (from: number) => {
      for (const e of events.events.slice(from)) {
        if (!LEDGER_SUBSCRIBED_EVENTS.includes(e.type)) continue;
        await l.bus.publish(e.type, JSON.parse(JSON.stringify({ actorId: e.actorId, occurredAt: e.occurredAt, ...e.payload })) as Record<string, unknown>);
      }
    };
    const lines = async (requestId: string) =>
      (await prisma.prisma.ledgerEvent.findMany({ where: { postingGroupId: { startsWith: `request:${requestId}:` } }, orderBy: { recordedAt: 'asc' } })).map((e) => ({
        group: e.postingGroupId,
        type: e.type,
        amount: e.amountIqd,
        from: e.fromAccount,
        to: e.toAccount,
        refs: [e.tripId, e.orderId, e.departureId],
      }));
    const trip = async (rider: string, minutes: number, price: number) => {
      const r = await requests.post(rider, PostRequestInput.parse({ from: { label: 'البوابة ١', garageId: 'mp_garage_bab1' }, to: { label: 'الصويرة' }, when: at(minutes), seats: 1, travellingAs: 'aila' }));
      const o = (await requests.offer(ids.driver, r.id, price)).offers.at(-1)!;
      wallet.set(rider, 100_000);
      await requests.pick(rider, r.id, o.id);
      return r;
    };

    // Completed: 30,000 (deposit 6,000 from the wallet, 24,000 cash), 8 % take.
    let from = events.events.length;
    const done = await trip(ids.r1, 400, 30_000);
    await requests.complete(ids.driver, done.id);
    await deliver(from);
    const posted = await lines(done.id);
    expect(posted.every((x) => x.refs.every((v) => v === null))).toBe(true);
    expect([...new Set(posted.map((x) => x.group))].sort()).toEqual([`request:${done.id}:money`, `request:${done.id}:points`]);
    const money = posted.filter((x) => x.group === `request:${done.id}:money`);
    expect(money).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'fare', amount: 30_000, from: `customer:${ids.r1}`, to: `driver:${ids.driver}` }),
      expect.objectContaining({ type: 'commission_accrued', amount: 2_400 }),
      expect.objectContaining({ type: 'cash_collected', amount: 24_000, from: `cash:${ids.driver}`, to: `customer:${ids.r1}` }),
    ]));

    // Late cancel (inside the last hour): the deposit to the driver.
    from = events.events.length;
    const late = await trip(ids.r2, 30, 20_000);
    await requests.cancel(ids.r2, late.id);
    await deliver(from);
    expect(await lines(late.id)).toEqual([
      { group: `request:${late.id}:cancel`, type: 'cancellation_fee', amount: 5_000, from: `customer:${ids.r2}`, to: `driver:${ids.driver}`, refs: [null, null, null] },
    ]);

    // Rider no-show after the wait at the pickup: the deposit to the driver.
    from = events.events.length;
    const absent = await trip(ids.r1, 20, 25_000);
    await requests.arrived(ids.driver, absent.id, { lat: 32.9105, lng: 45.0611 });
    clock.advance((20 + INTERCITY_RULES.requestBoard.riderNoShowWaitMin + 1) * 60_000);
    await requests.riderNoShow(ids.driver, absent.id);
    await deliver(from);
    expect(await lines(absent.id)).toEqual([
      { group: `request:${absent.id}:cancel`, type: 'cancellation_fee', amount: 5_000, from: `customer:${ids.r1}`, to: `driver:${ids.driver}`, refs: [null, null, null] },
    ]);

    // Driver no-show: 2× the deposit from the driver to the rider.
    from = events.events.length;
    const stood = await trip(ids.r2, 10, 40_000);
    clock.advance((10 + INTERCITY_RULES.requestBoard.driverNoShowAfterMin + 1) * 60_000);
    await requests.driverNoShow(ids.r2, stood.id);
    await deliver(from);
    expect(await lines(stood.id)).toEqual([
      { group: `request:${stood.id}:driver_no_show`, type: 'departure_cancel_fee', amount: 16_000, from: `driver:${ids.driver}`, to: `customer:${ids.r2}`, refs: [null, null, null] },
    ]);
  });
});
