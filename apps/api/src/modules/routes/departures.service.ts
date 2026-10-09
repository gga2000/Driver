import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AnnounceInput,
  DriverError,
  encodeDomainEvent,
  HoldSeatInput,
  isDomainEventType,
  type IntercitySeatId,
  type DepartureNoShowFee,
  type MoneyRules,
  type PickupChoice,
  type PinAlertKind,
  PIN_ATTEMPT_RULES,
  type PinAttemptResult,
  type SeatPayment,
  type TravellingAs,
  type RajaaRatingTag,
  type ReviewHideReason,
  reviewTextProblem,
  type VehicleModelKey,
} from '@driver/contracts';
import { t } from '@driver/i18n';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { haversineMeters } from '../trips/index.js';
import { ROUTES_EVENTS, type RoutesEventEmitter } from './events.adapter.js';
import {
  destinationCity,
  directionFrom,
  HOME_CITY,
  originCity,
  type CorridorConfig,
  type GarageConfig,
  type IntercityNetworkConfig,
  type IntercityRules,
} from './intercity.config.js';
import {
  driverMeter,
  meterApplies,
  riderMeterMinutes,
  riderMeterStart,
  seatHoldUntil,
  type CheckpointWaiver,
} from './late-meter.js';
import {
  bookingTotal,
  LIVE,
  OCCUPYING,
  OPEN_DEPARTURE,
  type BookingRecord,
  type DepartureRecord,
  type Fix,
  type PickupRecord,
  type PinAttemptRecord,
} from './model.js';
import { RequestBoardService } from './request-board.service.js';
import { ROUTES_REPOSITORY, type RoutesRepository } from './routes.repository.js';
import { adjacencyViolation, rowSeats, seatsOf, type Occupant } from './seat-map.js';
import { localHour, MIN_MS, ROUTES_IDS, roundUpTo, walletHolds, type IdSource } from './support.js';
import { CHECKPOINT_WAIVER, ROUTES_MONEY_RULES, ROUTES_NETWORK, ROUTES_RULES } from './tokens.js';
import { ROUTES_WALLET, type WalletPort } from './wallet.js';
import { RoutesWriter } from './writer.js';

type Announce = z.output<typeof AnnounceInput>;
type Hold = z.output<typeof HoldSeatInput>;

/** Fill of a departure as the board and the T−30 rule read it. */
export interface Fill {
  seatsTotal: number;
  booked: number;
  held: number;
  walkUps: number;
  walkUpsCounted: number;
  filled: number;
  free: number;
}

export type NoShowVerdict = 'forfeit' | 'no_show' | null;

export type DepartBlocker = {
  bookingId: string | null;
  reason: 'not_checked_in' | 'too_early_not_full' | 'pickup_pending';
};

/** Called inside the announcing write (demand posts claim seats on the new departure). */
export type AnnounceListener = (tx: Tx, dep: DepartureRecord) => Promise<void>;

const TRAIL_MAX = 300;

/** Whose PIN a typed PIN is on this car, and what it may do. */
export interface PinVerdict {
  result: PinAttemptResult;
  matched: BookingRecord | null;
}

/**
 * The car's name as riders, pushes, SOS and share pages read it: a listed model by its Iraqi name
 * («النترا»), `other` (or a pre-list client) by what the driver typed.
 */
export function vehicleModelText(modelKey: VehicleModelKey | undefined, typed: string | undefined): string | null {
  if (modelKey && modelKey !== 'other') return t(`vehicle.model_${modelKey}`, undefined, 'ar-IQ');
  return typed?.trim() || null;
}

/**
 * What a typed seat PIN does on this car (Ali 2026-10-06 PIN safeguards). It boards a rider only when
 * it is a booked rider's PIN and, typed on a seat (garage mode), that seat's rider; otherwise it says
 * whose PIN it was: nobody's, another booking's (cross-use), or a booking that cannot board now.
 */
export function pinVerdict(bookings: readonly BookingRecord[], pin: string, bookingId?: string): PinVerdict {
  const boards = bookings.find((x) => x.pin === pin && x.state === 'booked' && (bookingId === undefined || x.id === bookingId));
  if (boards) return { result: 'checked_in', matched: boards };
  // Whose PIN it is: a live booking first (PINs are unique among those), else any earlier one.
  const matched = bookings.find((x) => x.pin === pin && LIVE.includes(x.state)) ?? bookings.find((x) => x.pin === pin) ?? null;
  if (!matched) return { result: 'wrong_pin', matched: null };
  if (bookingId !== undefined && matched.id !== bookingId) return { result: 'other_booking', matched };
  return { result: 'not_boardable', matched };
}

/**
 * The ops alert a refused PIN raises: another booking's PIN on this seat always does; otherwise the
 * seat's `PIN_ATTEMPT_RULES.wrongOnSeatAlertAt`-th refusal does, once per seat and departure.
 */
export function pinAlertFor(result: PinAttemptResult, refusedOnSeat: number, seatAlreadyAlerted: boolean): PinAlertKind | null {
  if (result === 'checked_in') return null;
  if (result === 'other_booking') return 'cross_use';
  return refusedOnSeat >= PIN_ATTEMPT_RULES.wrongOnSeatAlertAt && !seatAlreadyAlerted ? 'wrong_repeated' : null;
}

/**
 * Departures and seats (domain §2, decisions §8–§9, review C). The driver announces a run from a
 * garage; riders hold (10 min, free) and book (wallet prepay or cash reservation) seats, a row or the
 * car; the driver marks walk-ups, checks riders in by PIN, departs and arrives. Every rule that can
 * be checked on the server is: seat adjacency, booked-beats-walk-up, the depart guard, the late
 * meter, forfeits and moves.
 *
 * Owner of the T−30 low-fill rule: `tick()` (driven by `RoutesScheduler`) boards or cancels each
 * departure at T−30; dispatch's `DeparturesPort` is bound to `RoutesDeparturesPort`, whose
 * `cancelLowFill` re-applies the same rule through `cancelLowFill()` here, so a scheduled dispatch
 * request can never cancel a departure that is above the minimum.
 */
@Injectable()
export class DeparturesService {
  private readonly logger = new Logger(DeparturesService.name);
  private readonly listeners: AnnounceListener[] = [];

  constructor(
    @Inject(ROUTES_REPOSITORY) private readonly repo: RoutesRepository,
    @Inject(ROUTES_EVENTS) private readonly events: RoutesEventEmitter,
    @Inject(ROUTES_WALLET) private readonly wallet: WalletPort,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly writer: RoutesWriter,
    private readonly requests: RequestBoardService,
    @Inject(ROUTES_NETWORK) readonly network: IntercityNetworkConfig,
    @Inject(ROUTES_RULES) readonly rules: IntercityRules,
    @Inject(ROUTES_MONEY_RULES) readonly money: MoneyRules,
    @Inject(CHECKPOINT_WAIVER) private readonly waiver: CheckpointWaiver,
    @Inject(ROUTES_IDS) private readonly ids: IdSource,
  ) {}

  onAnnounce(listener: AnnounceListener): void {
    this.listeners.push(listener);
  }

  now(): Date {
    return this.clock.now();
  }

  // ───────────────────────── network ─────────────────────────

  garage(id: string): GarageConfig {
    const g = this.network.garages.find((x) => x.id === id);
    if (!g) throw new DriverError('garage_not_found');
    return g;
  }

  corridor(id: string): CorridorConfig {
    const c = this.network.corridors.find((x) => x.id === id);
    if (!c) throw new DriverError('corridor_not_found');
    return c;
  }

  // ───────────────────────── reads ─────────────────────────

  async departure(id: string, tx?: Tx): Promise<DepartureRecord> {
    const d = await this.repo.getDeparture(id, tx);
    if (!d) throw new DriverError('departure_not_found');
    return d;
  }

  bookings(departureId: string, tx?: Tx): Promise<BookingRecord[]> {
    return this.repo.bookingsFor(departureId, tx);
  }

  async booking(id: string, tx?: Tx): Promise<BookingRecord> {
    const b = await this.repo.getBooking(id, tx);
    if (!b) throw new DriverError('booking_not_found');
    return b;
  }

  /** Seats taken right now: live bookings (unexpired holds) and walk-ups. */
  occupants(dep: DepartureRecord, bookings: readonly BookingRecord[], at = this.now()): Occupant[] {
    const out: Occupant[] = [];
    for (const b of bookings) {
      if (!this.occupies(b, at)) continue;
      for (const seatId of b.seatIds)
        out.push({ seatId, groupId: b.id, travellingAs: b.travellingAs });
    }
    for (const w of dep.walkUps)
      out.push({ seatId: w.seatId, groupId: `walkup:${w.seatId}`, travellingAs: w.travellingAs });
    return out;
  }

  occupies(b: BookingRecord, at = this.now()): boolean {
    if (!OCCUPYING.includes(b.state)) return false;
    return !(b.state === 'held' && b.heldUntil !== null && b.heldUntil.getTime() <= at.getTime());
  }

  fill(dep: DepartureRecord, bookings: readonly BookingRecord[], at = this.now()): Fill {
    const seatsTotal = seatsOf(dep.layout).length;
    let booked = 0;
    let held = 0;
    for (const b of bookings) {
      if (!this.occupies(b, at)) continue;
      if (b.state === 'held') held += b.seatIds.length;
      else booked += b.seatIds.length;
    }
    const walkUps = dep.walkUps.length;
    const walkUpsCounted = dep.selfieAt ? walkUps : 0;
    return {
      seatsTotal,
      booked,
      held,
      walkUps,
      walkUpsCounted,
      filled: booked + walkUpsCounted,
      free: Math.max(0, seatsTotal - booked - held - walkUps),
    };
  }

  /** Door pickups already on this run (pending or accepted) and their detour. */
  doorLoad(
    bookings: readonly BookingRecord[],
    at = this.now(),
  ): { count: number; detourMin: number } {
    const door = bookings.filter(
      (b) => this.occupies(b, at) && b.pickup.kind === 'door' && b.pickup.status !== 'declined',
    );
    return {
      count: door.length,
      detourMin: door.reduce((s, b) => s + (b.pickup.detourMin ?? 0), 0),
    };
  }

  /** x3: until when this seat waits for our late taxi (null: no hold — switched off, none late, not a garage pickup). */
  seatHeldUntil(dep: DepartureRecord, b: BookingRecord): Date | null {
    return seatHoldUntil(dep, b, this.money.lateMeter.capMin, this.rules.seatHoldForLateTaxi === true);
  }

  /** Whether the driver may leave without this rider now, and how (decisions §8, review C-32). */
  noShowVerdict(
    dep: DepartureRecord,
    bookings: readonly BookingRecord[],
    b: BookingRecord,
    at = this.now(),
  ): NoShowVerdict {
    if (b.state !== 'booked') return null;
    if (b.pickup.kind === 'garage') {
      if (b.atGarageAt) return null;
      // x3: our taxi bringing him is late — his seat waits until it is due (capped), when switched on.
      const held = this.seatHeldUntil(dep, b);
      if (held && at.getTime() < held.getTime()) return null;
      if (meterApplies(b)) {
        const m = riderMeterMinutes(dep, bookings, b, at);
        if (m !== null && m >= this.money.lateMeter.capMin) return 'forfeit';
        return at.getTime() >= dep.latestDepartureAt.getTime() ? 'no_show' : null;
      }
      return at.getTime() >= dep.departAt.getTime() + this.rules.cashGraceMin * MIN_MS
        ? 'no_show'
        : null;
    }
    const near =
      dep.lastPosition &&
      haversineMeters(dep.lastPosition, b.pickup) <=
        (b.pickup.kind === 'door'
          ? this.garage(dep.garageId).geofenceM
          : this.rules.meetingPointMismatchM);
    if (!near) return null;
    if (b.pickup.kind === 'meeting_point') return dep.state === 'departed' ? 'no_show' : null;
    return at.getTime() >= dep.departAt.getTime() - this.rules.boardingWindowMin * MIN_MS
      ? 'no_show'
      : null;
  }

  departBlockers(
    dep: DepartureRecord,
    bookings: readonly BookingRecord[],
    at = this.now(),
  ): DepartBlocker[] {
    const out: DepartBlocker[] = [];
    for (const b of bookings) {
      if (b.state !== 'booked' || b.pickup.kind === 'meeting_point') continue;
      if (b.pickup.kind === 'door' && b.pickup.status === 'pending')
        out.push({ bookingId: b.id, reason: 'pickup_pending' });
      else if (this.noShowVerdict(dep, bookings, b, at) !== 'forfeit')
        out.push({ bookingId: b.id, reason: 'not_checked_in' });
    }
    const f = this.fill(dep, bookings, at);
    if (at.getTime() < dep.departAt.getTime() && f.booked + f.walkUps < f.seatsTotal)
      out.push({ bookingId: null, reason: 'too_early_not_full' });
    return out;
  }

  /**
   * Available wallet balance: the ledger's balance minus what intercity already holds against it and
   * what the rest of the platform holds (open wallet orders, SEC-07). Spend paths call it under the
   * rider's wallet lock (`writer.run(…, { walletLocks })`).
   */
  async walletAvailable(riderId: string, tx?: Tx, excludeBookingId?: string): Promise<number> {
    return (
      (await this.wallet.balance(riderId)) -
      (await walletHolds(this.repo, riderId, tx, excludeBookingId)) -
      (await this.wallet.heldElsewhere(riderId, tx))
    );
  }

  async seatsFilled(departureId: string): Promise<number | null> {
    const dep = await this.repo.getDeparture(departureId);
    if (!dep) return null;
    return this.fill(dep, await this.repo.bookingsFor(departureId)).filled;
  }

  // ───────────────────────── driver ─────────────────────────

  announce(driverId: string, input: Announce): Promise<DepartureRecord> {
    return this.writer.run(async (tx) => {
      const garage = this.garage(input.garageId);
      const corridor = this.corridor(input.corridorId);
      if (garage.cityId !== HOME_CITY && garage.cityId !== corridor.cityId)
        throw new DriverError('announce_invalid');
      const direction = directionFrom(garage.cityId);
      const now = this.now().getTime();
      const departAt = input.departAt.getTime();
      const latest = input.latestDepartureAt.getTime();
      if (
        departAt < now - 5 * MIN_MS ||
        departAt > now + this.rules.maxAnnounceAheadHours * 3600_000
      )
        throw new DriverError('announce_invalid');
      if (latest < departAt || latest > departAt + this.rules.maxLatestDepartureMin * MIN_MS)
        throw new DriverError('announce_invalid');
      const own = await this.repo.listDepartures(
        { driverId, states: ['scheduled', 'boarding', 'departed'] },
        tx,
      );
      if (own.some((d) => Math.abs(d.departAt.getTime() - departAt) < corridor.travelMin * MIN_MS))
        throw new DriverError('announce_invalid');
      const dep: DepartureRecord = {
        id: this.ids.id('dep'),
        driverId,
        corridorId: corridor.id,
        direction,
        garageId: garage.id,
        fromCityId: originCity(corridor, direction),
        toCityId: destinationCity(corridor, direction),
        departAt: input.departAt,
        latestDepartureAt: input.latestDepartureAt,
        announcedAt: this.now(),
        state: 'scheduled',
        layout: input.vehicle.layout,
        vehicle: {
          kind: input.vehicle.kind,
          plate: input.vehicle.plate,
          modelKey: input.vehicle.modelKey ?? null,
          model: vehicleModelText(input.vehicle.modelKey, input.vehicle.model),
          color: input.vehicle.color ?? null,
          noSmoking: input.vehicle.noSmoking ?? false,
          ac: input.vehicle.ac ?? false,
          bigBags: input.vehicle.bigBags ?? false,
        },
        familyOnly: input.familyOnly,
        seatPriceIqd: corridor.seatPriceIqd,
        frontPremiumIqd: corridor.frontPremiumIqd,
        walkUps: [],
        selfieAt: null,
        selfieRef: null,
        driverCheckIn: null,
        driverLeftGeofenceAt: null,
        trail: [],
        lastPosition: null,
        boardingAt: null,
        departedAt: null,
        arrivedAt: null,
        closedAt: null,
        cancelledAt: null,
        cancelReason: null,
        lowFillCheckedAt: null,
        createdAt: this.now(),
      };
      await this.repo.saveDeparture(dep, tx);
      await this.emit(tx, 'departure.scheduled', driverId, dep, {
        corridorId: dep.corridorId,
        direction,
        garageId: dep.garageId,
        departAt: dep.departAt,
        latestDepartureAt: dep.latestDepartureAt,
        layout: dep.layout,
        familyOnly: dep.familyOnly,
        seatPriceIqd: dep.seatPriceIqd,
      });
      for (const l of this.listeners) await l(tx, dep);
      return dep;
    });
  }

  selfie(driverId: string, departureId: string, ref: string): Promise<DepartureRecord> {
    return this.driverWrite(driverId, departureId, async (tx, dep) => {
      this.requireState(dep, ['scheduled', 'boarding']);
      dep.selfieAt = this.now();
      dep.selfieRef = ref;
      await this.repo.saveDeparture(dep, tx);
      await this.emit(tx, 'driver.checkin_selfie', driverId, dep, {
        selfieRef: ref,
        walkUps: dep.walkUps.length,
      });
      return dep;
    });
  }

  /**
   * A server-received fix. Before departure: the first fix inside the 150 m garage geofence checks
   * the driver in (the meter's condition); a later fix outside it freezes the meter. Always: the
   * trail (checkpoint waiver) and the last fix (riders' live car).
   */
  driverPosition(
    driverId: string,
    departureId: string,
    at: { lat: number; lng: number },
  ): Promise<DepartureRecord> {
    return this.driverWrite(driverId, departureId, async (tx, dep) => {
      this.requireState(dep, ['scheduled', 'boarding', 'departed']);
      const fix: Fix = { lat: at.lat, lng: at.lng, at: this.now() };
      dep.trail = [...dep.trail, fix].slice(-TRAIL_MAX);
      dep.lastPosition = fix;
      if (dep.state !== 'departed') {
        const g = this.garage(dep.garageId);
        const inside = haversineMeters(fix, g) <= g.geofenceM;
        if (inside && !dep.driverCheckIn) {
          dep.driverCheckIn = fix;
          await this.emit(tx, 'departure.driver_checked_in', driverId, dep, {
            lat: fix.lat,
            lng: fix.lng,
            lateMin: Math.max(0, Math.floor((fix.at.getTime() - dep.departAt.getTime()) / MIN_MS)),
          });
        } else if (!inside && dep.driverCheckIn && !dep.driverLeftGeofenceAt) {
          dep.driverLeftGeofenceAt = fix.at;
          await this.emit(tx, 'departure.driver_left_garage', driverId, dep, {
            lat: fix.lat,
            lng: fix.lng,
          });
        }
      }
      await this.repo.saveDeparture(dep, tx);
      return dep;
    });
  }

  /**
   * One tap: a free seat becomes a walk-up (no commission at launch). A held or booked seat can
   * never be given to a walk-up (domain §2, review C-32); family-only runs take family walk-ups only;
   * the adjacency rule applies to walk-ups too (an undeclared walk-up counts as a man).
   */
  markWalkUp(
    driverId: string,
    departureId: string,
    input: {
      seatId: IntercitySeatId;
      travellingAs?: TravellingAs | undefined;
      remove?: boolean | undefined;
    },
  ): Promise<DepartureRecord> {
    return this.driverWrite(driverId, departureId, async (tx, dep, bookings) => {
      this.requireState(dep, ['scheduled', 'boarding']);
      if (!seatsOf(dep.layout).includes(input.seatId)) throw new DriverError('invalid_input');
      if (input.remove) {
        if (!dep.walkUps.some((w) => w.seatId === input.seatId))
          throw new DriverError('invalid_input');
        dep.walkUps = dep.walkUps.filter((w) => w.seatId !== input.seatId);
        await this.repo.saveDeparture(dep, tx);
        await this.emit(tx, 'seat.walkup_unmarked', driverId, dep, { seatId: input.seatId });
        return dep;
      }
      const taken = this.occupants(dep, bookings).some((o) => o.seatId === input.seatId);
      if (taken) throw new DriverError('walkup_seat_taken');
      const ta = input.travellingAs ?? null;
      if (dep.familyOnly && ta !== 'aila') throw new DriverError('family_only_departure');
      const occ = [
        ...this.occupants(dep, bookings),
        { seatId: input.seatId, groupId: `walkup:${input.seatId}`, travellingAs: ta },
      ];
      if (adjacencyViolation(dep.layout, occ)) throw new DriverError('seat_adjacency_blocked');
      dep.walkUps = [
        ...dep.walkUps,
        { seatId: input.seatId, travellingAs: ta, markedAt: this.now() },
      ];
      await this.repo.saveDeparture(dep, tx);
      await this.emit(tx, 'seat.walkup_marked', driverId, dep, {
        seatId: input.seatId,
        travellingAs: ta,
        countsTowardFill: dep.selfieAt !== null,
      });
      return dep;
    });
  }

  /**
   * PIN check-in; settles the rider's late meter if it ran (decisions §8). Every PIN typed here is
   * logged in the same write (`intercity_pin_attempts`, ids only; Ali 2026-10-06 safeguards): a
   * refused one is committed before `pin_invalid` goes back, and it raises an ops alert when it was
   * another booking's PIN typed on this seat (cross-use) or the `PIN_ATTEMPT_RULES.wrongOnSeatAlertAt`-th
   * refused PIN on one seat.
   */
  async checkIn(driverId: string, departureId: string, pin: string, bookingId?: string): Promise<DepartureRecord> {
    const outcome = await this.driverWrite(driverId, departureId, async (tx, dep, bookings) => {
      this.requireState(dep, ['scheduled', 'boarding', 'departed']);
      // Garage mode types the PIN on one rider's seat: then it has to be that rider's PIN.
      const verdict = pinVerdict(bookings, pin, bookingId);
      const now = this.now();
      const b = verdict.result === 'checked_in' ? verdict.matched : null;
      if (!b) {
        await this.recordRefusedPin(tx, dep, bookings, driverId, bookingId ?? null, verdict, now);
        return null;
      }
      await this.repo.addPinAttempt(
        { id: this.ids.id('pa'), departureId: dep.id, cityId: HOME_CITY, driverId, targetBookingId: bookingId ?? null, matchedBookingId: b.id, result: 'checked_in', alert: null, refusedOnSeat: 0, at: now },
        tx,
      );
      const minutes = meterApplies(b) ? riderMeterMinutes(dep, bookings, b, now) : null;
      b.state = 'checked_in';
      b.checkedInAt = now;
      if (b.pickup.kind === 'door' && b.pickup.status === 'pending') b.pickup.status = 'accepted';
      b.lateMinutes = minutes;
      await this.repo.saveBooking(b, tx);
      await this.emit(tx, 'seat.checked_in', driverId, dep, {
        bookingId: b.id,
        riderId: b.riderId,
        seatIds: b.seatIds,
        lateMinutes: minutes,
      });
      if (minutes !== null) await this.settleRiderMeter(tx, dep, bookings, b, minutes);
      return dep;
    });
    // The refusal is logged (and alerted) with the write above committed; the driver still hears no.
    if (!outcome) throw new DriverError('pin_invalid');
    return outcome;
  }

  /** A staff member's masked call to the driver of a PIN alert: `departure.pin_alert_call_requested` (ids only). */
  async logPinAlertCall(staffId: string, alert: PinAttemptRecord, callId: string, mode: 'proxy' | 'dev_direct'): Promise<void> {
    await this.writer.run(async (tx) => {
      const dep = await this.departure(alert.departureId, tx);
      await this.emit(tx, 'departure.pin_alert_call_requested', staffId, dep, { attemptId: alert.id, driverId: alert.driverId, callId, mode });
    });
  }

  /** A departure's PIN attempts, oldest first (the Console's history behind a PIN alert). */
  pinAttempts(departureId: string): Promise<PinAttemptRecord[]> {
    return this.repo.pinAttemptsFor(departureId);
  }

  /**
   * Logs a refused PIN and decides its ops alert (ids and seats only, never the PIN or a name):
   * `cross_use` when it belonged to another booking than the seat it was typed on; otherwise
   * `wrong_repeated` once per seat (or the plain pad) when its refusals reach the limit. An alert is
   * also `seat.pin_alert` on the departure's event log.
   */
  private async recordRefusedPin(
    tx: Tx,
    dep: DepartureRecord,
    bookings: readonly BookingRecord[],
    driverId: string,
    targetBookingId: string | null,
    verdict: PinVerdict,
    now: Date,
  ): Promise<void> {
    const earlier = (await this.repo.pinAttemptsFor(dep.id, tx)).filter((a) => a.targetBookingId === targetBookingId);
    const refusedOnSeat = earlier.filter((a) => a.result !== 'checked_in').length + 1;
    const alert = pinAlertFor(verdict.result, refusedOnSeat, earlier.some((a) => a.alert === 'wrong_repeated'));
    const attempt: PinAttemptRecord = {
      id: this.ids.id('pa'),
      departureId: dep.id,
      cityId: HOME_CITY,
      driverId,
      targetBookingId,
      matchedBookingId: verdict.matched?.id ?? null,
      result: verdict.result,
      alert,
      refusedOnSeat,
      at: now,
    };
    await this.repo.addPinAttempt(attempt, tx);
    if (!alert) return;
    const seatsOf = (id: string | null) => (id ? (bookings.find((x) => x.id === id)?.seatIds ?? []) : []);
    await this.emit(tx, 'seat.pin_alert', driverId, dep, {
      // The ops desk that watches every garage (Kut and Baghdad ones included) is Aziziyah's.
      cityId: HOME_CITY,
      alert,
      attemptId: attempt.id,
      targetBookingId,
      targetSeatIds: seatsOf(targetBookingId),
      matchedBookingId: attempt.matchedBookingId,
      matchedSeatIds: seatsOf(attempt.matchedBookingId),
      result: attempt.result,
      refusedOnSeat,
    });
  }

  /**
   * Who a masked call from the driver reaches (garage mode "اتصل"): a rider still on his live run
   * (booked or on board, departure not finished). The call is logged as
   * `departure.rider_call_requested` (ids only, never a number).
   */
  async riderForCall(driverId: string, departureId: string, bookingId: string, callId: string): Promise<string> {
    const dep = await this.departure(departureId);
    if (dep.driverId !== driverId) throw new DriverError('not_departure_driver');
    if (!['scheduled', 'boarding', 'departed'].includes(dep.state)) throw new DriverError('departure_state_conflict');
    const b = (await this.repo.bookingsFor(dep.id)).find((x) => x.id === bookingId);
    if (!b || (b.state !== 'booked' && b.state !== 'checked_in')) throw new DriverError('booking_not_found');
    await this.writer.run((tx) => this.emit(tx, 'departure.rider_call_requested', driverId, dep, { bookingId: b.id, riderId: b.riderId, callId }));
    return b.riderId;
  }

  /** The driver leaves without a rider: a forfeit (prepaid, meter at the cap) moves her; a no-show ends the seat. */
  markNoShow(driverId: string, departureId: string, bookingId: string): Promise<DepartureRecord> {
    return this.driverWrite(driverId, departureId, async (tx, dep, bookings) => {
      this.requireState(dep, ['scheduled', 'boarding', 'departed']);
      const b = bookings.find((x) => x.id === bookingId);
      if (!b) throw new DriverError('booking_not_found');
      const verdict = this.noShowVerdict(dep, bookings, b);
      if (verdict === null) throw new DriverError('no_show_not_allowed');
      if (verdict === 'forfeit') await this.forfeit(tx, dep, bookings, b);
      else await this.noShow(tx, dep, b);
      return dep;
    });
  }

  /** Door pickups wait for the driver (review C-37: he sees the detour first). Declined → the garage. */
  respondPickup(
    driverId: string,
    departureId: string,
    bookingId: string,
    accept: boolean,
  ): Promise<DepartureRecord> {
    return this.driverWrite(driverId, departureId, async (tx, dep, bookings) => {
      this.requireState(dep, ['scheduled', 'boarding']);
      const b = bookings.find((x) => x.id === bookingId);
      if (!b || !LIVE.includes(b.state)) throw new DriverError('booking_not_found');
      if (b.pickup.kind !== 'door' || b.pickup.status !== 'pending')
        throw new DriverError('booking_state_conflict');
      if (accept) b.pickup.status = 'accepted';
      else {
        const g = this.garage(dep.garageId);
        b.pickup = {
          kind: 'garage',
          meetingPointId: null,
          lat: g.lat,
          lng: g.lng,
          note: null,
          feeIqd: 0,
          status: 'accepted',
          detourMin: null,
        };
        b.pickupFeeIqd = 0;
      }
      await this.repo.saveBooking(b, tx);
      await this.emit(tx, accept ? 'pickup.accepted' : 'pickup.declined', driverId, dep, {
        bookingId: b.id,
        riderId: b.riderId,
      });
      return dep;
    });
  }

  /**
   * `departed` requires every booked garage/door seat checked in or resolved (review C-32): riders
   * whose prepaid meter reached the cap are forfeited here (moved to the next car); anyone else
   * blocks. Before the announced time only a full car may leave. Settles the driver's meter.
   */
  depart(driverId: string, departureId: string): Promise<DepartureRecord> {
    return this.driverWrite(driverId, departureId, async (tx, dep, bookings) => {
      this.requireState(dep, ['scheduled', 'boarding']);
      const now = this.now();
      const blockers = this.departBlockers(dep, bookings, now);
      if (blockers.length > 0) throw new DriverError('depart_blocked');
      for (const b of bookings)
        if (
          b.state === 'booked' &&
          b.pickup.kind !== 'meeting_point' &&
          this.noShowVerdict(dep, bookings, b, now) === 'forfeit'
        )
          await this.forfeit(tx, dep, bookings, b);
      for (const b of bookings)
        if (b.state === 'held') await this.expireHold(tx, dep, b, 'departed');
      const corridor = this.corridor(dep.corridorId);
      const meter = driverMeter(dep, now, this.waiver.waives(dep, corridor));
      const waiting = uniq(bookings.filter((b) => b.state === 'checked_in').map((b) => b.riderId));
      dep.state = 'departed';
      dep.departedAt = now;
      await this.repo.saveDeparture(dep, tx);
      const f = this.fill(dep, bookings, now);
      await this.emit(tx, 'departure.departed', driverId, dep, { seats: f, driverMeter: meter });
      if (meter.minutes > this.money.lateMeter.graceMin && waiting.length > 0) {
        await this.emit(tx, 'seat.late_meter_settled', driverId, dep, {
          departureId: dep.id,
          occurredAt: now,
          minutesLate: meter.minutes,
          late: { kind: 'driver', id: dep.driverId },
          driverId: dep.driverId,
          waitingRiderIds: waiting,
        });
      }
      await this.checkWalkUpShare(tx, dep);
      return dep;
    });
  }

  /** Arrived: checked-in seats complete and settle (seat 10 %, front premium 25 % — ledger). */
  arrive(driverId: string, departureId: string): Promise<DepartureRecord> {
    return this.driverWrite(driverId, departureId, async (tx, dep, bookings) => {
      await this.arriveNow(tx, dep, bookings, driverId);
      return dep;
    });
  }

  private async arriveNow(tx: Tx, dep: DepartureRecord, bookings: BookingRecord[], actorId: string): Promise<void> {
    this.requireState(dep, ['departed']);
    if (bookings.some((b) => b.state === 'booked')) throw new DriverError('depart_blocked');
    const now = this.now();
    dep.state = 'arrived';
    dep.arrivedAt = now;
    await this.repo.saveDeparture(dep, tx);
    for (const b of bookings) {
      if (b.state !== 'checked_in') continue;
      b.state = 'completed';
      b.completedAt = now;
      await this.repo.saveBooking(b, tx);
      for (const [i, seatId] of b.seatIds.entries()) {
        await this.emit(
          tx,
          'seat.completed',
          actorId,
          dep,
          this.seatMoney(dep, b, seatId, i === 0),
        );
      }
    }
    await this.emit(tx, 'departure.arrived', actorId, dep, {
      completed: bookings.filter((b) => b.state === 'completed').length,
    });
  }

  // ───────────────────────── staff (W3: NTF-10, NTF-14) ─────────────────────────

  /**
   * Staff cancel of a departure whose driver never came (NTF-14). Riders are moved to the next cars
   * exactly as on a driver cancel. With `fee` (M-11, switch `GARAGE_NO_SHOW_FEE`) the driver owes each
   * booked rider what a late driver cancel costs (2,000, doubled from 18:00), carried by
   * `departure.cancelled` (the ledger credits the riders and takes it from the driver's balance);
   * without it the fee is 0. `after` runs inside the same write (the audit row, the only place the
   * staff's reason is kept); the departure and its events carry the fixed code `ops` (`driver_no_show`
   * when automatic). Already cancelled: unchanged, nothing charged twice.
   */
  staffCancel(
    staffId: string,
    departureId: string,
    after: StaffAfter,
    opts: { auto?: boolean; fee?: boolean } = {},
  ): Promise<StaffWrite> {
    return this.writer.run(async (tx) => {
      const dep = await this.departure(departureId, tx);
      if (dep.state === 'cancelled_by_driver' || dep.state === 'cancelled_low_fill') return { dep, changed: false, auditId: null, fee: null };
      this.requireState(dep, ['scheduled', 'boarding']);
      const bookings = await this.freshBookings(tx, dep);
      const now = this.now();
      const affected = bookings.filter((b) => LIVE.includes(b.state));
      const riders = uniq(affected.filter((b) => b.state !== 'held').map((b) => b.riderId));
      const fee = opts.fee ? this.noShowFee(dep, bookings) : null;
      dep.state = 'cancelled_by_driver';
      dep.cancelledAt = now;
      // A fixed code only: the staff's free-text reason stays in the Console audit row (it may name people).
      dep.cancelReason = opts.auto ? 'driver_no_show' : 'ops';
      await this.repo.saveDeparture(dep, tx);
      await this.relocate(tx, dep, affected, {
        from: now,
        to: new Date(Math.max(now.getTime(), dep.departAt.getTime()) + this.rules.moveWindowMin * MIN_MS),
      });
      await this.emit(tx, 'departure.cancelled', staffId, dep, {
        departureId: dep.id,
        occurredAt: now,
        driverId: dep.driverId,
        cancelledBy: 'driver',
        feeIqd: fee?.driverChargeIqd ?? 0,
        riderIds: riders,
      });
      await this.emit(tx, 'departure.ops_cancelled', staffId, dep, {
        reason: dep.cancelReason,
        auto: opts.auto === true,
        riders: riders.length,
        feeIqd: fee?.driverChargeIqd ?? 0,
      });
      return { dep, changed: true, auditId: await after(tx, dep), fee };
    });
  }

  /** «وصلت» on the driver's behalf (NTF-14): the same completion and settlement as his own tap. */
  staffArrive(staffId: string, departureId: string, after: StaffAfter): Promise<StaffWrite> {
    return this.writer.run(async (tx) => {
      const dep = await this.departure(departureId, tx);
      if (dep.state === 'arrived' || dep.state === 'closed') return { dep, changed: false, auditId: null, fee: null };
      await this.arriveNow(tx, dep, await this.repo.bookingsFor(dep.id, tx), staffId);
      return { dep, changed: true, auditId: await after(tx, dep), fee: null };
    });
  }

  /** Closes an arrived departure now (NTF-10); the scheduler would after `closeAfterArrivalMin`. */
  staffClose(staffId: string, departureId: string, after: StaffAfter): Promise<StaffWrite> {
    return this.writer.run(async (tx) => {
      const dep = await this.departure(departureId, tx);
      if (dep.state === 'closed') return { dep, changed: false, auditId: null, fee: null };
      this.requireState(dep, ['arrived']);
      dep.state = 'closed';
      dep.closedAt = this.now();
      await this.repo.saveDeparture(dep, tx);
      await this.emit(tx, 'departure.closed', staffId, dep, { by: 'ops' });
      return { dep, changed: true, auditId: await after(tx, dep), fee: null };
    });
  }

  /**
   * Departures that need a person (NTF-14): still scheduled/boarding `noShowAfterMin` past the latest
   * departure time (the driver never came), or departed and `overdueAfterMin` past the corridor's
   * travel time with no «وصلت». Oldest first.
   */
  async overdue(limits: { noShowAfterMin: number; overdueAfterMin: number }, limit = 100): Promise<OverdueRecord[]> {
    const now = this.now();
    const out: OverdueRecord[] = [];
    for (const dep of await this.repo.listDepartures({ states: ['scheduled', 'boarding', 'departed'] })) {
      let since: Date;
      let reason: OverdueRecord['reason'];
      if (dep.state === 'departed') {
        const travelMin = this.corridor(dep.corridorId).travelMin;
        since = new Date((dep.departedAt ?? dep.departAt).getTime() + (travelMin + limits.overdueAfterMin) * MIN_MS);
        reason = 'not_arrived';
      } else {
        since = new Date(dep.latestDepartureAt.getTime() + limits.noShowAfterMin * MIN_MS);
        reason = 'driver_no_show';
      }
      if (since.getTime() > now.getTime()) continue;
      const bookings = await this.repo.bookingsFor(dep.id);
      const riders = bookings.filter((b) => b.state === 'booked' || b.state === 'checked_in').length;
      const fee = reason === 'driver_no_show' ? this.noShowFee(dep, bookings) : null;
      out.push({ dep, reason, since, minutes: Math.floor((now.getTime() - since.getTime()) / MIN_MS), riders, fee });
    }
    return out.sort((a, b) => a.since.getTime() - b.since.getTime()).slice(0, limit);
  }

  /**
   * What a driver owes for leaving his booked riders (review C-46, M-11): `driverCancelFeePerRiderIqd`
   * per distinct booked rider (held seats are nobody's yet), doubled for a departure at or after
   * `cancelFeeDoublesFromHour` Baghdad time. Shared by a late driver cancel and a staff no-show cancel.
   */
  noShowFee(dep: DepartureRecord, bookings: readonly BookingRecord[]): DepartureNoShowFee {
    const riders = uniq(bookings.filter((b) => LIVE.includes(b.state) && b.state !== 'held').map((b) => b.riderId)).length;
    const doubled = localHour(dep.departAt, this.rules.utcOffsetMin) >= this.rules.cancelFeeDoublesFromHour;
    const perRiderIqd = this.rules.driverCancelFeePerRiderIqd * (doubled ? 2 : 1);
    return { riders, perRiderIqd, doubled, driverChargeIqd: riders * perRiderIqd };
  }

  /**
   * Driver cancel (domain §2, review C-46/48): riders are moved to the next departures (same seat
   * class where possible, never paying more); inside 2 h the driver owes 2,000 per booked rider
   * (doubled for departures from 18:00), credited to them; riders with no car within 2 h are
   * stranded: dispatcher paged and a private-car request opened at the seat price.
   */
  cancelByDriver(driverId: string, departureId: string, reason: string): Promise<DepartureRecord> {
    return this.driverWrite(driverId, departureId, async (tx, dep, bookings) => {
      this.requireState(dep, ['scheduled', 'boarding']);
      const now = this.now();
      const inside =
        now.getTime() >= dep.departAt.getTime() - this.rules.driverCancelFeeWindowMin * MIN_MS;
      const affected = bookings.filter((b) => LIVE.includes(b.state));
      const riders = uniq(affected.filter((b) => b.state !== 'held').map((b) => b.riderId));
      const { doubled, driverChargeIqd } = this.noShowFee(dep, bookings);
      const feeIqd = inside ? driverChargeIqd : 0;
      dep.state = 'cancelled_by_driver';
      dep.cancelledAt = now;
      dep.cancelReason = reason;
      await this.repo.saveDeparture(dep, tx);
      await this.relocate(tx, dep, affected, {
        from: new Date(
          Math.max(now.getTime(), dep.departAt.getTime() - this.rules.boardingWindowMin * MIN_MS),
        ),
        to: new Date(dep.departAt.getTime() + this.rules.moveWindowMin * MIN_MS),
      });
      await this.emit(tx, 'departure.cancelled', driverId, dep, {
        departureId: dep.id,
        occurredAt: now,
        driverId: dep.driverId,
        cancelledBy: 'driver',
        feeIqd,
        riderIds: riders,
      });
      if (inside)
        await this.emit(tx, 'departure.driver_cancelled_late', driverId, dep, {
          reason,
          riders: riders.length,
          feeIqd,
          doubled,
        });
      return dep;
    });
  }

  // ───────────────────────── riders ─────────────────────────

  hold(riderId: string, input: Hold): Promise<BookingRecord> {
    return this.writer.run(async (tx) => {
      const dep = await this.departure(input.departureId, tx);
      const bookings = await this.freshBookings(tx, dep);
      const mine = bookings.find((b) => b.riderId === riderId && LIVE.includes(b.state));
      if (mine) {
        // A retried "احجز" (the answer was lost, a double tap) gets the hold it already made, not an error.
        if (mine.state === 'held' && this.occupies(mine) && this.sameSelection(dep, mine, input.selection)) return mine;
        throw new DriverError('booking_state_conflict');
      }
      const seatIds = this.selectionSeats(dep, input.selection);
      return this.place(tx, dep, bookings, {
        riderId,
        seatIds,
        selection: input.selection.kind,
        travellingAs: input.travellingAs,
        pickup: input.pickup,
        largeBags: input.largeBags,
        origin: 'rider',
        state: 'held',
      });
    });
  }

  /**
   * Holds `n` seats for a demand post on a freshly announced departure (inside the announcing write).
   * Prefers seats away from the front (no premium the rider did not choose). Null when nothing fits.
   */
  async holdForDemand(
    tx: Tx,
    dep: DepartureRecord,
    post: {
      id: string;
      riderId: string;
      seats: number;
      travellingAs: TravellingAs;
      pickup: PickupChoice;
    },
  ): Promise<BookingRecord | null> {
    const bookings = await this.freshBookings(tx, dep);
    if (bookings.some((b) => b.riderId === post.riderId && LIVE.includes(b.state))) return null;
    if (dep.familyOnly && post.travellingAs !== 'aila') return null;
    const seatIds = this.pickSeats(dep, bookings, post.seats, post.travellingAs, {
      preferFront: false,
      groupId: 'claim',
    });
    if (!seatIds) return null;
    try {
      return await this.place(tx, dep, bookings, {
        riderId: post.riderId,
        seatIds,
        selection: 'seats',
        travellingAs: post.travellingAs,
        pickup: post.pickup,
        largeBags: false,
        origin: 'demand_claim',
        demandPostId: post.id,
        state: 'held',
      });
    } catch (err) {
      if (err instanceof DriverError) return null;
      throw err;
    }
  }

  /** Own the hold: wallet prepay, or a cash reservation (revoked after two no-shows; trusted after three seats). */
  book(riderId: string, bookingId: string, payment: SeatPayment): Promise<BookingRecord> {
    return this.writer.run(async (tx) => {
      const b = await this.ownBooking(riderId, bookingId, tx);
      const dep = await this.departure(b.departureId, tx);
      if (b.state === 'held' && b.heldUntil && b.heldUntil.getTime() <= this.now().getTime()) {
        await this.expireHold(tx, dep, b, 'lapsed');
        throw new DriverError('hold_expired');
      }
      if (b.state === 'expired') throw new DriverError('hold_expired');
      // A retried "ثبّت" with the same payment answers with the booking it already made (no second event).
      if (b.state === 'booked' && b.payment === payment) return b;
      if (b.state !== 'held') throw new DriverError('booking_state_conflict');
      this.requireState(dep, OPEN_DEPARTURE);
      const total = bookingTotal(b);
      if (payment === 'wallet') {
        if ((await this.walletAvailable(riderId, tx, b.id)) < total)
          throw new DriverError('wallet_insufficient');
        b.prepaid = true;
        b.trusted = false;
      } else {
        const stats = await this.repo.riderStats(riderId, tx);
        if (stats.cashStrikes >= this.rules.cashNoShowsToRevoke)
          throw new DriverError('cash_reservation_revoked');
        b.prepaid = false;
        b.trusted = stats.completedBookings >= this.rules.trustedAfterSeats;
      }
      b.payment = payment;
      b.state = 'booked';
      b.bookedAt = this.now();
      b.heldUntil = null;
      await this.repo.saveBooking(b, tx);
      await this.emit(tx, 'seat.booked', riderId, dep, {
        bookingId: b.id,
        seatIds: b.seatIds,
        payment,
        prepaid: b.prepaid,
        trusted: b.trusted,
        totalIqd: total,
      });
      return b;
    }, payment === 'wallet' ? { walletLocks: [riderId] } : undefined);
  }

  /**
   * Rider cancel: holds always; a moved / forfeit-hold seat any time before departure (the
   * "رجّعلي الفلوس" choice); a prepaid seat until boarding opens at T−30; a cash reservation any time
   * before departure (no fee — not showing up is what costs reservation rights).
   */
  cancel(riderId: string, bookingId: string): Promise<BookingRecord> {
    return this.writer.run(async (tx) => {
      const b = await this.ownBooking(riderId, bookingId, tx);
      const dep = await this.departure(b.departureId, tx);
      if (b.state !== 'held' && b.state !== 'booked')
        throw new DriverError('booking_state_conflict');
      this.requireState(dep, OPEN_DEPARTURE);
      if (
        b.state === 'booked' &&
        b.prepaid &&
        b.origin !== 'moved' &&
        b.origin !== 'forfeit_hold' &&
        this.rules.riderFreeCancelUntilBoarding
      ) {
        if (this.now().getTime() >= dep.departAt.getTime() - this.rules.boardingWindowMin * MIN_MS)
          throw new DriverError('seat_cancel_too_late');
      }
      b.state = 'cancelled_by_rider';
      b.cancelledAt = this.now();
      await this.repo.saveBooking(b, tx);
      await this.emit(tx, 'seat.cancelled', riderId, dep, {
        bookingId: b.id,
        seatIds: b.seatIds,
        by: 'rider',
      });
      return b;
    });
  }

  /**
   * «شلون كانت الرجعة؟» (joy r2): once, on the rider's own completed booking — stars, chips and (x14)
   * an optional line that other riders read on the driver's profile. A line carrying a phone number,
   * link or handle is refused whole, so nothing is half-saved.
   */
  rate(
    riderId: string,
    bookingId: string,
    rating: { stars: number; tags: readonly RajaaRatingTag[]; comment?: string | undefined },
  ): Promise<BookingRecord> {
    const text = rating.comment?.trim() || null;
    if (text && reviewTextProblem(text)) throw new DriverError('review_contact_info');
    return this.writer.run(async (tx) => {
      const b = await this.ownBooking(riderId, bookingId, tx);
      if (b.state !== 'completed' || b.rating) throw new DriverError('booking_state_conflict');
      const now = this.now();
      b.rating = { stars: rating.stars, tags: [...new Set(rating.tags)], at: now };
      b.review = text ? { text, at: now, hiddenAt: null, hiddenBy: null, hiddenReason: null } : null;
      await this.repo.saveBooking(b, tx);
      const dep = await this.departure(b.departureId, tx);
      await this.emit(tx, 'seat.rated', riderId, dep, {
        bookingId: b.id,
        driverId: dep.driverId,
        stars: b.rating.stars,
        tags: b.rating.tags,
        withReview: text !== null,
      });
      return b;
    });
  }

  /** Ops (Console «كلام الركاب»): take a review off the driver's profile. The text is kept; the hide is an event. */
  hideReview(staffId: string, bookingId: string, reason: ReviewHideReason): Promise<BookingRecord> {
    return this.writer.run(async (tx) => {
      const b = await this.repo.getBooking(bookingId, tx);
      if (!b?.review) throw new DriverError('review_not_found');
      if (b.review.hiddenAt) return b;
      b.review = { ...b.review, hiddenAt: this.now(), hiddenBy: staffId, hiddenReason: reason };
      await this.repo.saveBooking(b, tx);
      await this.emit(tx, 'review.hidden', staffId, await this.departure(b.departureId, tx), { bookingId: b.id, reason });
      return b;
    });
  }

  /** Ops: put a hidden review back. */
  unhideReview(staffId: string, bookingId: string): Promise<BookingRecord> {
    return this.writer.run(async (tx) => {
      const b = await this.repo.getBooking(bookingId, tx);
      if (!b?.review) throw new DriverError('review_not_found');
      if (!b.review.hiddenAt) return b;
      b.review = { ...b.review, hiddenAt: null, hiddenBy: null, hiddenReason: null };
      await this.repo.saveBooking(b, tx);
      await this.emit(tx, 'review.unhidden', staffId, await this.departure(b.departureId, tx), { bookingId: b.id });
      return b;
    });
  }

  /**
   * Whether a finished run was on time, by the same garage meter that pays waiting riders: on time
   * when the driver's minutes (late check-in, unless waived at a checkpoint, plus sitting past the hard
   * latest time) stayed within the meter's grace. Null when the run has no garage check-in to judge.
   */
  runOnTime(dep: DepartureRecord): boolean | null {
    if (!dep.driverCheckIn || !dep.departedAt) return null;
    const meter = driverMeter(dep, dep.departedAt, this.waiver.waives(dep, this.corridor(dep.corridorId)));
    return meter.minutes <= this.money.lateMeter.graceMin;
  }

  /**
   * x3, called by the garage-taxi module only: our taxi bringing `riderId` to this seat's garage is due
   * at `until` and late for the car (null: on time again, or the taxi is gone). Recorded on the seat
   * whatever the switch; it holds the seat only while `seatHoldForLateTaxi` is on (`noShowVerdict`).
   * A seat that is no longer booked (boarded, no-show, cancelled, moved) is left alone.
   */
  taxiLate(riderId: string, bookingId: string, until: Date | null): Promise<void> {
    return this.writer.run(async (tx) => {
      const b = await this.ownBooking(riderId, bookingId, tx);
      if (b.state !== 'booked' || b.pickup.kind !== 'garage') return;
      if ((b.taxiLateUntil?.getTime() ?? null) === (until?.getTime() ?? null)) return;
      b.taxiLateUntil = until;
      await this.repo.saveBooking(b, tx);
    });
  }

  /** "أني بالكراج": inside the geofence it blocks a no-show; at a meeting point > 300 m off it warns both. */

  imHere(
    riderId: string,
    bookingId: string,
    at: { lat: number; lng: number },
  ): Promise<{
    atGarage: boolean;
    distanceM: number | null;
    warning: 'meeting_point_mismatch' | null;
  }> {
    return this.writer.run(async (tx) => {
      const b = await this.ownBooking(riderId, bookingId, tx);
      if (b.state !== 'booked' && b.state !== 'checked_in')
        throw new DriverError('booking_state_conflict');
      const dep = await this.departure(b.departureId, tx);
      if (b.pickup.kind === 'garage') {
        const g = this.garage(dep.garageId);
        const inside = haversineMeters(at, g) <= g.geofenceM;
        if (inside && !b.atGarageAt) {
          b.atGarageAt = this.now();
          await this.repo.saveBooking(b, tx);
          await this.emit(tx, 'seat.rider_at_garage', riderId, dep, {
            bookingId: b.id,
            lat: at.lat,
            lng: at.lng,
          });
        }
        return { atGarage: inside || b.atGarageAt !== null, distanceM: null, warning: null };
      }
      const distanceM = Math.round(haversineMeters(at, b.pickup));
      const mismatch = distanceM > this.rules.meetingPointMismatchM;
      if (mismatch)
        await this.emit(tx, 'pickup.mismatch', riderId, dep, {
          bookingId: b.id,
          distanceM,
          meetingPointId: b.pickup.meetingPointId,
        });
      return { atGarage: false, distanceM, warning: mismatch ? 'meeting_point_mismatch' : null };
    });
  }

  // ───────────────────────── scheduler & ports ─────────────────────────

  /**
   * Holds lapse; at T−30 each scheduled departure boards or, below the minimum fill (walk-ups after
   * the selfie included), is cancelled for low fill with its riders moved; arrived runs close.
   */
  async tick(
    tx: Tx,
  ): Promise<{ expired: number; boarding: number; lowFill: number; closed: number }> {
    const now = this.now();
    const out = { expired: 0, boarding: 0, lowFill: 0, closed: 0 };
    for (const dep of await this.repo.listDepartures({ states: ['scheduled', 'boarding'] }, tx)) {
      const bookings = await this.repo.bookingsFor(dep.id, tx);
      for (const b of bookings) {
        if (b.state === 'held' && b.heldUntil && b.heldUntil.getTime() <= now.getTime()) {
          await this.expireHold(tx, dep, b, 'lapsed');
          out.expired += 1;
        }
      }
      if (dep.state !== 'scheduled' || dep.lowFillCheckedAt) continue;
      if (now.getTime() < dep.departAt.getTime() - this.rules.boardingWindowMin * MIN_MS) continue;
      const f = this.fill(dep, bookings, now);
      if (f.filled < this.rules.minSeatsAtTMinus30) {
        // Below the minimum: it waits (still scheduled, still selling) until its low-fill time.
        if (now.getTime() < this.lowFillAt(dep).getTime()) continue;
        dep.lowFillCheckedAt = now;
        await this.lowFillCancel(tx, dep, bookings, f);
        out.lowFill += 1;
      } else {
        dep.lowFillCheckedAt = now;
        dep.state = 'boarding';
        dep.boardingAt = now;
        await this.repo.saveDeparture(dep, tx);
        await this.emit(tx, 'departure.boarding', 'system', dep, { seats: f });
        out.boarding += 1;
      }
    }
    for (const dep of await this.repo.listDepartures({ states: ['arrived'] }, tx)) {
      if (
        !dep.arrivedAt ||
        dep.arrivedAt.getTime() + this.rules.closeAfterArrivalMin * MIN_MS > now.getTime()
      )
        continue;
      dep.state = 'closed';
      dep.closedAt = now;
      await this.repo.saveDeparture(dep, tx);
      await this.emit(tx, 'departure.closed', 'system', dep, {});
      out.closed += 1;
    }
    return out;
  }

  /**
   * When a departure below the minimum fill may be cancelled for low fill (product decision
   * 2026-10-04): never before the announced time minus `lowFillNotBeforeMin` (10); a car announced
   * less than the boarding window (30 min) ahead is judged only at its hard latest departure, so a
   * driver announcing on arrival at the garage keeps his car while walk-ups come.
   */
  lowFillAt(dep: Pick<DepartureRecord, 'announcedAt' | 'departAt' | 'latestDepartureAt'>): Date {
    const shortNotice = dep.announcedAt.getTime() > dep.departAt.getTime() - this.rules.boardingWindowMin * MIN_MS;
    if (shortNotice) return dep.latestDepartureAt;
    return new Date(dep.departAt.getTime() - (this.rules.lowFillNotBeforeMin ?? 10) * MIN_MS);
  }

  /** Dispatch's port: the low-fill time of a departure (null when unknown). */
  async lowFillCheckAt(departureId: string): Promise<Date | null> {
    const dep = await this.repo.getDeparture(departureId);
    return dep ? this.lowFillAt(dep) : null;
  }

  /** Dispatch's port: cancels only when the same rule holds — below the minimum, at or after its low-fill time (one owner: this module). */
  cancelLowFill(departureId: string): Promise<boolean> {
    return this.writer.run(async (tx) => {
      const dep = await this.repo.getDeparture(departureId, tx);
      if (!dep || !OPEN_DEPARTURE.includes(dep.state)) return false;
      if (this.now().getTime() < this.lowFillAt(dep).getTime()) {
        this.logger.warn(`cancelLowFill(${departureId}) refused: before its low-fill time ${this.lowFillAt(dep).toISOString()}`);
        return false;
      }
      const bookings = await this.freshBookings(tx, dep);
      const f = this.fill(dep, bookings);
      if (f.filled >= this.rules.minSeatsAtTMinus30) {
        this.logger.warn(`cancelLowFill(${departureId}) refused: ${f.filled} seats filled`);
        return false;
      }
      dep.lowFillCheckedAt = dep.lowFillCheckedAt ?? this.now();
      await this.lowFillCancel(tx, dep, bookings, f);
      return true;
    });
  }

  // ───────────────────────── internals ─────────────────────────

  private async lowFillCancel(
    tx: Tx,
    dep: DepartureRecord,
    bookings: BookingRecord[],
    f: Fill,
  ): Promise<void> {
    const now = this.now();
    const affected = bookings.filter((b) => LIVE.includes(b.state));
    dep.state = 'cancelled_low_fill';
    dep.cancelledAt = now;
    dep.cancelReason = 'low_fill';
    await this.repo.saveDeparture(dep, tx);
    await this.relocate(tx, dep, affected, {
      from: now,
      to: new Date(dep.departAt.getTime() + this.rules.moveWindowMin * MIN_MS),
    });
    await this.emit(tx, 'departure.cancelled', 'system', dep, {
      departureId: dep.id,
      occurredAt: now,
      driverId: dep.driverId,
      cancelledBy: 'low_fill',
      feeIqd: 0,
      riderIds: uniq(affected.filter((b) => b.state !== 'held').map((b) => b.riderId)),
    });
    await this.emit(tx, 'departure.low_fill', 'system', dep, {
      seats: f,
      minSeats: this.rules.minSeatsAtTMinus30,
    });
  }

  /** Prepaid rider at the 20-min cap: meter settled, then an automatic hold on the next car within 2 h. */
  private async forfeit(
    tx: Tx,
    dep: DepartureRecord,
    bookings: BookingRecord[],
    b: BookingRecord,
  ): Promise<void> {
    const now = this.now();
    const minutes = Math.min(
      riderMeterMinutes(dep, bookings, b, now) ?? this.money.lateMeter.capMin,
      this.money.lateMeter.capMin,
    );
    b.lateMinutes = minutes;
    await this.settleRiderMeter(tx, dep, bookings, b, minutes);
    await this.emit(tx, 'seat.forfeited', dep.driverId, dep, {
      bookingId: b.id,
      riderId: b.riderId,
      minutesLate: minutes,
    });
    await this.relocate(
      tx,
      dep,
      [b],
      { from: now, to: new Date(now.getTime() + this.rules.moveWindowMin * MIN_MS) },
      'forfeit_hold',
    );
  }

  private async noShow(tx: Tx, dep: DepartureRecord, b: BookingRecord): Promise<void> {
    const now = this.now();
    b.state = 'no_show';
    b.noShowAt = now;
    await this.repo.saveBooking(b, tx);
    if (b.prepaid) {
      // Domain §2: the driver keeps a prepaid no-show's fare (ledger `seat.no_show`).
      for (const [i, seatId] of b.seatIds.entries())
        await this.emit(
          tx,
          'seat.no_show',
          dep.driverId,
          dep,
          this.seatMoney(dep, b, seatId, i === 0),
        );
    } else {
      const stats = await this.repo.riderStats(b.riderId, tx);
      await this.emit(tx, 'seat.reservation_no_show', dep.driverId, dep, {
        bookingId: b.id,
        riderId: b.riderId,
        cashStrikes: stats.cashStrikes,
        revoked: stats.cashStrikes >= this.rules.cashNoShowsToRevoke,
      });
    }
  }

  private async settleRiderMeter(
    tx: Tx,
    dep: DepartureRecord,
    bookings: readonly BookingRecord[],
    b: BookingRecord,
    minutes: number,
  ): Promise<void> {
    if (minutes <= this.money.lateMeter.graceMin) return;
    const waiting = uniq(
      bookings
        .filter((o) => o.id !== b.id && o.checkedInAt !== null && o.riderId !== b.riderId)
        .map((o) => o.riderId),
    );
    await this.emit(tx, 'seat.late_meter_settled', dep.driverId, dep, {
      departureId: dep.id,
      seatId: b.id,
      occurredAt: this.now(),
      minutesLate: minutes,
      late: { kind: 'rider', id: b.riderId },
      driverId: dep.driverId,
      waitingRiderIds: waiting,
      taxiLateMinutes: this.taxiLateMeterMinutes(dep, bookings, b, minutes),
    });
  }

  /**
   * x3: how many of `b`'s meter minutes ran while our own taxi bringing him was still due (capped like
   * the hold). The company pays those blocks (ledger `lateTaxiPaysMeter`), whether or not the seat
   * hold is switched on: the lateness is ours either way. 0 when he had no late taxi.
   */
  private taxiLateMeterMinutes(dep: DepartureRecord, bookings: readonly BookingRecord[], b: BookingRecord, minutes: number): number {
    const held = seatHoldUntil(dep, b, this.money.lateMeter.capMin, true);
    const start = riderMeterStart(dep, bookings, b);
    if (!held || !start) return 0;
    return Math.min(minutes, Math.max(0, Math.floor((held.getTime() - start.getTime()) / MIN_MS)));
  }

  /**
   * Moves live bookings off `dep` to the earliest compatible departure in `window` (same corridor,
   * direction and origin city): same seats if free, else the same class (front kept only when it was
   * booked), adjacency and family-only respected; a moved rider never pays more. Holds are simply
   * cancelled. No car → `cancelled`, dispatcher paged, a private-car request at the seat price.
   */
  private async relocate(
    tx: Tx,
    dep: DepartureRecord,
    affected: BookingRecord[],
    window: { from: Date; to: Date },
    origin: 'moved' | 'forfeit_hold' = 'moved',
  ): Promise<void> {
    const now = this.now();
    for (const b of affected) {
      if (b.state === 'held') {
        b.state = 'cancelled';
        b.cancelledAt = now;
        await this.repo.saveBooking(b, tx);
        await this.emit(tx, 'seat.hold_cancelled', 'system', dep, {
          bookingId: b.id,
          riderId: b.riderId,
        });
        continue;
      }
      const target = await this.findTarget(tx, dep, b, window);
      if (target) {
        const g = this.garage(target.dep.garageId);
        const corridor = this.corridor(target.dep.corridorId);
        const keepMp =
          b.pickup.kind === 'meeting_point' &&
          corridor.meetingPoints.some((m) => m.id === b.pickup.meetingPointId);
        const pickup: PickupRecord = keepMp
          ? { ...b.pickup, status: 'accepted' }
          : {
              kind: 'garage',
              meetingPointId: null,
              lat: g.lat,
              lng: g.lng,
              note: null,
              feeIqd: 0,
              status: 'accepted',
              detourMin: null,
            };
        const moved: BookingRecord = {
          ...b,
          id: this.ids.id('bk'),
          departureId: target.dep.id,
          seatIds: target.seatIds,
          state: b.state === 'checked_in' ? 'booked' : b.state,
          origin,
          seatPriceIqd: Math.min(b.seatPriceIqd, target.dep.seatPriceIqd),
          frontPremiumIqd:
            target.seatIds.includes('front') && b.seatIds.includes('front')
              ? Math.min(b.frontPremiumIqd, target.dep.frontPremiumIqd)
              : 0,
          pickupFeeIqd: keepMp ? Math.min(b.pickupFeeIqd, pickup.feeIqd) : 0,
          pin: this.uniquePin(target.bookings),
          pickup,
          heldUntil: null,
          bookedAt: now,
          atGarageAt: null,
          checkedInAt: null,
          noShowAt: null,
          completedAt: null,
          cancelledAt: null,
          lateMinutes: null,
          movedFromBookingId: b.id,
          movedToBookingId: null,
          createdAt: now,
        };
        await this.repo.saveBooking(moved, tx);
        b.state = 'moved';
        b.movedToBookingId = moved.id;
        await this.repo.saveBooking(b, tx);
        await this.emit(tx, 'seat.moved', 'system', dep, {
          bookingId: b.id,
          riderId: b.riderId,
          toBookingId: moved.id,
          toDepartureId: target.dep.id,
          toGarageId: target.dep.garageId,
          departAt: target.dep.departAt,
          seatIds: moved.seatIds,
          refundIqd: bookingTotal(b) - bookingTotal(moved),
          origin,
        });
      } else {
        b.state = 'cancelled';
        b.cancelledAt = now;
        await this.repo.saveBooking(b, tx);
        const corridor = this.corridor(dep.corridorId);
        await this.emit(tx, 'intercity.rider_stranded', 'system', dep, {
          bookingId: b.id,
          riderId: b.riderId,
          garageId: dep.garageId,
          reason: origin,
        });
        await this.requests.openForStranded(tx, {
          riderId: b.riderId,
          garageId: dep.garageId,
          toLabel: dep.toCityId === HOME_CITY ? 'العزيزية' : corridor.nameAr,
          seats: b.seatIds.length,
          travellingAs: b.travellingAs,
          priceCapIqd: bookingTotal(b),
          bookingId: b.id,
        });
      }
    }
  }

  private async findTarget(
    tx: Tx,
    src: DepartureRecord,
    b: BookingRecord,
    window: { from: Date; to: Date },
  ): Promise<{
    dep: DepartureRecord;
    seatIds: IntercitySeatId[];
    bookings: BookingRecord[];
  } | null> {
    const candidates = await this.repo.listDepartures(
      {
        corridorId: src.corridorId,
        direction: src.direction,
        fromCityId: src.fromCityId,
        states: OPEN_DEPARTURE,
        from: window.from,
        to: window.to,
      },
      tx,
    );
    for (const c of candidates) {
      if (c.id === src.id) continue;
      if (c.familyOnly && b.travellingAs !== 'aila') continue;
      const bookings = await this.freshBookings(tx, c);
      if (bookings.some((x) => x.riderId === b.riderId && LIVE.includes(x.state))) continue;
      const same =
        b.seatIds.every((s) => seatsOf(c.layout).includes(s)) &&
        this.seatsFit(c, bookings, b.seatIds, b.travellingAs, b.id)
          ? b.seatIds
          : null;
      const seatIds =
        same ??
        this.pickSeats(c, bookings, b.seatIds.length, b.travellingAs, {
          preferFront: b.seatIds.includes('front'),
          groupId: b.id,
        });
      if (seatIds) return { dep: c, seatIds, bookings };
    }
    return null;
  }

  /** `n` free seats on `dep` that keep the adjacency rule, preferring (or avoiding) the front. */
  pickSeats(
    dep: DepartureRecord,
    bookings: readonly BookingRecord[],
    n: number,
    travellingAs: TravellingAs,
    opts: { preferFront: boolean; groupId: string },
  ): IntercitySeatId[] | null {
    const taken = new Set(this.occupants(dep, bookings).map((o) => o.seatId));
    const free = seatsOf(dep.layout).filter((s) => !taken.has(s));
    if (free.length < n) return null;
    const combos = combinations(free, n).sort((a, b) => score(b) - score(a));
    function score(c: IntercitySeatId[]): number {
      return c.includes('front') === opts.preferFront ? 1 : 0;
    }
    return combos.find((c) => this.seatsFit(dep, bookings, c, travellingAs, opts.groupId)) ?? null;
  }

  private seatsFit(
    dep: DepartureRecord,
    bookings: readonly BookingRecord[],
    seatIds: IntercitySeatId[],
    travellingAs: TravellingAs,
    groupId: string,
  ): boolean {
    const occ = this.occupants(dep, bookings);
    if (seatIds.some((s) => occ.some((o) => o.seatId === s))) return false;
    if (dep.familyOnly && travellingAs !== 'aila') return false;
    return (
      adjacencyViolation(dep.layout, [
        ...occ,
        ...seatIds.map((seatId) => ({ seatId, groupId, travellingAs })),
      ]) === null
    );
  }

  /** True when `sel` picks exactly the seats `booking` holds (a retry of the same hold). */
  private sameSelection(dep: DepartureRecord, booking: BookingRecord, sel: Hold['selection']): boolean {
    try {
      return sameSeats(booking.seatIds, this.selectionSeats(dep, sel));
    } catch {
      return false;
    }
  }

  private selectionSeats(dep: DepartureRecord, sel: Hold['selection']): IntercitySeatId[] {
    if (sel.kind === 'car') return seatsOf(dep.layout);
    if (sel.kind === 'row') {
      const seats = rowSeats(dep.layout, sel.row);
      if (!seats) throw new DriverError('invalid_input');
      return seats;
    }
    const all = seatsOf(dep.layout);
    if (
      new Set(sel.seatIds).size !== sel.seatIds.length ||
      sel.seatIds.some((s) => !all.includes(s))
    )
      throw new DriverError('invalid_input');
    return sel.seatIds;
  }

  /** Validates seats, travelling-as and pickup, then writes the booking (nothing is written on a refusal). */
  private async place(
    tx: Tx,
    dep: DepartureRecord,
    bookings: BookingRecord[],
    spec: {
      riderId: string;
      seatIds: IntercitySeatId[];
      selection: BookingRecord['selection'];
      travellingAs: TravellingAs;
      pickup: PickupChoice;
      largeBags: boolean;
      origin: BookingRecord['origin'];
      demandPostId?: string;
      state: 'held';
    },
  ): Promise<BookingRecord> {
    this.requireState(dep, OPEN_DEPARTURE);
    const now = this.now();
    if (now.getTime() >= dep.latestDepartureAt.getTime())
      throw new DriverError('departure_state_conflict');
    const occ = this.occupants(dep, bookings, now);
    if (spec.seatIds.some((s) => occ.some((o) => o.seatId === s)))
      throw new DriverError('seat_unavailable');
    if (dep.familyOnly && spec.travellingAs !== 'aila')
      throw new DriverError('family_only_departure');
    const id = this.ids.id('bk');
    if (
      adjacencyViolation(dep.layout, [
        ...occ,
        ...spec.seatIds.map((seatId) => ({ seatId, groupId: id, travellingAs: spec.travellingAs })),
      ])
    )
      throw new DriverError('seat_adjacency_blocked');
    const pickup = this.resolvePickup(dep, bookings, spec.pickup);
    const b: BookingRecord = {
      id,
      departureId: dep.id,
      riderId: spec.riderId,
      seatIds: spec.seatIds,
      selection: spec.selection,
      travellingAs: spec.travellingAs,
      state: spec.state,
      origin: spec.origin,
      seatPriceIqd: dep.seatPriceIqd,
      frontPremiumIqd: spec.seatIds.includes('front') ? dep.frontPremiumIqd : 0,
      pickupFeeIqd: pickup.feeIqd,
      payment: null,
      prepaid: false,
      trusted: false,
      pin: this.uniquePin(bookings),
      pickup,
      largeBags: spec.largeBags,
      heldUntil: new Date(now.getTime() + this.rules.holdMin * MIN_MS),
      bookedAt: null,
      atGarageAt: null,
      checkedInAt: null,
      noShowAt: null,
      completedAt: null,
      cancelledAt: null,
      lateMinutes: null,
      demandPostId: spec.demandPostId ?? null,
      movedFromBookingId: null,
      movedToBookingId: null,
      createdAt: now,
    };
    await this.repo.saveBooking(b, tx);
    await this.emit(tx, 'seat.held', spec.riderId, dep, {
      bookingId: b.id,
      seatIds: b.seatIds,
      heldUntil: b.heldUntil,
      origin: b.origin,
      pickup: pickup.kind,
      travellingAs: b.travellingAs,
    });
    return b;
  }

  /** Garage (free), an on-the-way meeting point of this corridor (+fee), or the door (+fee by distance, driver accepts). */
  private resolvePickup(
    dep: DepartureRecord,
    bookings: readonly BookingRecord[],
    choice: PickupChoice,
  ): PickupRecord {
    const g = this.garage(dep.garageId);
    if (choice.kind === 'garage')
      return {
        kind: 'garage',
        meetingPointId: null,
        lat: g.lat,
        lng: g.lng,
        note: null,
        feeIqd: 0,
        status: 'accepted',
        detourMin: null,
      };
    if (choice.kind === 'meeting_point') {
      const mp = this.corridor(dep.corridorId).meetingPoints.find(
        (m) => m.id === choice.meetingPointId,
      );
      if (!mp) throw new DriverError('pickup_invalid');
      return {
        kind: 'meeting_point',
        meetingPointId: mp.id,
        lat: mp.lat,
        lng: mp.lng,
        note: null,
        feeIqd: mp.feeIqd,
        status: 'accepted',
        detourMin: null,
      };
    }
    const d = this.rules.door;
    const km = haversineMeters(choice, g) / 1000;
    if (km > d.maxKm) throw new DriverError('pickup_invalid');
    const detourMin = Math.ceil(((2 * km * d.roadFactor) / d.speedKmh) * 60);
    const load = this.doorLoad(bookings);
    if (load.count >= d.maxPerDeparture || load.detourMin + detourMin > d.maxDetourMin)
      throw new DriverError('door_pickup_limit');
    const feeIqd = roundUpTo(
      d.baseFeeIqd + Math.max(0, Math.ceil(km - d.freeKm)) * d.perKmIqd,
      500,
    );
    return {
      kind: 'door',
      meetingPointId: null,
      lat: choice.lat,
      lng: choice.lng,
      note: choice.note ?? null,
      feeIqd,
      status: 'pending',
      detourMin,
    };
  }

  /** One posting per seat; the pickup fee rides on the group's first seat (folded into the fare, 10 %). */
  private seatMoney(
    dep: DepartureRecord,
    b: BookingRecord,
    seatId: IntercitySeatId,
    first: boolean,
  ): Record<string, unknown> {
    return {
      seatId: `${b.id}.${seatId}`,
      departureId: dep.id,
      occurredAt: this.now(),
      customerId: b.riderId,
      payment: b.payment === 'wallet' ? 'wallet' : 'cash',
      driverId: dep.driverId,
      fareIqd: b.seatPriceIqd + (first ? b.pickupFeeIqd : 0),
      frontPremiumIqd: seatId === 'front' ? b.frontPremiumIqd : 0,
      walkUp: false,
    };
  }

  /** Review C-33: walk-up share > 60 % over the driver's last five departures flags a garage check. */
  private async checkWalkUpShare(tx: Tx, dep: DepartureRecord): Promise<void> {
    const n = this.rules.walkUpShareFlag.departures;
    const last = (
      await this.repo.listDepartures(
        { driverId: dep.driverId, states: ['departed', 'arrived', 'closed'] },
        tx,
      )
    )
      .sort((a, b) => (b.departedAt?.getTime() ?? 0) - (a.departedAt?.getTime() ?? 0))
      .slice(0, n);
    if (last.length < n) return;
    let walk = 0;
    let total = 0;
    for (const d of last) {
      const seated = (await this.repo.bookingsFor(d.id, tx))
        .filter((b) => ['checked_in', 'completed'].includes(b.state))
        .reduce((s, b) => s + b.seatIds.length, 0);
      walk += d.walkUps.length;
      total += d.walkUps.length + seated;
    }
    if (total > 0 && walk / total > this.rules.walkUpShareFlag.share)
      await this.emit(tx, 'intercity.walkup_share_flagged', 'system', dep, {
        driverId: dep.driverId,
        share: Math.round((walk / total) * 100) / 100,
        departures: last.map((d) => d.id),
      });
  }

  private async expireHold(
    tx: Tx,
    dep: DepartureRecord,
    b: BookingRecord,
    reason: 'lapsed' | 'departed',
  ): Promise<void> {
    b.state = 'expired';
    b.heldUntil = b.heldUntil ?? this.now();
    await this.repo.saveBooking(b, tx);
    await this.emit(tx, 'seat.hold_expired', 'system', dep, {
      bookingId: b.id,
      riderId: b.riderId,
      reason,
      demandPostId: b.demandPostId,
    });
    if (b.demandPostId) {
      const post = await this.repo.getDemand(b.demandPostId, tx);
      if (post && post.state === 'claimed') {
        post.state = 'lapsed';
        await this.repo.saveDemand(post, tx);
        await this.events.emit(
          tx,
          {
            type: 'demand.lapsed',
            actorId: 'system',
            occurredAt: this.now(),
            payload: { postId: post.id, bookingId: b.id, riderId: post.riderId },
          },
          { name: 'demand_post', id: post.id },
        );
      }
    }
  }

  /** The departure's bookings with lapsed holds expired first. */
  private async freshBookings(tx: Tx, dep: DepartureRecord): Promise<BookingRecord[]> {
    const bookings = await this.repo.bookingsFor(dep.id, tx);
    const now = this.now().getTime();
    for (const b of bookings)
      if (b.state === 'held' && b.heldUntil && b.heldUntil.getTime() <= now)
        await this.expireHold(tx, dep, b, 'lapsed');
    return bookings;
  }

  private uniquePin(bookings: readonly BookingRecord[]): string {
    const used = new Set(bookings.filter((b) => LIVE.includes(b.state)).map((b) => b.pin));
    for (let i = 0; i < 50; i += 1) {
      const p = this.ids.pin();
      if (!used.has(p)) return p;
    }
    throw new DriverError('internal');
  }

  private async ownBooking(riderId: string, bookingId: string, tx?: Tx): Promise<BookingRecord> {
    const b = await this.repo.getBooking(bookingId, tx);
    if (!b || b.riderId !== riderId) throw new DriverError('booking_not_found');
    return b;
  }

  private driverWrite<T>(
    driverId: string,
    departureId: string,
    fn: (tx: Tx, dep: DepartureRecord, bookings: BookingRecord[]) => Promise<T>,
  ): Promise<T> {
    return this.writer.run(async (tx) => {
      const dep = await this.departure(departureId, tx);
      if (dep.driverId !== driverId) throw new DriverError('not_departure_driver');
      const bookings = OPEN_DEPARTURE.includes(dep.state)
        ? await this.freshBookings(tx, dep)
        : await this.repo.bookingsFor(dep.id, tx);
      return fn(tx, dep, bookings);
    });
  }

  private requireState(dep: DepartureRecord, states: readonly DepartureRecord['state'][]): void {
    if (!states.includes(dep.state)) throw new DriverError('departure_state_conflict');
  }

  private async emit(
    tx: Tx,
    type: string,
    actorId: string,
    dep: DepartureRecord,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const wire = isDomainEventType(type)
      ? encodeDomainEvent(type, payload as never)
      : JSON.parse(JSON.stringify({ departureId: dep.id, ...payload }));
    await this.events.emit(
      tx,
      { type, actorId, occurredAt: this.now(), payload: wire },
      { name: 'departure', id: dep.id },
    );
  }
}

/** Runs inside a staff write, after the change (the audit row); returns the audit id. */
export type StaffAfter = (tx: Tx, dep: DepartureRecord) => Promise<string | null>;
export interface StaffWrite {
  dep: DepartureRecord;
  changed: boolean;
  auditId: string | null;
  /** M-11: what a cancel charged; null when nothing was (switch off, replay, arrive/close). */
  fee: DepartureNoShowFee | null;
}
export interface OverdueRecord {
  dep: DepartureRecord;
  reason: 'driver_no_show' | 'not_arrived';
  since: Date;
  minutes: number;
  riders: number;
  /** `driver_no_show` rows: what M-11 would charge if staff cancel now (whatever the switch). */
  fee: DepartureNoShowFee | null;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function combinations<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [head, ...rest] = xs;
  return [...combinations(rest, k - 1).map((c) => [head as T, ...c]), ...combinations(rest, k)];
}

/** The same seats, in any order. */
function sameSeats(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}
