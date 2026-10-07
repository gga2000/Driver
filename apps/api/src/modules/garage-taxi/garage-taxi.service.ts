import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DriverError,
  GARAGE_TAXI_EVENTS,
  GARAGE_TAXI_RULES,
  garageLateMin,
  garagePickupPlan,
  isDriverError,
  returnCarEtaMin,
  rideSearchStartsAt,
  shouldTellLate,
  type Actor,
  type BookingState,
  type ArmGarageTaxiInput,
  type BookToGarageInput,
  type DeliveryPoint,
  type GarageArmView,
  type GarageTaxiEnd,
  type GarageTaxiGarage,
  type GarageTaxiInput,
  type GarageTaxiLink,
  type GarageTaxiOrderInput,
  type GarageTaxiPayment,
  type GarageTaxiPlace,
  type GarageTaxiPort,
  type LatLng,
  type Order,
  type ToGarageInput,
  type ToGaragePlan,
  type ToGarageUnavailable,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { GARAGE_TAXIS_REPOSITORY, type GarageTaxiRecord, type GarageTaxisRepository } from './garage-taxi.repository.js';

export const GARAGE_TAXI_SOURCES = Symbol('GARAGE_TAXI_SOURCES');
export const GARAGE_TAXI_EMITTER = Symbol('GARAGE_TAXI_EMITTER');

const MIN_MS = 60_000;
export const GARAGE_TAXI_CITY = 'aziziyah';

/** A الرجعة seat as this module needs it (read from the routes module). */
export interface SeatFacts {
  id: string;
  riderId: string;
  departureId: string;
  state: BookingState;
  seatIds: string[];
  pickupKind: 'garage' | 'meeting_point' | 'door';
  /** The seat's new booking when the rider was moved to another car. */
  movedToBookingId: string | null;
}

/** A الرجعة car as this module needs it. */
export interface CarFacts {
  id: string;
  driverId: string;
  corridorId: string;
  direction: 'from_aziziyah' | 'to_aziziyah';
  garageId: string;
  departAt: Date;
  state: string;
  departedAt: Date | null;
  arrivedAt: Date | null;
  lastFix: { lat: number; lng: number; at: Date } | null;
}

export interface GarageFacts extends GarageTaxiGarage {
  cityId: string;
  lat: number;
  lng: number;
  draft: boolean;
}

export interface PlaceFacts extends GarageTaxiPlace {
  zoneId: string;
  pin: LatLng;
}

/** What this module reads and does elsewhere (bound in `GarageTaxiModule`, faked in tests). */
export interface GarageTaxiSources {
  seat(bookingId: string): Promise<SeatFacts | null>;
  car(departureId: string): Promise<CarFacts | null>;
  garages(): GarageFacts[];
  /** The corridor's scheduled travel minutes (null for an unknown corridor). */
  travelMin(corridorId: string): number | null;
  places(personId: string): Promise<PlaceFacts[]>;
  /** The zone under a pin (null outside every zone). */
  zoneOf(pin: LatLng): string | null;
  /** Learned taxi minutes between two points (the one ETA the ride screens use), at `at`'s traffic. */
  minutes(from: LatLng, to: LatLng, at?: Date): Promise<number>;
  /** The server's taxi fare between two points at `at` (`serverFees`, what `orders.place` locks) and what he pays. */
  fare(pickup: DeliveryPoint, dropoff: DeliveryPoint, at: Date): { fareIqd: number; totalIqd: number };
  place(personId: string, input: RidePlacement): Promise<Order>;
  order(orderId: string): Promise<Order | null>;
  /** The payment of his latest ride (cash or wallet), null when he has none. */
  usualPayment(personId: string): Promise<GarageTaxiPayment | null>;
  /** A matched ride's expected arrival at its drop-off by the one ETA (null when unknown). */
  rideArrival(orderId: string): Promise<Date | null>;
}

export interface RidePlacement {
  fareIqd: number;
  paymentMethod: GarageTaxiPayment;
  pickup: DeliveryPoint;
  dropoff: DeliveryPoint;
  scheduledFor?: Date;
  clientRequestId: string;
}

export interface GarageTaxiEmitter {
  emit(event: { type: string; actorId: string; occurredAt: Date; payload: Record<string, unknown>; orderId?: string; idempotencyKey?: string }, aggregate: { name: string; id: string }): Promise<void>;
}

/** Seat states that end his trip (`moved` only when there was no car to follow him to). */
const GONE: ReadonlySet<BookingState> = new Set<BookingState>(['cancelled', 'cancelled_by_rider', 'expired', 'no_show', 'moved']);
const CAR_OPEN = new Set(['scheduled', 'boarding']);
const CAR_CANCELLED = new Set(['cancelled_low_fill', 'cancelled_by_driver']);
const CAR_ARRIVED = new Set(['arrived', 'closed']);
const ORDER_OVER: ReadonlySet<Order['state']> = new Set(['customer_cancelled', 'platform_cancelled', 'merchant_rejected', 'refunded', 'failed', 'delivered', 'completed', 'closed']);
const ORDER_CANCELLED: ReadonlySet<Order['state']> = new Set(['customer_cancelled', 'platform_cancelled', 'merchant_rejected', 'refunded', 'failed']);
const LABEL_ORDER = { home: 0, work: 1, custom: 2 } as const;

const garageView = (g: GarageFacts): GarageTaxiGarage => ({ id: g.id, nameAr: g.nameAr, nameEn: g.nameEn });
const placeView = (p: PlaceFacts): GarageTaxiPlace => ({ id: p.id, label: p.label, name: p.name, zoneName_ar: p.zoneName_ar });

function metres(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * Taxis linked to a الرجعة seat (taxi ideas x2, x3, x4 + n10). Every ride is an ordinary ride of the
 * rider through `orders.place`: the server's fare at its time (`price_changed` when it moved), dispatch,
 * cancellation and payment rules as for any ride. Reads the seat and the car through the routes module's
 * public services and never changes them: no seat is held and no no-show rule moves here (x3 emits
 * `garage_taxi.late` for that — see `docs/api/rajaa-taxi.md`).
 *
 * - x2 `toGarage` / `bookToGarage`: from a seat on a car leaving an Aziziyah garage, a taxi that brings
 *   him there `bufferMin` before the car's time — departure − buffer − the learned minutes from his
 *   place (home by default), rounded down to the 5-minute grid of rides booked for later; closer than
 *   that, a ride now when it still makes it.
 * - x3 (`tick`): while that ride may still matter to the car, its expected arrival at the garage; once
 *   it would bring him `lateTellMin`+ after the car's time, `garage_taxi.late` (rider + الرجعة driver),
 *   again only when it grew by `lateRetellStepMin`. `forOrder` shows it on his live ride screen.
 * - x4 / n10 `arrival` / `arm` / `disarm` (+ `tick`): on a trip back to Aziziyah he arms a taxi to a
 *   saved place; when the car's live minutes to the Aziziyah garage reach `placeAtEtaMin`, the server
 *   books it (garage → place, his usual payment). Disarming is free while it is not booked; a cancelled
 *   trip drops it; a seat moved to another car keeps it.
 */
@Injectable()
export class GarageTaxiService implements GarageTaxiPort {
  private readonly logger = new Logger(GarageTaxiService.name);

  constructor(
    @Inject(GARAGE_TAXIS_REPOSITORY) private readonly repo: GarageTaxisRepository,
    @Inject(GARAGE_TAXI_SOURCES) private readonly sources: GarageTaxiSources,
    @Inject(GARAGE_TAXI_EMITTER) private readonly events: GarageTaxiEmitter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ───────────────────────── x2: to the car's garage ─────────────────────────

  async toGarage(actor: Actor, input: z.output<typeof ToGarageInput>): Promise<ToGaragePlan> {
    return (await this.planFor(actor.personId, input.bookingId, input.from)).view;
  }

  async bookToGarage(actor: Actor, input: z.output<typeof BookToGarageInput>): Promise<ToGaragePlan> {
    const plan = await this.planFor(actor.personId, input.bookingId, input.from);
    if (plan.view.status === 'booked') return plan.view;
    if (plan.view.status !== 'offer' || !plan.from || !plan.view.mode || plan.view.rideMin === null) throw new DriverError('booking_state_conflict');
    const paymentMethod = input.paymentMethod ?? plan.view.paymentMethod;
    // An ordinary ride of his: the fare he saw must still be the server's for that time.
    const order = await this.sources.place(actor.personId, {
      fareIqd: input.fareIqd,
      paymentMethod,
      pickup: plan.from.point,
      dropoff: plan.garagePoint,
      ...(plan.view.mode === 'later' && plan.view.pickupAt ? { scheduledFor: plan.view.pickupAt } : {}),
      clientRequestId: input.clientRequestId,
    });
    await this.repo.put(
      {
        ...(plan.link ? { id: plan.link.id } : {}),
        kind: 'to_garage',
        personId: actor.personId,
        bookingId: plan.seat.id,
        departureId: plan.car.id,
        state: 'placed',
        orderId: order.id,
        garageId: plan.car.garageId,
        placeId: plan.from.placeId,
        pin: plan.from.placeId ? null : plan.from.point.pin ?? null,
        zoneId: plan.from.point.zoneKey,
        paymentMethod,
        departAt: plan.car.departAt,
        pickupAt: plan.view.pickupAt,
        rideMin: plan.view.rideMin,
        expectedAt: plan.view.arriveAt,
        lateMin: 0,
        toldMin: null,
        toldAt: null,
        failCode: null,
        dropReason: null,
        placedAt: this.clock.now(),
        closedAt: null,
      },
      this.clock.now(),
    );
    return (await this.planFor(actor.personId, input.bookingId, input.from)).view;
  }

  /** x3: the late notice on his live ride screen (null for any ride that is not a taxi to his car). */
  async forOrder(actor: Actor, input: z.output<typeof GarageTaxiOrderInput>): Promise<GarageTaxiLink | null> {
    const link = await this.repo.byOrder(input.orderId);
    if (!link || link.kind !== 'to_garage' || link.personId !== actor.personId) return null;
    const garage = this.sources.garages().find((g) => g.id === link.garageId);
    if (!garage) return null;
    return {
      orderId: input.orderId,
      bookingId: link.bookingId,
      garage: garageView(garage),
      departAt: link.departAt,
      expectedAt: link.expectedAt,
      lateMin: link.lateMin ?? 0,
      driverTold: link.toldMin !== null,
      toldMin: link.toldMin,
    };
  }

  private async planFor(personId: string, bookingId: string, from: GarageTaxiEnd | undefined) {
    const now = this.clock.now();
    const seat = await this.ownSeat(personId, bookingId);
    const car = await this.sources.car(seat.departureId);
    if (!car) throw new DriverError('departure_not_found');
    const garage = this.garage(car.garageId);
    const places = await this.myPlaces(personId);
    const link = await this.repo.byBooking(seat.id, 'to_garage');
    const order = link?.orderId ? await this.sources.order(link.orderId) : null;
    const usual = (await this.sources.usualPayment(personId)) ?? 'cash';
    const base: ToGaragePlan = {
      bookingId: seat.id,
      status: 'unavailable',
      unavailable: null,
      garage: garageView(garage),
      departAt: car.departAt,
      places: places.map(placeView),
      fromPlaceId: null,
      fromName: null,
      mode: null,
      pickupAt: null,
      arriveAt: null,
      rideMin: null,
      bufferMin: GARAGE_TAXI_RULES.bufferMin,
      fareIqd: null,
      totalIqd: null,
      paymentMethod: usual,
      order: null,
    };
    const garagePoint = this.garagePoint(garage);
    const done = (view: ToGaragePlan, fromEnd: { placeId: string | null; point: DeliveryPoint } | null = null) => ({ view, seat, car, link, from: fromEnd, garagePoint });

    // Already on: the ride he booked (until it is cancelled — then he may book again).
    if (link && order && !ORDER_CANCELLED.has(order.state)) {
      const place = places.find((p) => p.id === link.placeId) ?? null;
      return done({
        ...base,
        status: 'booked',
        fromPlaceId: link.placeId,
        fromName: place?.name ?? null,
        mode: link.pickupAt ? 'later' : 'now',
        pickupAt: link.pickupAt,
        arriveAt: link.expectedAt,
        rideMin: link.rideMin,
        fareIqd: order.totalIqd,
        totalIqd: order.totalIqd,
        paymentMethod: order.paymentMethod === 'wallet' ? 'wallet' : 'cash',
        order: { orderId: order.id, state: order.state, scheduledFor: order.scheduledFor },
      });
    }
    const why = this.toGarageBlocked(seat, car, garage, now);
    if (why) return done({ ...base, unavailable: why });
    const end = this.fromEnd(from, places);
    if (!end) return done({ ...base, unavailable: 'no_place' });
    const rideMin = await this.sources.minutes(end.point.pin!, garage, car.departAt);
    const plan = garagePickupPlan(car.departAt, rideMin, now);
    const shown = { ...base, fromPlaceId: end.placeId, fromName: end.name, rideMin };
    if (plan.mode === 'too_late') return done({ ...shown, unavailable: 'too_late' }, end);
    const fare = this.sources.fare(end.point, garagePoint, plan.mode === 'later' ? plan.pickupAt : now);
    return done(
      {
        ...shown,
        status: 'offer',
        mode: plan.mode,
        pickupAt: plan.mode === 'later' ? plan.pickupAt : null,
        arriveAt: plan.arriveAt,
        fareIqd: fare.fareIqd,
        totalIqd: fare.totalIqd,
      },
      end,
    );
  }

  private toGarageBlocked(seat: SeatFacts, car: CarFacts, garage: GarageFacts, now: Date): ToGarageUnavailable | null {
    if (car.direction !== 'from_aziziyah' || garage.cityId !== GARAGE_TAXI_CITY) return 'not_from_aziziyah';
    if (seat.state !== 'booked') return 'not_booked';
    if (seat.pickupKind !== 'garage') return 'door_pickup';
    if (!CAR_OPEN.has(car.state) || car.departAt.getTime() <= now.getTime()) return 'car_left';
    return null;
  }

  private fromEnd(from: GarageTaxiEnd | undefined, places: readonly PlaceFacts[]): { placeId: string | null; name: string | null; point: DeliveryPoint } | null {
    if (from && 'pin' in from) {
      const zone = this.sources.zoneOf(from.pin);
      if (!zone) throw new DriverError('outside_zone');
      return { placeId: null, name: null, point: { zoneKey: zone, pin: from.pin } };
    }
    const place = from ? places.find((p) => p.id === from.placeId) : places[0];
    if (from && !place) throw new DriverError('place_not_found');
    if (!place) return null;
    return { placeId: place.id, name: place.name, point: { zoneKey: place.zoneId, pin: place.pin, placeId: place.id } };
  }

  // ───────────────────────── x4 / n10: waiting at the Aziziyah garage ─────────────────────────

  async arrival(actor: Actor, input: z.output<typeof GarageTaxiInput>): Promise<GarageArmView> {
    const seat = await this.currentSeat(await this.ownSeat(actor.personId, input.bookingId));
    return this.armView(actor.personId, input.bookingId, seat);
  }

  async arm(actor: Actor, input: z.output<typeof ArmGarageTaxiInput>): Promise<GarageArmView> {
    const seat = await this.currentSeat(await this.ownSeat(actor.personId, input.bookingId));
    const current = await this.armView(actor.personId, input.bookingId, seat);
    if (current.status === 'placed') return current;
    if (current.status === 'unavailable' || current.status === 'dropped') throw new DriverError('booking_state_conflict');
    const places = await this.myPlaces(actor.personId);
    if (!places.some((p) => p.id === input.to.placeId)) throw new DriverError('place_not_found');
    const car = await this.sources.car(seat.departureId);
    if (!car) throw new DriverError('departure_not_found');
    const existing = await this.repo.byBooking(seat.id, 'from_garage');
    const row = await this.repo.put(
      {
        ...(existing ? { id: existing.id } : {}),
        kind: 'from_garage',
        personId: actor.personId,
        bookingId: seat.id,
        departureId: car.id,
        state: 'armed',
        orderId: null,
        garageId: null,
        placeId: input.to.placeId,
        pin: null,
        zoneId: null,
        paymentMethod: input.paymentMethod ?? (await this.sources.usualPayment(actor.personId)) ?? 'cash',
        departAt: car.departAt,
        pickupAt: null,
        rideMin: null,
        expectedAt: null,
        lateMin: null,
        toldMin: null,
        toldAt: null,
        failCode: null,
        dropReason: null,
        placedAt: null,
        closedAt: null,
      },
      this.clock.now(),
    );
    // Armed when the car is already close: booked now rather than at the next look.
    await this.followArm(row);
    return this.armView(actor.personId, input.bookingId, seat);
  }

  async disarm(actor: Actor, input: z.output<typeof GarageTaxiInput>): Promise<GarageArmView> {
    const seat = await this.currentSeat(await this.ownSeat(actor.personId, input.bookingId));
    const row = await this.repo.byBooking(seat.id, 'from_garage');
    if (row?.state === 'placed') throw new DriverError('order_state_conflict');
    if (row && (row.state === 'armed' || row.state === 'failed')) await this.repo.put({ ...row, state: 'disarmed', closedAt: this.clock.now() }, this.clock.now());
    return this.armView(actor.personId, input.bookingId, seat);
  }

  private async armView(personId: string, bookingId: string, seat: SeatFacts): Promise<GarageArmView> {
    const now = this.clock.now();
    const car = await this.sources.car(seat.departureId);
    if (!car) throw new DriverError('departure_not_found');
    const places = await this.myPlaces(personId);
    const row = await this.repo.byBooking(seat.id, 'from_garage');
    const payment = row?.paymentMethod ?? (await this.sources.usualPayment(personId)) ?? 'cash';
    const placed = row?.state === 'placed' ? row : null;
    const garage = placed?.garageId ? this.garage(placed.garageId) : this.arrivalGarage(car);
    const to = places.find((p) => p.id === row?.placeId) ?? places[0] ?? null;
    const view: GarageArmView = {
      bookingId,
      status: 'off',
      unavailable: null,
      garage: garage ? garageView(garage) : null,
      places: places.map(placeView),
      toPlaceId: to?.id ?? null,
      toName: to?.name ?? null,
      estimateIqd: null,
      paymentMethod: payment,
      carEtaMin: null,
      placeAtEtaMin: GARAGE_TAXI_RULES.placeAtEtaMin,
      orderId: placed?.orderId ?? null,
      placedAt: placed?.placedAt ?? null,
      failCode: row?.state === 'failed' ? row.failCode : null,
    };
    if (placed) return { ...view, status: 'placed' };
    if (row?.state === 'dropped') return { ...view, status: 'dropped' };
    if (car.direction !== 'to_aziziyah') return { ...view, status: 'unavailable', unavailable: 'not_to_aziziyah' };
    if (seat.state !== 'booked' && seat.state !== 'checked_in') return { ...view, status: 'unavailable', unavailable: 'not_booked' };
    if (CAR_ARRIVED.has(car.state) || CAR_CANCELLED.has(car.state)) return { ...view, status: 'unavailable', unavailable: 'arrived' };
    if (!to) return { ...view, status: 'unavailable', unavailable: 'no_place' };
    const carEtaMin = garage ? await this.carEtaMin(car, garage, now) : null;
    let estimateIqd: number | null = null;
    if (garage) {
      try {
        estimateIqd = this.sources.fare(this.garagePoint(garage), { zoneKey: to.zoneId, pin: to.pin, placeId: to.id }, now).totalIqd;
      } catch (err) {
        // A place the city does not price a taxi to: no estimate, the arm still works and books what the server prices then.
        if (!isDriverError(err)) throw err;
      }
    }
    const status = row?.state === 'armed' ? 'armed' : row?.state === 'failed' ? 'failed' : 'off';
    return { ...view, status, estimateIqd, carEtaMin };
  }

  /** The Aziziyah garage the car is expected at: the nearest to its last fix (the first home garage without one). */
  private arrivalGarage(car: CarFacts): GarageFacts | null {
    const home = this.sources.garages().filter((g) => g.cityId === GARAGE_TAXI_CITY && !g.draft);
    if (home.length === 0) return null;
    const fix = car.lastFix;
    if (!fix) return home[0]!;
    return home.reduce((best, g) => (metres(fix, g) < metres(fix, best) ? g : best));
  }

  private async carEtaMin(car: CarFacts, garage: GarageFacts, now: Date): Promise<number | null> {
    if (!car.departedAt && !CAR_ARRIVED.has(car.state)) return null;
    if (CAR_ARRIVED.has(car.state)) return 0;
    const fix = car.lastFix;
    const fixMin = fix ? await this.sources.minutes(fix, garage) : null;
    return returnCarEtaMin({ now, departedAt: car.departedAt, travelMin: this.sources.travelMin(car.corridorId) ?? 0, fixAt: fix?.at ?? null, fixMin });
  }

  // ───────────────────────── the job ─────────────────────────

  /** One look at every armed taxi (x4) and every taxi on its way to a car (x3); returns how many changed. */
  async tick(): Promise<{ placed: number; dropped: number; failed: number; told: number }> {
    const out = { placed: 0, dropped: 0, failed: 0, told: 0 };
    for (const row of await this.repo.inState('from_garage', 'armed')) {
      try {
        const r = await this.followArm(row);
        if (r) out[r] += 1;
      } catch (err) {
        this.logger.warn(`armed taxi ${row.id}: ${(err as Error).message}`);
      }
    }
    for (const row of await this.repo.inState('to_garage', 'placed')) {
      try {
        if (await this.followLink(row)) out.told += 1;
      } catch (err) {
        this.logger.warn(`taxi to garage ${row.id}: ${(err as Error).message}`);
      }
    }
    return out;
  }

  /** x4: drop it, book it, or wait. */
  private async followArm(row: GarageTaxiRecord): Promise<'placed' | 'dropped' | 'failed' | null> {
    if (row.state !== 'armed') return null;
    const now = this.clock.now();
    const first = await this.sources.seat(row.bookingId);
    const seat = first ? await this.currentSeat(first) : null;
    if (seat && seat.id !== row.bookingId) {
      // Moved to another car (the driver cancelled): the arm goes with him.
      row = await this.repo.put({ ...row, bookingId: seat.id, departureId: seat.departureId }, now);
    }
    if (!seat || GONE.has(seat.state)) return this.drop(row, 'trip_cancelled');
    const car = await this.sources.car(seat.departureId);
    if (!car || CAR_CANCELLED.has(car.state)) return this.drop(row, 'trip_cancelled');
    if (CAR_OPEN.has(car.state)) return null;
    if (CAR_ARRIVED.has(car.state) && car.arrivedAt && now.getTime() - car.arrivedAt.getTime() > GARAGE_TAXI_RULES.arrivedGraceMin * MIN_MS) return this.drop(row, 'missed');
    const garage = this.arrivalGarage(car);
    if (!garage) return null;
    const eta = await this.carEtaMin(car, garage, now);
    if (eta === null || eta > GARAGE_TAXI_RULES.placeAtEtaMin) return null;
    return this.placeArm(row, garage, now);
  }

  private async placeArm(row: GarageTaxiRecord, garage: GarageFacts, now: Date): Promise<'placed' | 'failed'> {
    const place = (await this.sources.places(row.personId)).find((p) => p.id === row.placeId);
    try {
      if (!place) throw new DriverError('place_not_found');
      const pickup = this.garagePoint(garage);
      const dropoff: DeliveryPoint = { zoneKey: place.zoneId, pin: place.pin, placeId: place.id };
      // Priced now by the server, as every ride; the retry key makes a second look (or instance) the same ride.
      const fare = this.sources.fare(pickup, dropoff, now);
      const order = await this.sources.place(row.personId, { fareIqd: fare.fareIqd, paymentMethod: row.paymentMethod, pickup, dropoff, clientRequestId: `gtaxi_${row.id}` });
      await this.repo.put({ ...row, state: 'placed', orderId: order.id, garageId: garage.id, placedAt: now }, now);
      await this.events.emit(
        { type: GARAGE_TAXI_EVENTS.placed, actorId: 'system:garage_taxi', occurredAt: now, orderId: order.id, payload: { bookingId: row.bookingId, orderId: order.id, riderId: row.personId, garageId: garage.id, garageAr: garage.nameAr }, idempotencyKey: `${GARAGE_TAXI_EVENTS.placed}:${row.id}` },
        { name: 'garage_taxi', id: row.id },
      );
      return 'placed';
    } catch (err) {
      if (!isDriverError(err)) throw err;
      await this.repo.put({ ...row, state: 'failed', failCode: err.code, garageId: garage.id, closedAt: now }, now);
      await this.events.emit(
        { type: GARAGE_TAXI_EVENTS.failed, actorId: 'system:garage_taxi', occurredAt: now, payload: { bookingId: row.bookingId, riderId: row.personId, code: err.code, garageAr: garage.nameAr }, idempotencyKey: `${GARAGE_TAXI_EVENTS.failed}:${row.id}:${row.updatedAt.getTime()}` },
        { name: 'garage_taxi', id: row.id },
      );
      return 'failed';
    }
  }

  private async drop(row: GarageTaxiRecord, reason: 'trip_cancelled' | 'missed'): Promise<'dropped'> {
    const now = this.clock.now();
    await this.repo.put({ ...row, state: 'dropped', dropReason: reason, closedAt: now }, now);
    await this.events.emit(
      { type: GARAGE_TAXI_EVENTS.dropped, actorId: 'system:garage_taxi', occurredAt: now, payload: { bookingId: row.bookingId, riderId: row.personId, reason }, idempotencyKey: `${GARAGE_TAXI_EVENTS.dropped}:${row.id}:${row.updatedAt.getTime()}` },
      { name: 'garage_taxi', id: row.id },
    );
    return 'dropped';
  }

  /**
   * x3: the ride's expected arrival at the garage against the car's time. Closed once it cannot matter
   * (he boarded, the seat or the car is gone, the ride ended or was cancelled); told when late enough.
   */
  private async followLink(row: GarageTaxiRecord): Promise<boolean> {
    const now = this.clock.now();
    const close = async () => {
      await this.repo.put({ ...row, state: 'closed', closedAt: now }, now);
      return false;
    };
    const order = row.orderId ? await this.sources.order(row.orderId) : null;
    if (!order || ORDER_OVER.has(order.state)) return close();
    const seat = await this.sources.seat(row.bookingId);
    if (!seat || seat.state !== 'booked') return close();
    const car = await this.sources.car(row.departureId);
    if (!car || !CAR_OPEN.has(car.state)) return close();
    const arriveAt = await this.expectedArrival(row, order, now);
    if (!arriveAt) return false;
    const lateMin = garageLateMin(arriveAt, car.departAt);
    const tell = shouldTellLate(lateMin, row.toldMin);
    await this.repo.put({ ...row, departAt: car.departAt, expectedAt: arriveAt, lateMin, ...(tell ? { toldMin: lateMin, toldAt: now } : {}) }, now);
    if (!tell) return false;
    const garage = this.garage(car.garageId);
    await this.events.emit(
      {
        type: GARAGE_TAXI_EVENTS.late,
        actorId: 'system:garage_taxi',
        occurredAt: now,
        orderId: order.id,
        payload: {
          bookingId: seat.id,
          departureId: car.id,
          orderId: order.id,
          riderId: row.personId,
          driverId: car.driverId,
          lateMin,
          expectedAt: arriveAt.toISOString(),
          departAt: car.departAt.toISOString(),
          garageId: garage.id,
          garageAr: garage.nameAr,
          seats: seat.seatIds,
        },
        idempotencyKey: `${GARAGE_TAXI_EVENTS.late}:${row.id}:${lateMin}`,
      },
      { name: 'garage_taxi', id: row.id },
    );
    return true;
  }

  /**
   * When the taxi brings him to the garage: a matched ride by the one ETA (to the pickup, then the
   * ride); a ride still searching at the earliest now + the ride (no driver yet); a ride booked for
   * later says nothing before its search starts.
   */
  private async expectedArrival(row: GarageTaxiRecord, order: Order, now: Date): Promise<Date | null> {
    if (order.state === 'placed') {
      if (order.scheduledFor && now.getTime() < rideSearchStartsAt(order.scheduledFor).getTime()) return null;
      const start = Math.max(now.getTime(), order.scheduledFor?.getTime() ?? now.getTime());
      return row.rideMin === null ? null : new Date(start + row.rideMin * MIN_MS);
    }
    return this.sources.rideArrival(order.id);
  }

  // ───────────────────────── helpers ─────────────────────────

  private async ownSeat(personId: string, bookingId: string): Promise<SeatFacts> {
    const seat = await this.sources.seat(bookingId);
    if (!seat || seat.riderId !== personId) throw new DriverError('booking_not_found');
    return seat;
  }

  /** The seat as it is now: a rider moved to another car follows his new booking (at most a few hops). */
  private async currentSeat(seat: SeatFacts): Promise<SeatFacts> {
    let s = seat;
    for (let hop = 0; hop < 5 && s.movedToBookingId; hop++) {
      const next = await this.sources.seat(s.movedToBookingId);
      if (!next) break;
      s = next;
    }
    return s;
  }

  private garage(id: string): GarageFacts {
    const g = this.sources.garages().find((x) => x.id === id);
    if (!g) throw new DriverError('garage_not_found');
    return g;
  }

  private garagePoint(g: GarageFacts): DeliveryPoint {
    return { zoneKey: this.sources.zoneOf(g) ?? g.id, pin: { lat: g.lat, lng: g.lng } };
  }

  /** His saved places, home first, then work, then the rest. */
  private async myPlaces(personId: string): Promise<PlaceFacts[]> {
    return [...(await this.sources.places(personId))].sort((a, b) => LABEL_ORDER[a.label] - LABEL_ORDER[b.label]);
  }
}
