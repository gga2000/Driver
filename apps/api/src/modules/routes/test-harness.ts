import {
  AnnounceInput,
  AZIZIYAH_MONEY_RULES,
  HoldSeatInput,
  type IntercitySeatId,
  type PickupChoice,
  type SeatPayment,
  type TravellingAs,
} from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { offsetNorth } from '../trips/index.js';
import { DemandService } from './demand.service.js';
import { DeparturesService } from './departures.service.js';
import { RecordingRoutesEvents } from './events.adapter.js';
import {
  INTERCITY_NETWORK,
  INTERCITY_RULES,
  type GarageConfig,
  type IntercityRules,
} from './intercity.config.js';
import { TrailCheckpointWaiver, type CheckpointWaiver } from './late-meter.js';
import { RequestBoardService } from './request-board.service.js';
import { InMemoryRoutesRepository } from './routes.repository.js';
import { RoutesRpc } from './routes.rpc.js';
import { RoutesScheduler } from './scheduler.js';
import { SequentialIds } from './support.js';
import { FakeWallet } from './wallet.js';
import { RoutesWriter } from './writer.js';

export const BAB1 = INTERCITY_NETWORK.garages.find((g) => g.id === 'mp_garage_bab1')!;
export const BAB2 = INTERCITY_NETWORK.garages.find((g) => g.id === 'mp_garage_bab2')!;
export const NAHDHA = INTERCITY_NETWORK.garages.find((g) => g.id === 'mp_garage_nahdha')!;

/**
 * The whole routes module on in-memory everything and a fake clock (default 2026-10-03 12:00 UTC =
 * 15:00 Baghdad). Shared by the unit tests.
 */
export function routesHarness(
  opts: { start?: string; rules?: Partial<IntercityRules>; waiver?: CheckpointWaiver } = {},
) {
  const clock = new FakeClock(opts.start ?? '2026-10-03T12:00:00Z');
  const repo = new InMemoryRoutesRepository();
  const events = new RecordingRoutesEvents();
  const wallet = new FakeWallet();
  const uow = new UnitOfWork(new NoDatabaseRunner());
  const writer = new RoutesWriter(uow, repo);
  const ids = new SequentialIds();
  const rules: IntercityRules = { ...INTERCITY_RULES, ...opts.rules };
  const requests = new RequestBoardService(
    repo,
    events,
    wallet,
    clock,
    writer,
    INTERCITY_NETWORK,
    rules,
    ids,
  );
  const departures = new DeparturesService(
    repo,
    events,
    wallet,
    clock,
    writer,
    requests,
    INTERCITY_NETWORK,
    rules,
    AZIZIYAH_MONEY_RULES,
    opts.waiver ?? new TrailCheckpointWaiver(),
    ids,
  );
  const demand = new DemandService(repo, events, clock, writer, departures, INTERCITY_NETWORK, ids);
  const rpc = new RoutesRpc(departures, demand, requests, repo);
  const scheduler = new RoutesScheduler(writer, departures, demand, requests);

  const at = (minutesFromNow: number) => new Date(clock.now().getTime() + minutesFromNow * 60_000);

  /** Driver `d1` announces from البوابة ١ to Baghdad, leaving in 2 h (latest +30 min), a saloon. */
  function announce(over: Partial<AnnounceInput> & { driverId?: string } = {}) {
    const { driverId = 'd1', ...rest } = over;
    return departures.announce(
      driverId,
      AnnounceInput.parse({
        garageId: BAB1.id,
        corridorId: 'aziziyah_baghdad',
        departAt: at(120),
        latestDepartureAt: at(150),
        vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 12345' },
        ...rest,
      }),
    );
  }

  function hold(
    riderId: string,
    departureId: string,
    seatIds: IntercitySeatId[],
    travellingAs: TravellingAs = 'rijal',
    pickup: PickupChoice = { kind: 'garage' },
  ) {
    return departures.hold(
      riderId,
      HoldSeatInput.parse({
        departureId,
        selection: { kind: 'seats', seatIds },
        travellingAs,
        pickup,
      }),
    );
  }

  /** Hold + book in one go. Wallet bookings get the balance they need. */
  async function book(
    riderId: string,
    departureId: string,
    seatIds: IntercitySeatId[],
    opts: { payment?: SeatPayment; travellingAs?: TravellingAs; pickup?: PickupChoice } = {},
  ) {
    const payment = opts.payment ?? 'wallet';
    const h = await hold(
      riderId,
      departureId,
      seatIds,
      opts.travellingAs ?? 'rijal',
      opts.pickup ?? { kind: 'garage' },
    );
    if (payment === 'wallet') wallet.set(riderId, (await wallet.balance(riderId)) + 100_000);
    return departures.book(riderId, h.id, payment);
  }

  /** Driver fix at the garage (inside the 150 m geofence), or `meters` north of it. */
  function driverAt(departureId: string, garage: GarageConfig = BAB1, meters = 0, driverId = 'd1') {
    const p = offsetNorth(garage, meters);
    return departures.driverPosition(driverId, departureId, p);
  }

  async function checkIn(departureId: string, bookingId: string, driverId = 'd1') {
    const b = await departures.booking(bookingId);
    return departures.checkIn(driverId, departureId, b.pin);
  }

  function advance(minutes: number) {
    clock.advanceMinutes(minutes);
  }

  /** Moves the clock and runs the scheduler, like the 15-second tick would. */
  async function tickAt(minutes: number) {
    clock.advanceMinutes(minutes);
    return scheduler.tick();
  }

  return {
    clock,
    repo,
    events,
    wallet,
    uow,
    writer,
    ids,
    rules,
    requests,
    departures,
    demand,
    rpc,
    scheduler,
    at,
    announce,
    hold,
    book,
    driverAt,
    checkIn,
    advance,
    tickAt,
  };
}

export type RoutesHarness = ReturnType<typeof routesHarness>;
