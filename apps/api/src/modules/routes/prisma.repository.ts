import { DEFAULT_REQUEST_DETAILS, PinAlertKind, type RequestShareBoardedBy, type RequestShareMemberState, type RequestPlaceId, type RequestTripKind, type OfferCashState, PinAttemptResult, RajaaRatingTag, RequestDetails, ReviewHideReason, VehicleModelKey, type BookingState, type IntercitySeatId } from '@driver/contracts';
import { z } from 'zod';
import { Prisma } from '@driver/db';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import {
  FINISHED_RUN,
  type AgreementRecord,
  type BookingRecord,
  type DemandPostRecord,
  type DepartureRecord,
  type DropoffRecord,
  type Fix,
  type PickupRecord,
  type PinAttemptRecord,
  type RequestOfferRecord,
  type RequestPlaceRecord,
  type RequestRecord,
  type ReviewRecord,
  type WalkUp,
} from './model.js';
import type {
  DemandFilter,
  DepartureFilter,
  DriverRecord,
  RequestFilter,
  ReviewFilter,
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
      dropoffFeeIqd: b.dropoffFeeIqd ?? 0,
      dropoff: b.dropoff ? ({ ...b.dropoff } as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
      payment: b.payment,
      prepaid: b.prepaid,
      trusted: b.trusted,
      pin: b.pin,
      pickup: b.pickup as unknown as Prisma.InputJsonObject,
      largeBags: b.largeBags,
      lapChildren: b.lapChildren ?? 0,
      returnDiscountIqd: b.returnDiscountIqd ?? 0,
      returnPairId: b.returnPairId ?? null,
      heldUntil: b.heldUntil,
      bookedAt: b.bookedAt,
      atGarageAt: b.atGarageAt,
      checkedInAt: b.checkedInAt,
      noShowAt: b.noShowAt,
      completedAt: b.completedAt,
      cancelledAt: b.cancelledAt,
      lateMinutes: b.lateMinutes,
      taxiLateUntil: b.taxiLateUntil ?? null,
      demandPostId: b.demandPostId,
      movedFromBookingId: b.movedFromBookingId,
      movedToBookingId: b.movedToBookingId,
      rating: b.rating ? ({ stars: b.rating.stars, tags: [...b.rating.tags], at: b.rating.at.toISOString() } as Prisma.InputJsonObject) : Prisma.DbNull,
      reviewText: b.review?.text ?? null,
      reviewAt: b.review?.at ?? null,
      reviewHiddenAt: b.review?.hiddenAt ?? null,
      reviewHiddenBy: b.review?.hiddenBy ?? null,
      reviewHiddenReason: b.review?.hiddenReason ?? null,
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

  async driverRecord(driverId: string, tx?: Tx): Promise<DriverRecord> {
    const db = this.db(tx);
    const finished = { driverId, state: { in: [...FINISHED_RUN] } };
    const [runs, rated] = await Promise.all([
      db.departure.findMany({ where: finished, orderBy: { scheduledAt: 'asc' } }),
      db.seatBooking.findMany({ where: { departure: finished, rating: { not: Prisma.DbNull } }, orderBy: { completedAt: 'asc' } }),
    ]);
    const records = rated.map(toBooking).filter((b) => b.rating);
    records.sort((a, b) => a.rating!.at.getTime() - b.rating!.at.getTime());
    return { runs: runs.map(toDeparture), rated: records };
  }

  async reviews(f: ReviewFilter, tx?: Tx): Promise<BookingRecord[]> {
    const rows = await this.db(tx).seatBooking.findMany({
      where: {
        reviewText: { not: null },
        ...(f.hidden === undefined ? {} : { reviewHiddenAt: f.hidden ? { not: null } : null }),
        ...(f.before ? { reviewAt: { lt: f.before } } : {}),
      },
      orderBy: [{ reviewAt: 'desc' }, { id: 'desc' }],
      take: f.limit,
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
      details: r.details as unknown as Prisma.InputJsonObject,
      seenDriverIds: r.seenDriverIds,
      state: r.state,
      origin: r.origin,
      priceCapIqd: r.priceCapIqd,
      pickedOfferId: r.pickedOfferId,
      depositIqd: r.depositIqd,
      cashReserved: r.cashReserved,
      driverArrivedAt: r.driverArrivedAt,
      driverArrivedPin: r.driverArrivedPin
        ? (r.driverArrivedPin as unknown as Prisma.InputJsonObject)
        : Prisma.DbNull,
      waitStartedAt: r.waitStartedAt,
      waitEndedAt: r.waitEndedAt,
      fetchPersonId: r.fetchPersonId,
      shareCode: r.share?.code ?? null,
      shareBookerPlaces: r.share?.bookerPlaces ?? null,
      sharePlaceIqd: r.share?.placeIqd ?? null,
      shareOpenedAt: r.share?.openedAt ?? null,
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
          waitIncludedHours: o.wait?.includedHours ?? null,
          extraHourIqd: o.wait?.extraHourIqd ?? null,
          state: o.state,
          cashState: o.cash,
          createdAt: o.at,
        },
        update: { state: o.state, cashState: o.cash },
      });
    }
    for (const m of r.share?.members ?? []) {
      await db.rideRequestShare.upsert({
        where: { id: m.id },
        create: {
          id: m.id,
          requestId: r.id,
          personId: m.personId,
          places: m.places,
          amountIqd: m.amountIqd,
          state: m.state,
          joinedAt: m.joinedAt,
          closedAt: m.closedAt,
          boardedAt: m.boardedAt,
          boardedBy: m.boardedBy,
        },
        update: { state: m.state, closedAt: m.closedAt, boardedAt: m.boardedAt, boardedBy: m.boardedBy },
      });
    }
  }

  async markRequestSeen(id: string, driverId: string, tx?: Tx): Promise<boolean> {
    // One targeted update: the row's state, pick, deposit and offers are never written back here.
    const n = await this.db(tx).$executeRaw`
      UPDATE "public"."ride_requests"
         SET seen_driver_ids = array_append(seen_driver_ids, ${driverId}::text)
       WHERE id = ${id}::text AND state = 'open' AND NOT (${driverId}::text = ANY(seen_driver_ids))`;
    return n > 0;
  }

  async getRequestByShareCode(code: string, tx?: Tx): Promise<RequestRecord | null> {
    const row = await this.db(tx).rideRequest.findUnique({ where: { shareCode: code }, include: REQUEST_INCLUDE });
    return row ? toRequest(row) : null;
  }

  async getRequest(id: string, tx?: Tx): Promise<RequestRecord | null> {
    const row = await this.db(tx).rideRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    return row ? toRequest(row) : null;
  }

  async listRequests(f: RequestFilter, tx?: Tx): Promise<RequestRecord[]> {
    const rows = await this.db(tx).rideRequest.findMany({
      where: {
        ...(f.riderId ? { riderId: f.riderId } : {}),
        ...(f.states ? { state: { in: [...f.states] } } : {}),
        ...(f.memberId ? { shares: { some: { personId: f.memberId } } } : {}),
      },
      include: REQUEST_INCLUDE,
      orderBy: [{ when: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toRequest);
  }

  async completedPrivatePrices(f: { placeId: RequestPlaceId; trip: RequestTripKind; since: Date }, tx?: Tx): Promise<number[]> {
    // The picked offer's price on each finished private trip a rider posted to that place and kind.
    const rows = await this.db(tx).rideRequestOffer.findMany({
      where: {
        state: 'picked',
        request: {
          state: 'completed',
          origin: 'rider',
          privateCar: true,
          closedAt: { gte: f.since },
          // k1: a «جيب واحد» trip is known by where the car fetched from (`requestKnownPlace`).
          ...(f.trip === 'fetch' ? { fromPlace: { path: ['placeId'], equals: f.placeId } } : { toPlace: { path: ['placeId'], equals: f.placeId } }),
          details: { path: ['trip'], equals: f.trip },
        },
      },
      select: { priceIqd: true },
    });
    return rows.map((r) => r.priceIqd);
  }

  async privateTripCounts(driverIds: readonly string[], tx?: Tx): Promise<Record<string, number>> {
    const out: Record<string, number> = Object.fromEntries(driverIds.map((id) => [id, 0]));
    if (driverIds.length === 0) return out;
    const rows = await this.db(tx).rideRequestOffer.groupBy({
      by: ['driverId'],
      where: { driverId: { in: [...driverIds] }, state: 'picked', request: { state: 'completed' } },
      _count: { _all: true },
    });
    for (const r of rows) out[r.driverId] = r._count._all;
    return out;
  }

  // ───────────────────────── seat PIN attempts ─────────────────────────

  async addPinAttempt(a: PinAttemptRecord, tx?: Tx): Promise<void> {
    await this.db(tx).intercityPinAttempt.create({
      data: {
        id: a.id,
        departureId: a.departureId,
        cityId: a.cityId,
        driverId: a.driverId,
        targetBookingId: a.targetBookingId,
        matchedBookingId: a.matchedBookingId,
        result: a.result,
        alert: a.alert,
        refusedOnSeat: a.refusedOnSeat,
        at: a.at,
      },
    });
  }

  async pinAttemptsFor(departureId: string, tx?: Tx): Promise<PinAttemptRecord[]> {
    const rows = await this.db(tx).intercityPinAttempt.findMany({
      where: { departureId },
      orderBy: [{ at: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toPinAttempt);
  }

  async pinAlertsSince(cityId: string, since: Date, tx?: Tx): Promise<PinAttemptRecord[]> {
    const rows = await this.db(tx).intercityPinAttempt.findMany({
      where: { cityId, alert: { not: null }, at: { gte: since } },
      orderBy: [{ at: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toPinAttempt);
  }

  async getPinAttempt(id: string, tx?: Tx): Promise<PinAttemptRecord | null> {
    const row = await this.db(tx).intercityPinAttempt.findUnique({ where: { id } });
    return row ? toPinAttempt(row) : null;
  }

  // ───────────────────────── agreed prices (step 4) ─────────────────────────

  async saveAgreement(a: AgreementRecord, tx?: Tx): Promise<void> {
    const data = {
      departureId: a.departureId,
      riderId: a.riderId,
      driverId: a.driverId,
      kind: a.kind,
      lat: a.lat,
      lng: a.lng,
      note: a.note,
      state: a.state,
      amountIqd: a.amountIqd,
      askedAt: a.askedAt,
      proposedAt: a.proposedAt,
      expiresAt: a.expiresAt,
      decidedAt: a.decidedAt,
      bookingId: a.bookingId,
    };
    await this.db(tx).tripAgreement.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data });
  }

  async getAgreement(id: string, tx?: Tx): Promise<AgreementRecord | null> {
    const row = await this.db(tx).tripAgreement.findUnique({ where: { id } });
    return row ? toAgreement(row) : null;
  }

  async agreementsFor(departureId: string, riderId?: string, tx?: Tx): Promise<AgreementRecord[]> {
    const rows = await this.db(tx).tripAgreement.findMany({
      where: { departureId, ...(riderId ? { riderId } : {}) },
      orderBy: [{ askedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toAgreement);
  }

  async openAgreements(tx?: Tx): Promise<AgreementRecord[]> {
    const rows = await this.db(tx).tripAgreement.findMany({ where: { state: { in: ['asked', 'proposed'] } } });
    return rows.map(toAgreement);
  }
}

// ───────────────────────── row mapping ─────────────────────────

type PinAttemptRow = Awaited<ReturnType<Tx['intercityPinAttempt']['findUniqueOrThrow']>>;
type AgreementRow = Awaited<ReturnType<Tx['tripAgreement']['findUniqueOrThrow']>>;

function toAgreement(r: AgreementRow): AgreementRecord {
  return {
    id: r.id,
    departureId: r.departureId,
    riderId: r.riderId,
    driverId: r.driverId,
    kind: r.kind as AgreementRecord['kind'],
    lat: r.lat,
    lng: r.lng,
    note: r.note,
    state: r.state as AgreementRecord['state'],
    amountIqd: r.amountIqd,
    askedAt: r.askedAt,
    proposedAt: r.proposedAt,
    expiresAt: r.expiresAt,
    decidedAt: r.decidedAt,
    bookingId: r.bookingId,
  };
}

function toPinAttempt(r: PinAttemptRow): PinAttemptRecord {
  return {
    id: r.id,
    departureId: r.departureId,
    cityId: r.cityId,
    driverId: r.driverId,
    targetBookingId: r.targetBookingId,
    matchedBookingId: r.matchedBookingId,
    result: PinAttemptResult.parse(r.result),
    alert: r.alert === null ? null : PinAlertKind.parse(r.alert),
    refusedOnSeat: r.refusedOnSeat,
    at: r.at,
  };
}

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
  shares: Array<Awaited<ReturnType<Tx['rideRequestShare']['findUniqueOrThrow']>>>;
};
const REQUEST_INCLUDE = {
  offers: { orderBy: { createdAt: 'asc' as const } },
  shares: { orderBy: [{ joinedAt: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.RideRequestInclude;

/** Runs announced before the model list carry no `modelKey`; an unknown key (list shrank) reads as none. */
/** Snapshots written before a field existed read its default (no model, no promises about the car). */
function vehicleFromSnapshot(json: unknown): DepartureRecord['vehicle'] {
  const v = json as Omit<DepartureRecord['vehicle'], 'modelKey' | 'noSmoking' | 'bigBags' | 'ac'> & { modelKey?: unknown; noSmoking?: unknown; bigBags?: unknown; ac?: unknown };
  const key = VehicleModelKey.safeParse(v.modelKey);
  return { ...v, modelKey: key.success ? key.data : null, noSmoking: v.noSmoking === true, bigBags: v.bigBags === true, ac: v.ac === true };
}

const RatingJson = z.object({ stars: z.number().int().min(1).max(5), tags: z.array(RajaaRatingTag), at: z.coerce.date() });

function reviewFromRow(r: BookingRow): ReviewRecord | null {
  if (r.reviewText === null) return null;
  const reason = ReviewHideReason.safeParse(r.reviewHiddenReason);
  return {
    text: r.reviewText,
    at: r.reviewAt ?? r.updatedAt,
    hiddenAt: r.reviewHiddenAt,
    hiddenBy: r.reviewHiddenBy,
    hiddenReason: reason.success ? reason.data : null,
  };
}

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
    vehicle: vehicleFromSnapshot(r.vehicleSnapshot),
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
    dropoffFeeIqd: r.dropoffFeeIqd,
    dropoff: (r.dropoff as unknown as DropoffRecord | null) ?? null,
    payment: r.payment as BookingRecord['payment'],
    prepaid: r.prepaid,
    trusted: r.trusted,
    pin: r.pin,
    pickup: r.pickup as unknown as PickupRecord,
    largeBags: r.largeBags,
    lapChildren: r.lapChildren,
    returnDiscountIqd: r.returnDiscountIqd,
    returnPairId: r.returnPairId,
    heldUntil: r.heldUntil,
    bookedAt: r.bookedAt,
    atGarageAt: r.atGarageAt,
    checkedInAt: r.checkedInAt,
    noShowAt: r.noShowAt,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    lateMinutes: r.lateMinutes,
    taxiLateUntil: r.taxiLateUntil,
    demandPostId: r.demandPostId,
    movedFromBookingId: r.movedFromBookingId,
    movedToBookingId: r.movedToBookingId,
    createdAt: r.createdAt,
    rating: r.rating ? (RatingJson.safeParse(r.rating).data ?? null) : null,
    review: reviewFromRow(r),
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

/** Stored details through the contract (dates revived, defaults for rows written before y1). */
function parseRequestDetails(raw: unknown): RequestDetails {
  const parsed = RequestDetails.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_REQUEST_DETAILS };
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
    details: parseRequestDetails(r.details),
    seenDriverIds: r.seenDriverIds,
    state: r.state,
    origin: r.origin as RequestRecord['origin'],
    priceCapIqd: r.priceCapIqd,
    offers: r.offers.map((o): RequestOfferRecord => ({
      id: o.id,
      driverId: o.driverId,
      priceIqd: o.priceIqd,
      wait:
        o.waitIncludedHours !== null && o.extraHourIqd !== null
          ? { includedHours: o.waitIncludedHours, extraHourIqd: o.extraHourIqd }
          : null,
      at: o.createdAt,
      state: o.state,
      cash: (o.cashState as OfferCashState | null) ?? null,
    })),
    pickedOfferId: r.pickedOfferId,
    depositIqd: r.depositIqd,
    cashReserved: r.cashReserved,
    driverArrivedAt: r.driverArrivedAt,
    driverArrivedPin: (r.driverArrivedPin as unknown as RequestRecord['driverArrivedPin']) ?? null,
    waitStartedAt: r.waitStartedAt,
    waitEndedAt: r.waitEndedAt,
    fetchPersonId: r.fetchPersonId,
    share:
      r.shareCode && r.shareBookerPlaces !== null && r.sharePlaceIqd !== null && r.shareOpenedAt
        ? {
            code: r.shareCode,
            bookerPlaces: r.shareBookerPlaces,
            placeIqd: r.sharePlaceIqd,
            openedAt: r.shareOpenedAt,
            members: r.shares.map((m) => ({
              id: m.id,
              personId: m.personId,
              places: m.places,
              amountIqd: m.amountIqd,
              state: m.state as RequestShareMemberState,
              joinedAt: m.joinedAt,
              closedAt: m.closedAt,
              boardedAt: m.boardedAt,
              boardedBy: m.boardedBy as RequestShareBoardedBy | null,
            })),
          }
        : null,
    closedAt: r.closedAt,
    createdAt: r.createdAt,
  };
}
