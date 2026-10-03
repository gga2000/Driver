import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AnnounceInput,
  AZIZIYAH_MONEY_RULES,
  HoldSeatInput,
  PostDemandInput,
  PostRequestInput,
} from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
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
  const ids = { driver: '', r1: '', r2: '' };
  const at = (min: number) => new Date(clock.now().getTime() + min * 60_000);

  beforeAll(async () => {
    const db = prisma.prisma;
    ids.driver = (await db.person.create({ data: {} })).id;
    ids.r1 = (await db.person.create({ data: {} })).id;
    ids.r2 = (await db.person.create({ data: {} })).id;
  });

  afterAll(async () => {
    const db = prisma.prisma;
    const deps = await db.departure.findMany({
      where: { driverId: ids.driver },
      select: { id: true },
    });
    await db.seatBooking.deleteMany({ where: { departureId: { in: deps.map((d) => d.id) } } });
    await db.departure.deleteMany({ where: { driverId: ids.driver } });
    await db.demandPost.deleteMany({ where: { riderId: { in: [ids.r1, ids.r2] } } });
    const rqs = await db.rideRequest.findMany({
      where: { riderId: { in: [ids.r1, ids.r2] } },
      select: { id: true },
    });
    await db.rideRequestOffer.deleteMany({ where: { requestId: { in: rqs.map((r) => r.id) } } });
    await db.rideRequest.deleteMany({ where: { id: { in: rqs.map((r) => r.id) } } });
    await db.person.deleteMany({ where: { id: { in: [ids.driver, ids.r1, ids.r2] } } });
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

  it('the request board keeps offers and the deposit', async () => {
    const r = await requests.post(
      ids.r1,
      PostRequestInput.parse({
        from: { label: 'البوابة ١', garageId: 'mp_garage_bab1' },
        to: { label: 'الصويرة' },
        when: at(200),
        seats: 2,
        travellingAs: 'aila',
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
    expect(
      (await repo.listRequests({ riderId: ids.r1, states: ['matched'] })).map((x) => x.id),
    ).toEqual([r.id]);
  });
});
