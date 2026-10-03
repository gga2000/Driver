import type { BookingState, IntercitySeatId } from '@driver/contracts';
import { Prisma } from '@driver/db';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type {
  BookingRecord,
  DemandPostRecord,
  DepartureRecord,
  Fix,
  PickupRecord,
  RequestOfferRecord,
  RequestPlaceRecord,
  RequestRecord,
  WalkUp,
} from './model.js';
import type {
  DemandFilter,
  DepartureFilter,
  RequestFilter,
  RiderRecordStats,
  RoutesRepository,
} from './routes.repository.js';

/**
 * Postgres twin of `InMemoryRoutesRepository`: `departures` (an intercity Route row per corridor,
 * direction and garage carries the FK), `seat_bookings`, `demand_posts`, `ride_requests` +
 * `ride_request_offers`. Run state that only this module reads (walk-ups, the driver's fixes)
 * lives in `departures.run_state`.
 */
export class PrismaRoutesRepository implements RoutesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async lock(tx?: Tx): Promise<void> {
    if (!tx) return;
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext('driver.routes'))) AS l`;
  }

  // ───────────────────────── departures ─────────────────────────

  async saveDeparture(d: DepartureRecord, tx?: Tx): Promise<void> {
    const db = this.db(tx);
    const routeId = `ic_${d.corridorId}_${d.direction}_${d.garageId}`;
    await db.route.upsert({
      where: { id: routeId },
      create: {
        id: routeId,
        cityId: d.fromCityId,
        type: 'intercity',
        state: 'active',
        nameAr: `${d.corridorId} · ${d.garageId}`,
        schedule: 'announced',
        seatPriceIqd: d.seatPriceIqd,
      },
      update: {},
    });
    const runState: RunState = {
      walkUps: d.walkUps.map((w) => ({ ...w, markedAt: w.markedAt.toISOString() })),
      selfieRef: d.selfieRef,
      driverCheckIn: d.driverCheckIn ? fixOut(d.driverCheckIn) : null,
      driverLeftGeofenceAt: d.driverLeftGeofenceAt?.toISOString() ?? null,
      trail: d.trail.map(fixOut),
      lastPosition: d.lastPosition ? fixOut(d.lastPosition) : null,
    };
    const data = {
      routeId,
      scheduledAt: d.departAt,
      announcedAt: d.announcedAt,
      latestDepartureAt: d.latestDepartureAt,
      state: d.state,
      driverId: d.driverId,
      corridorId: d.corridorId,
      garageId: d.garageId,
      direction: d.direction,
      fromCityId: d.fromCityId,
      toCityId: d.toCityId,
      seatLayout: d.layout,
      vehicleSnapshot: d.vehicle as unknown as Prisma.InputJsonObject,
      familyOnly: d.familyOnly,
      seatPriceIqd: d.seatPriceIqd,
      frontPremiumIqd: d.frontPremiumIqd,
      selfieAt: d.selfieAt,
      driverCheckedInAt: d.driverCheckIn?.at ?? null,
      boardingAt: d.boardingAt,
      departedAt: d.departedAt,
      arrivedAt: d.arrivedAt,
      closedAt: d.closedAt,
      cancelledAt: d.cancelledAt,
      cancellationReason: d.cancelReason,
      lowFillCheckedAt: d.lowFillCheckedAt,
      runState: runState as unknown as Prisma.InputJsonObject,
    };
    await db.departure.upsert({
      where: { id: d.id },
      create: { id: d.id, createdAt: d.createdAt, ...data },
      update: data,
    });
  }

  async getDeparture(id: string, tx?: Tx): Promise<DepartureRecord | null> {
    const row = await this.db(tx).departure.findUnique({ where: { id } });
    return row && row.corridorId ? toDeparture(row) : null;
  }

  async listDepartures(f: DepartureFilter, tx?: Tx): Promise<DepartureRecord[]> {
    const rows = await this.db(tx).departure.findMany({
      where: {
        corridorId: f.corridorId ?? { not: null },
        ...(f.garageId ? { garageId: f.garageId } : {}),
        ...(f.direction ? { direction: f.direction } : {}),
        ...(f.fromCityId ? { fromCityId: f.fromCityId } : {}),
        ...(f.driverId ? { driverId: f.driverId } : {}),
        ...(f.states ? { state: { in: [...f.states] } } : {}),
        ...(f.from || f.to
          ? { scheduledAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
          : {}),
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDeparture);
  }

  // ───────────────────────── bookings ─────────────────────────

  async saveBooking(b: BookingRecord, tx?: Tx): Promise<void> {
    const data = {
      departureId: b.departureId,
      riderId: b.riderId,
      seatIds: b.seatIds,
      selection: b.selection,
      travellingAs: b.travellingAs,
      state: b.state,
      origin: b.origin,
      seatPriceIqd: b.seatPriceIqd,
      frontPremiumIqd: b.frontPremiumIqd,
      pickupFeeIqd: b.pickupFeeIqd,
      payment: b.payment,
      prepaid: b.prepaid,
      trusted: b.trusted,
      pin: b.pin,
      pickup: b.pickup as unknown as Prisma.InputJsonObject,
      largeBags: b.largeBags,
      heldUntil: b.heldUntil,
      bookedAt: b.bookedAt,
      atGarageAt: b.atGarageAt,
      checkedInAt: b.checkedInAt,
      noShowAt: b.noShowAt,
      completedAt: b.completedAt,
      cancelledAt: b.cancelledAt,
      lateMinutes: b.lateMinutes,
      demandPostId: b.demandPostId,
      movedFromBookingId: b.movedFromBookingId,
      movedToBookingId: b.movedToBookingId,
    };
    await this.db(tx).seatBooking.upsert({
      where: { id: b.id },
      create: { id: b.id, createdAt: b.createdAt, ...data },
      update: data,
    });
  }

  async getBooking(id: string, tx?: Tx): Promise<BookingRecord | null> {
    const row = await this.db(tx).seatBooking.findUnique({ where: { id } });
    return row ? toBooking(row) : null;
  }

  async bookingsFor(departureId: string, tx?: Tx): Promise<BookingRecord[]> {
    return (
      await this.db(tx).seatBooking.findMany({
        where: { departureId },
        orderBy: { createdAt: 'asc' },
      })
    ).map(toBooking);
  }

  async bookingsOfRider(
    riderId: string,
    states?: readonly BookingState[],
    tx?: Tx,
  ): Promise<BookingRecord[]> {
    const rows = await this.db(tx).seatBooking.findMany({
      where: { riderId, ...(states ? { state: { in: [...states] } } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toBooking);
  }

  async riderStats(riderId: string, tx?: Tx): Promise<RiderRecordStats> {
    const db = this.db(tx);
    const [completedBookings, cashStrikes] = await Promise.all([
      db.seatBooking.count({ where: { riderId, state: 'completed' } }),
      db.seatBooking.count({
        where: {
          riderId,
          OR: [
            { state: 'no_show', prepaid: false, payment: 'cash' },
            { state: 'expired', origin: 'demand_claim' },
          ],
        },
      }),
    ]);
    return { completedBookings, cashStrikes };
  }

  // ───────────────────────── demand ─────────────────────────

  async saveDemand(p: DemandPostRecord, tx?: Tx): Promise<void> {
    const data = {
      riderId: p.riderId,
      corridorId: p.corridorId,
      direction: p.direction,
      garageId: p.garageId,
      pickup: p.pickup as unknown as Prisma.InputJsonObject,
      windowStart: p.windowStart,
      windowEnd: p.windowEnd,
      seats: p.seats,
      travellingAs: p.travellingAs,
      state: p.state,
      bookingId: p.bookingId,
      escalatedAt: p.escalatedAt,
    };
    await this.db(tx).demandPost.upsert({
      where: { id: p.id },
      create: { id: p.id, createdAt: p.createdAt, ...data },
      update: data,
    });
  }

  async getDemand(id: string, tx?: Tx): Promise<DemandPostRecord | null> {
    const row = await this.db(tx).demandPost.findUnique({ where: { id } });
    return row ? toDemand(row) : null;
  }

  async listDemand(f: DemandFilter, tx?: Tx): Promise<DemandPostRecord[]> {
    const rows = await this.db(tx).demandPost.findMany({
      where: {
        ...(f.corridorId ? { corridorId: f.corridorId } : {}),
        ...(f.direction ? { direction: f.direction } : {}),
        ...(f.riderId ? { riderId: f.riderId } : {}),
        ...(f.states ? { state: { in: [...f.states] } } : {}),
        ...(f.endsAfter ? { windowEnd: { gt: f.endsAfter } } : {}),
        ...(f.startsBefore ? { windowStart: { lt: f.startsBefore } } : {}),
      },
      orderBy: [{ windowStart: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDemand);
  }

  // ───────────────────────── request board ─────────────────────────

  async saveRequest(r: RequestRecord, tx?: Tx): Promise<void> {
    const db = this.db(tx);
    const data = {
      riderId: r.riderId,
      fromPlace: r.from as unknown as Prisma.InputJsonObject,
      toPlace: r.to as unknown as Prisma.InputJsonObject,
      cityId: r.cityId,
      when: r.when,
      seats: r.seats,
      privateCar: r.privateCar,
      travellingAs: r.travellingAs,
      note: r.note,
      state: r.state,
      origin: r.origin,
      priceCapIqd: r.priceCapIqd,
      pickedOfferId: r.pickedOfferId,
      depositIqd: r.depositIqd,
      driverArrivedAt: r.driverArrivedAt,
      driverArrivedPin: r.driverArrivedPin
        ? (r.driverArrivedPin as unknown as Prisma.InputJsonObject)
        : Prisma.DbNull,
      closedAt: r.closedAt,
    };
    await db.rideRequest.upsert({
      where: { id: r.id },
      create: { id: r.id, createdAt: r.createdAt, ...data },
      update: data,
    });
    for (const o of r.offers) {
      await db.rideRequestOffer.upsert({
        where: { id: o.id },
        create: {
          id: o.id,
          requestId: r.id,
          driverId: o.driverId,
          priceIqd: o.priceIqd,
          state: o.state,
          createdAt: o.at,
        },
        update: { state: o.state },
      });
    }
  }

  async getRequest(id: string, tx?: Tx): Promise<RequestRecord | null> {
    const row = await this.db(tx).rideRequest.findUnique({
      where: { id },
      include: { offers: { orderBy: { createdAt: 'asc' } } },
    });
    return row ? toRequest(row) : null;
  }

  async listRequests(f: RequestFilter, tx?: Tx): Promise<RequestRecord[]> {
    const rows = await this.db(tx).rideRequest.findMany({
      where: {
        ...(f.riderId ? { riderId: f.riderId } : {}),
        ...(f.states ? { state: { in: [...f.states] } } : {}),
      },
      include: { offers: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ when: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toRequest);
  }
}

// ───────────────────────── row mapping ─────────────────────────

interface FixJson {
  lat: number;
  lng: number;
  at: string;
}

interface RunState {
  walkUps: Array<Omit<WalkUp, 'markedAt'> & { markedAt: string }>;
  selfieRef: string | null;
  driverCheckIn: FixJson | null;
  driverLeftGeofenceAt: string | null;
  trail: FixJson[];
  lastPosition: FixJson | null;
}

function fixOut(f: Fix): FixJson {
  return { lat: f.lat, lng: f.lng, at: f.at.toISOString() };
}

function fixIn(f: FixJson): Fix {
  return { lat: f.lat, lng: f.lng, at: new Date(f.at) };
}

type DepartureRow = Awaited<ReturnType<Tx['departure']['findUniqueOrThrow']>>;
type BookingRow = Awaited<ReturnType<Tx['seatBooking']['findUniqueOrThrow']>>;
type DemandRow = Awaited<ReturnType<Tx['demandPost']['findUniqueOrThrow']>>;
type RequestRow = Awaited<ReturnType<Tx['rideRequest']['findUniqueOrThrow']>> & {
  offers: Array<Awaited<ReturnType<Tx['rideRequestOffer']['findUniqueOrThrow']>>>;
};

function toDeparture(r: DepartureRow): DepartureRecord {
  const run = (r.runState ?? {}) as unknown as Partial<RunState>;
  return {
    id: r.id,
    driverId: r.driverId ?? '',
    corridorId: r.corridorId ?? '',
    direction: r.direction ?? 'to_aziziyah',
    garageId: r.garageId ?? '',
    fromCityId: r.fromCityId ?? '',
    toCityId: r.toCityId ?? '',
    departAt: r.scheduledAt,
    latestDepartureAt: r.latestDepartureAt ?? r.scheduledAt,
    announcedAt: r.announcedAt,
    state: r.state,
    layout: (r.seatLayout ?? 4) as DepartureRecord['layout'],
    vehicle: r.vehicleSnapshot as unknown as DepartureRecord['vehicle'],
    familyOnly: r.familyOnly,
    seatPriceIqd: r.seatPriceIqd ?? 0,
    frontPremiumIqd: r.frontPremiumIqd,
    walkUps: (run.walkUps ?? []).map((w) => ({ ...w, markedAt: new Date(w.markedAt) })),
    selfieAt: r.selfieAt,
    selfieRef: run.selfieRef ?? null,
    driverCheckIn: run.driverCheckIn ? fixIn(run.driverCheckIn) : null,
    driverLeftGeofenceAt: run.driverLeftGeofenceAt ? new Date(run.driverLeftGeofenceAt) : null,
    trail: (run.trail ?? []).map(fixIn),
    lastPosition: run.lastPosition ? fixIn(run.lastPosition) : null,
    boardingAt: r.boardingAt,
    departedAt: r.departedAt,
    arrivedAt: r.arrivedAt,
    closedAt: r.closedAt,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancellationReason,
    lowFillCheckedAt: r.lowFillCheckedAt,
    createdAt: r.createdAt,
  };
}

function toBooking(r: BookingRow): BookingRecord {
  return {
    id: r.id,
    departureId: r.departureId,
    riderId: r.riderId,
    seatIds: r.seatIds as IntercitySeatId[],
    selection: r.selection as BookingRecord['selection'],
    travellingAs: r.travellingAs,
    state: r.state,
    origin: r.origin as BookingRecord['origin'],
    seatPriceIqd: r.seatPriceIqd,
    frontPremiumIqd: r.frontPremiumIqd,
    pickupFeeIqd: r.pickupFeeIqd,
    payment: r.payment as BookingRecord['payment'],
    prepaid: r.prepaid,
    trusted: r.trusted,
    pin: r.pin,
    pickup: r.pickup as unknown as PickupRecord,
    largeBags: r.largeBags,
    heldUntil: r.heldUntil,
    bookedAt: r.bookedAt,
    atGarageAt: r.atGarageAt,
    checkedInAt: r.checkedInAt,
    noShowAt: r.noShowAt,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    lateMinutes: r.lateMinutes,
    demandPostId: r.demandPostId,
    movedFromBookingId: r.movedFromBookingId,
    movedToBookingId: r.movedToBookingId,
    createdAt: r.createdAt,
  };
}

function toDemand(r: DemandRow): DemandPostRecord {
  return {
    id: r.id,
    riderId: r.riderId,
    corridorId: r.corridorId,
    direction: r.direction,
    garageId: r.garageId,
    pickup: r.pickup as unknown as DemandPostRecord['pickup'],
    windowStart: r.windowStart,
    windowEnd: r.windowEnd,
    seats: r.seats,
    travellingAs: r.travellingAs,
    state: r.state,
    bookingId: r.bookingId,
    escalatedAt: r.escalatedAt,
    createdAt: r.createdAt,
  };
}

function toRequest(r: RequestRow): RequestRecord {
  return {
    id: r.id,
    riderId: r.riderId,
    from: r.fromPlace as unknown as RequestPlaceRecord,
    to: r.toPlace as unknown as RequestPlaceRecord,
    cityId: r.cityId,
    when: r.when,
    seats: r.seats,
    privateCar: r.privateCar,
    travellingAs: r.travellingAs,
    note: r.note,
    state: r.state,
    origin: r.origin as RequestRecord['origin'],
    priceCapIqd: r.priceCapIqd,
    offers: r.offers.map((o): RequestOfferRecord => ({
      id: o.id,
      driverId: o.driverId,
      priceIqd: o.priceIqd,
      at: o.createdAt,
      state: o.state,
    })),
    pickedOfferId: r.pickedOfferId,
    depositIqd: r.depositIqd,
    driverArrivedAt: r.driverArrivedAt,
    driverArrivedPin: (r.driverArrivedPin as unknown as RequestRecord['driverArrivedPin']) ?? null,
    closedAt: r.closedAt,
    createdAt: r.createdAt,
  };
}
