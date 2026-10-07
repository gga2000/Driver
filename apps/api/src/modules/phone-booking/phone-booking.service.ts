import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  DriverError,
  orderTicketNumber,
  PHONE_BOOKING_SMS,
  type Actor,
  type BookByPhoneInput,
  type CancellationFee,
  type DeliveryPoint,
  type LatLng,
  type Order,
  type PhoneBookingCaller,
  type PhoneBookingCallerInput,
  type PhoneBookingOption,
  type PhoneBookingOrderInput,
  type PhoneBookingPlace,
  type PhoneBookingPort,
  type PhoneBookingQuote,
  type PhoneBookingQuoteInput,
  type PhoneBookingRow,
  type PhoneBookingsTodayInput,
  type PhoneBookingStatus,
  type PhoneBookingVertical,
  type Trip,
  type VehicleClass,
} from '@driver/contracts';
import { t } from '@driver/i18n';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { EventsService, type PublishedEvent } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { NotifyService } from '../notify/index.js';
import { OrdersService, payable } from '../orders/index.js';
import { PHONE_BOOKINGS_REPOSITORY, type PhoneBookingRecord, type PhoneBookingsRepository } from './phone-booking.repository.js';

export const PHONE_BOOKING_SOURCES = Symbol('PHONE_BOOKING_SOURCES');

/** A landmark the Console can book from or to (`places.landmarks`). */
export interface PhoneBookingLandmark {
  id: string;
  name_ar: string;
  pin: LatLng;
  zoneId: string;
}

/** The vehicle a driver is in, as the customer's courier card shows it. */
export interface PhoneBookingVehicle {
  vehicleClass: VehicleClass;
  plate: string;
  /** "تويوتا كورولا · أبيض"; null when the registry has no model/colour. */
  label: string | null;
}

/** What the phone bookings read from other modules (bound in `PhoneBookingModule`, faked in tests). */
export interface PhoneBookingSources {
  landmarks(cityId: string): Promise<PhoneBookingLandmark[]>;
  /** The zone's Arabic name at a pin (null outside every zone). */
  zoneName(cityId: string, pin: LatLng): string | null;
  /** The server's ride fare between two points now (`serverFees`, the same quote `orders.place` locks). */
  fare(q: { cityId: string; vertical: PhoneBookingVertical; pickup: DeliveryPoint; dropoff: DeliveryPoint; at: Date }): number;
  /** Learned town minutes between two points for this vehicle. */
  minutes(from: LatLng, to: LatLng, vehicle: VehicleClass, at: Date): Promise<number | null>;
  /** The trip that carries the ride and its driver (null while nobody has taken it). */
  ride(orderId: string): Promise<{ trip: Trip; driverId: string } | null>;
  vehicle(driverId: string, vehicleId: string | null): Promise<PhoneBookingVehicle | null>;
  /** Where the driver is now: the trip's last trail point, else his online position. */
  driverPin(tripId: string, driverId: string): Promise<LatLng | null>;
  /** The live trip page for the caller (`https://driver.iq/share/…`), made for the caller as his own «شارك». */
  shareLink(personId: string, orderId: string): Promise<string | null>;
}

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;
/** Baghdad is UTC+3 all year: "today" for the Console list. */
const BAGHDAD_OFFSET_MS = 3 * 60 * MIN_MS;
/** Caller names, number hints and driver first names per staff reader: one logged vault read per 10 minutes, not per poll. */
const NAME_TTL_MS = 10 * MIN_MS;
const SMS_LOCALE = 'ar-IQ' as const;
const VEHICLE_CLASS: Record<PhoneBookingVertical, VehicleClass> = { taxi: 'car', tuktuk: 'tuktuk' };
const VEHICLE_AR: Record<PhoneBookingVertical, string> = { taxi: 'تكسي', tuktuk: 'تكتك' };
const CANCELLED: ReadonlySet<Order['state']> = new Set(['customer_cancelled', 'platform_cancelled', 'merchant_rejected', 'refunded', 'failed']);
const DONE: ReadonlySet<Order['state']> = new Set(['completed', 'closed', 'delivered']);
const CANCELLABLE: ReadonlySet<PhoneBookingStatus> = new Set(['searching', 'driver_coming', 'driver_arrived']);

/** Baghdad midnight before `now`, and the next one. */
export function baghdadDay(now: Date): { from: Date; to: Date } {
  const local = now.getTime() + BAGHDAD_OFFSET_MS;
  const from = Math.floor(local / DAY_MS) * DAY_MS - BAGHDAD_OFFSET_MS;
  return { from: new Date(from), to: new Date(from + DAY_MS) };
}

/** Where a phone-booked ride stands, from its order and (once taken) its trip. */
export function phoneBookingStatus(order: Pick<Order, 'state'>, trip: Pick<Trip, 'state'> | null): PhoneBookingStatus {
  if (CANCELLED.has(order.state)) return 'cancelled';
  if (DONE.has(order.state)) return 'done';
  if (order.state === 'picked_up') return 'on_trip';
  if (order.state !== 'matched' || !trip) return 'searching';
  switch (trip.state) {
    case 'arrived_pickup':
      return 'driver_arrived';
    case 'in_transit':
    case 'arrived_dropoff':
      return 'on_trip';
    case 'completed':
      return 'done';
    default:
      return 'driver_coming';
  }
}

function statusSince(status: PhoneBookingStatus, order: Order, trip: Trip | null): Date {
  const pickup = trip?.stops.find((s) => s.orderId === order.id && s.type === 'pickup') ?? null;
  switch (status) {
    case 'cancelled':
      return order.cancelledAt ?? trip?.cancelledAt ?? order.placedAt;
    case 'done':
      return order.closedAt ?? order.deliveredAt ?? trip?.completedAt ?? order.placedAt;
    case 'on_trip':
      return order.pickedUpAt ?? pickup?.completedAt ?? pickup?.arrivedAt ?? trip?.acceptedAt ?? order.placedAt;
    case 'driver_arrived':
      return pickup?.arrivedAt ?? trip?.acceptedAt ?? order.placedAt;
    case 'driver_coming':
      return trip?.acceptedAt ?? order.placedAt;
    default:
      return order.placedAt;
  }
}

/**
 * «حجز بالتلفون» (taxi/tuktuk step 4, idea v4). Someone without the app calls; support books the
 * ride from the Console on their number. The number becomes (or already is) a person in the vault —
 * with the name heard on the phone when the vault has none — and the ride is that person's ordinary
 * cash ride through `orders.place`: the same server quote (`price_changed` when it moved), dispatch,
 * cancellation rules and history. If the caller signs in later with that number, the rides are in
 * his «طلباتي». Every booking and cancel writes a Console audit row under the staff member.
 *
 * The outbox subscriber `phone-booking:sms` texts the caller when a driver takes the ride (first
 * name, car and plate, minutes away, the live trip link) and when the driver is at the pickup
 * (first name, car, the cash fare). The app's own push still goes out as for any ride.
 */
@Injectable()
export class PhoneBookingService implements PhoneBookingPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhoneBookingService.name);
  private readonly offs: Array<() => void> = [];
  private readonly names = new Map<string, { value: string | null; at: number }>();

  constructor(
    @Inject(PHONE_BOOKINGS_REPOSITORY) private readonly repo: PhoneBookingsRepository,
    @Inject(PHONE_BOOKING_SOURCES) private readonly sources: PhoneBookingSources,
    private readonly identity: IdentityService,
    private readonly orders: OrdersService,
    private readonly notify: NotifyService,
    private readonly events: EventsService,
    private readonly audits: AuditLogService,
    private readonly staff: StaffNames,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.offs.push(this.events.subscribe('phone-booking:sms', ['order.matched', 'stop.arrived'], (e, ctx) => this.sms(e, ctx.tx)));
  }

  onModuleDestroy(): void {
    for (const off of this.offs.splice(0)) off();
  }

  // ───────────────────────── the Console ─────────────────────────

  async caller(actor: Actor, input: z.output<typeof PhoneBookingCallerInput>): Promise<PhoneBookingCaller> {
    const personId = await this.identity.personIdByPhone(input.phone);
    if (!personId) return { known: false, name: null, phoneRides: 0 };
    const names = await this.identity.displayNamesFor([personId], actor.personId, 'phone_booking_caller');
    return { known: true, name: names[personId]?.displayName ?? null, phoneRides: await this.repo.countForPerson(personId, this.clock.now()) };
  }

  async quote(_actor: Actor, input: z.output<typeof PhoneBookingQuoteInput>): Promise<PhoneBookingQuote> {
    const now = this.clock.now();
    const { pickup, dropoff } = await this.places(input.cityId, input.pickupId, input.dropoffId);
    const options: PhoneBookingOption[] = [];
    let refusal: unknown = null;
    for (const vertical of ['taxi', 'tuktuk'] as const) {
      try {
        const fareIqd = this.sources.fare({ cityId: input.cityId, vertical, pickup: pointOf(pickup), dropoff: pointOf(dropoff), at: now });
        const rideMin = (await this.sources.minutes(pickup.pin, dropoff.pin, VEHICLE_CLASS[vertical], now)) ?? 0;
        options.push({ vertical, fareIqd, totalIqd: payable('ride', 'cash', fareIqd).totalIqd, rideMin });
      } catch (err) {
        // A vehicle the city does not price for these zones is left out; the other is still offered.
        refusal ??= err;
      }
    }
    if (options.length === 0) throw refusal;
    return { pickup: this.placeView(input.cityId, pickup), dropoff: this.placeView(input.cityId, dropoff), options, quotedAt: now };
  }

  async book(actor: Actor, input: z.output<typeof BookByPhoneInput>): Promise<PhoneBookingRow> {
    const { pickup, dropoff } = await this.places(input.cityId, input.pickupId, input.dropoffId);
    // The number is the caller's account: found, or created pseudonymously in the vault (the name
    // heard on the phone fills an empty vault name only).
    const personId = await this.identity.ensurePersonByPhone(input.phone, actor.personId, 'phone_booking', { name: input.name });
    const note = input.note?.trim();
    // An ordinary cash ride of that person: same quote check, dispatch and rules as the app's. The
    // retry key makes a double click (or a retry after a timeout) the same ride.
    const order = await this.orders.place(personId, {
      cityId: input.cityId,
      type: 'ride',
      rideVertical: input.vertical,
      fareIqd: input.fareIqd,
      options: { doorPickup: false },
      paymentMethod: 'cash',
      pickup: pointOf(pickup),
      dropoff: pointOf(dropoff),
      ...(note ? { note } : {}),
      clientRequestId: input.clientRequestId,
    });
    const rec = await this.uow.run(async (tx) => {
      const existing = await this.repo.byOrder(order.id, tx);
      if (existing) return existing;
      const added = await this.repo.add(
        {
          orderId: order.id,
          cityId: input.cityId,
          personId,
          bookedBy: actor.personId,
          vertical: input.vertical,
          pickupId: pickup.id,
          pickupName: pickup.name_ar,
          dropoffId: dropoff.id,
          dropoffName: dropoff.name_ar,
          createdAt: order.placedAt,
        },
        tx,
      );
      await this.audits.record(
        {
          cityId: input.cityId,
          actorId: actor.personId,
          action: 'ride.phone_booked',
          subjectKind: 'order',
          subjectId: order.id,
          summaryAr: `حجز ${VEHICLE_AR[input.vertical]} بالتلفون من ${pickup.name_ar} لـ${dropoff.name_ar} (#${orderTicketNumber(order.id)})`,
          detail: { vertical: input.vertical, pickupId: pickup.id, dropoffId: dropoff.id, totalIqd: order.totalIqd },
        },
        tx,
      );
      return added;
    });
    return (await this.rows(actor, [rec]))[0]!;
  }

  async today(actor: Actor, input: z.output<typeof PhoneBookingsTodayInput>): Promise<PhoneBookingRow[]> {
    const { from, to } = baghdadDay(this.clock.now());
    return this.rows(actor, await this.repo.inCity(input.cityId, from, to));
  }

  async cancelPreview(_actor: Actor, input: z.output<typeof PhoneBookingOrderInput>): Promise<CancellationFee> {
    await this.booking(input.orderId);
    return this.orders.cancellationPreview(input.orderId);
  }

  async cancel(actor: Actor, input: z.output<typeof PhoneBookingOrderInput>): Promise<PhoneBookingRow> {
    const rec = await this.booking(input.orderId);
    await this.uow.run(async (tx) => {
      const before = await this.orders.get(rec.orderId);
      if (before.state === 'customer_cancelled') return;
      // The caller asked on the phone: the customer's own cancel, with the app's fee rules.
      const order = await this.orders.cancel(rec.personId, { orderId: rec.orderId, reason: 'customer_request' });
      await this.audits.record(
        {
          cityId: rec.cityId,
          actorId: actor.personId,
          action: 'ride.phone_cancelled',
          subjectKind: 'order',
          subjectId: rec.orderId,
          summaryAr: `ألغى حجز التلفون #${orderTicketNumber(rec.orderId)} بطلب المتصل${order.cancellationFeeIqd > 0 ? ` (رسوم ${iqd(order.cancellationFeeIqd)} دينار)` : ''}`,
          detail: { feeIqd: order.cancellationFeeIqd },
        },
        tx,
      );
    });
    return (await this.rows(actor, [rec]))[0]!;
  }

  // ───────────────────────── the caller's SMS ─────────────────────────

  /** `order.matched` → who is coming, in what, how far, the link; `stop.arrived` at the pickup → he is there. */
  private async sms(e: PublishedEvent, tx: Tx): Promise<void> {
    if (!e.orderId) return;
    if (e.type === 'stop.arrived' && e.payload['stopType'] !== 'pickup') return;
    const rec = await this.repo.byOrder(e.orderId, tx);
    if (!rec) return;
    const order = await this.orders.get(rec.orderId);
    if (CANCELLED.has(order.state)) return;
    const ride = await this.sources.ride(rec.orderId);
    const driverId = (typeof e.payload['driverId'] === 'string' ? e.payload['driverId'] : null) ?? ride?.driverId ?? e.actorId;
    const trip = ride?.trip ?? null;
    const [first, vehicle] = await Promise.all([
      this.identity.firstNamesFor([driverId], 'system:notify', 'phone_booking_sms').catch(() => ({}) as Record<string, string | null>),
      this.sources.vehicle(driverId, trip?.vehicleId ?? null),
    ]);
    const params = { driver: first[driverId] ?? t('sms.phone_driver', {}, SMS_LOCALE), car: carText(rec.vertical, vehicle) };
    const base = { eventId: e.id, to: rec.personId, orderId: rec.orderId, data: { orderId: rec.orderId } };
    if (e.type === 'stop.arrived') {
      await this.notify.dispatch({ ...base, template: PHONE_BOOKING_SMS.arrived, params: { ...params, amount: iqd(order.totalIqd) } }, tx);
      return;
    }
    const minutes = trip ? await this.minutesAway(rec, trip, driverId) : null;
    const eta = minutes ? t('sms.phone_eta', { minutes }, SMS_LOCALE) : t('sms.phone_eta_soon', {}, SMS_LOCALE);
    const link = await this.sources.shareLink(rec.personId, rec.orderId);
    await this.notify.dispatch(
      {
        ...base,
        template: PHONE_BOOKING_SMS.matched,
        params: { ...params, eta, link: link ?? '' },
        // No link (the page could not be made): the same message without «تابعه».
        ...(link ? {} : { content: { title: '', body: t('sms.phone_ride_matched_nolink', { ...params, eta }, SMS_LOCALE) } }),
      },
      tx,
    );
  }

  private async minutesAway(rec: PhoneBookingRecord, trip: Trip, driverId: string): Promise<number | null> {
    try {
      const from = await this.sources.driverPin(trip.id, driverId);
      const to = trip.stops.find((s) => s.orderId === rec.orderId && s.type === 'pickup')?.target ?? null;
      if (!from || !to) return null;
      return await this.sources.minutes(from, to, VEHICLE_CLASS[rec.vertical], this.clock.now());
    } catch (err) {
      this.logger.warn(`minutes away for ${rec.orderId}: ${(err as Error).message}`);
      return null;
    }
  }

  // ───────────────────────── helpers ─────────────────────────

  private async booking(orderId: string): Promise<PhoneBookingRecord> {
    const rec = await this.repo.byOrder(orderId);
    if (!rec) throw new DriverError('phone_booking_not_found');
    return rec;
  }

  private async places(cityId: string, pickupId: string, dropoffId: string): Promise<{ pickup: PhoneBookingLandmark; dropoff: PhoneBookingLandmark }> {
    const all = await this.sources.landmarks(cityId);
    const pickup = all.find((l) => l.id === pickupId);
    const dropoff = all.find((l) => l.id === dropoffId);
    if (!pickup || !dropoff) throw new DriverError('phone_booking_place_unknown');
    return { pickup, dropoff };
  }

  private placeView(cityId: string, l: PhoneBookingLandmark): PhoneBookingPlace {
    return { id: l.id, name_ar: l.name_ar, zoneId: l.zoneId, zoneName_ar: this.sources.zoneName(cityId, l.pin) ?? '' };
  }

  /** Vault reads for the list, cached per staff reader for ten minutes (each fresh read is logged). */
  private async cached(kind: string, reader: string, ids: readonly string[], read: (missing: string[]) => Promise<Record<string, string | null>>): Promise<Record<string, string | null>> {
    const now = this.clock.now().getTime();
    const out: Record<string, string | null> = {};
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      const hit = this.names.get(`${kind}:${reader}:${id}`);
      if (hit && now - hit.at < NAME_TTL_MS) out[id] = hit.value;
      else missing.push(id);
    }
    if (missing.length > 0) {
      const fresh = await read(missing);
      for (const id of missing) {
        const value = fresh[id] ?? null;
        this.names.set(`${kind}:${reader}:${id}`, { value, at: now });
        out[id] = value;
      }
    }
    return out;
  }

  private async rows(actor: Actor, recs: readonly PhoneBookingRecord[]): Promise<PhoneBookingRow[]> {
    if (recs.length === 0) return [];
    const reader = actor.personId;
    const orders = await Promise.all(recs.map((r) => this.orders.get(r.orderId)));
    const rides = await Promise.all(recs.map((r, i) => (orders[i]!.state === 'placed' ? null : this.sources.ride(r.orderId))));
    const people = recs.map((r) => r.personId);
    const drivers = rides.flatMap((r) => (r ? [r.driverId] : []));
    const [callers, hints, bookers, driverNames, vehicles] = await Promise.all([
      this.cached('name', reader, people, async (ids) => {
        const got = await this.identity.displayNamesFor(ids, reader, 'phone_booking_list');
        return Object.fromEntries(Object.entries(got).map(([id, v]) => [id, v.displayName]));
      }),
      this.cached('hint', reader, people, (ids) => this.identity.invitePhoneHints(ids, reader, 'phone_booking_list')),
      this.staff.of(recs.map((r) => r.bookedBy)),
      this.cached('driver', reader, drivers, (ids) => this.identity.firstNamesFor(ids, reader, 'phone_booking_list')),
      Promise.all(rides.map((r) => (r ? this.sources.vehicle(r.driverId, r.trip.vehicleId) : null))),
    ]);
    return recs.map((rec, i) => {
      const order = orders[i]!;
      const ride = rides[i] ?? null;
      const status = phoneBookingStatus(order, ride?.trip ?? null);
      const vehicle = vehicles[i] ?? null;
      return {
        orderId: rec.orderId,
        ticket: `#${orderTicketNumber(rec.orderId)}`,
        placedAt: order.placedAt,
        callerName: callers[rec.personId] ?? null,
        phoneHint: hints[rec.personId] ?? '',
        vertical: rec.vertical,
        pickupName: rec.pickupName,
        dropoffName: rec.dropoffName,
        totalIqd: order.totalIqd,
        status,
        since: statusSince(status, order, ride?.trip ?? null),
        driver: ride && status !== 'searching' ? { firstName: driverNames[ride.driverId] ?? null, vehicleLabel: vehicle?.label ?? null, plate: vehicle?.plate ?? null } : null,
        bookedByName: bookers[rec.bookedBy] ?? null,
        cancellable: CANCELLABLE.has(status),
        note: order.note ?? null,
      };
    });
  }
}

function pointOf(l: PhoneBookingLandmark): DeliveryPoint {
  return { zoneKey: l.zoneId, pin: l.pin };
}

/** "تويوتا كورولا · أبيض، لوحة 12345 واسط", or just "تكسي" when the registry has nothing. */
export function carText(vertical: PhoneBookingVertical, vehicle: PhoneBookingVehicle | null): string {
  const kind = t(vertical === 'tuktuk' ? 'sms.phone_vehicle_tuktuk' : 'sms.phone_vehicle_taxi', {}, SMS_LOCALE);
  if (!vehicle?.plate) return vehicle?.label ?? kind;
  return t('sms.phone_car', { vehicle: vehicle.label ?? kind, plate: vehicle.plate }, SMS_LOCALE);
}

/** "4,500" (Western digits, thousands comma) as every other message writes an amount. */
function iqd(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
