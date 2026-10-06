import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AZIZIYAH_MONEY_RULES,
  AT_RISK_RULES,
  DriverError,
  latePromiseCreditIqd,
  MIN_PER_EARLIER_DROP,
  positionVisible,
  type Actor,
  type CourierCard,
  type CourierPosition,
  type DeliveryPoint,
  type EtaBasis,
  type LatePromise,
  type LatLng,
  ORDER_HISTORY_LIMIT,
  type Order,
  type OrderHistoryRow,
  type OrderRoute,
  type OrderTracking,
  type TrackingPort,
  type TrackItem,
  type TrackStop,
  type Trip,
  type VehicleClass,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { EtaService, type EtaMinutes } from '../routing/index.js';
import { COURIER_VEHICLES, type CourierVehicleDirectory } from './vehicles.js';

/**
 * The slices of other modules' public services the customer's live screen reads. Typed narrowly so
 * the service can be tested with plain fakes and so it is obvious what it can see: it owns no tables.
 */
export interface TrackingOrdersPort {
  aggregate(orderId: string): Promise<{
    order: { id: string; ordererId: string; type: Order['type']; merchantOrgId: string | null; dropoff: DeliveryPoint | null; promisedReadyAt: Date | null; minVehicleClass: VehicleClass | null };
    lines: Array<{ id: string; catalogItemId: string | null; freeText: string | null; qty: number; unitPriceIqd: number; modifiers: Array<{ priceIqd?: number } & Record<string, unknown>>; participantId: string | null; note: string | null; substitution: { state: string } | null }>;
    participants: Array<{ personId: string | null }>;
  }>;
  get(orderId: string): Promise<Order>;
  /** The person's own orders (orderer), any state. */
  listForPerson(personId: string): Promise<Order[]>;
  /** The city's live orders (Console at-risk list). Optional for fakes. */
  listActive?(filter: { cityId?: string | undefined }): Promise<Order[]>;
}
export interface TrackingTripsPort {
  activeForOrder(orderId: string): Promise<Trip | null>;
  courierOf(orderId: string): Promise<{ tripId: string; courierId: string } | null>;
  get(tripId: string): Promise<Trip>;
  orderHistory(orderId: string): Promise<Array<{ tripId: string; detachedAt: Date | null; reason: string | null }>>;
  lastPosition(tripId: string): Promise<{ at: Date; pin: LatLng; bearing: number | null; speedKmh: number | null; driverId: string } | null>;
}
export interface TrackingIdentityPort {
  courierCard(courierId: string, accessorId: string): Promise<{ firstName: string | null; lastVerifiedAt: Date | null }>;
}
export interface TrackingMerchantsPort {
  /** Name and pickup pin of a merchant org; null when unknown. */
  merchant(orgId: string): Promise<{ name: string; pin: LatLng | null } | null> | { name: string; pin: LatLng | null } | null;
  itemNames(orgId: string, itemIds: readonly string[]): Promise<Map<string, string>>;
}
export interface TrackingPointsPort {
  /** Points this person earned on this order (earned + organizer bonus); 0 when none posted. */
  earnedOn(personId: string, orderId: string): Promise<number>;
}

/**
 * The honest-delay credit's ledger side (audit d-5): what was posted for an order, and posting it
 * once (idempotent by order, platform-funded `credit_issued` to the customer's wallet).
 */
export interface TrackingLateCreditPort {
  issued(orderId: string): Promise<{ amountIqd: number; at: Date } | null>;
  issue(c: { orderId: string; customerId: string; amountIqd: number; at: Date }, tx?: Tx): Promise<void>;
}

export const TRACKING_LATE_CREDIT = Symbol('TRACKING_LATE_CREDIT');
export const TRACKING_ORDERS = Symbol('TRACKING_ORDERS');
export const TRACKING_TRIPS = Symbol('TRACKING_TRIPS');
export const TRACKING_IDENTITY = Symbol('TRACKING_IDENTITY');
export const TRACKING_MERCHANTS = Symbol('TRACKING_MERCHANTS');
export const TRACKING_POINTS = Symbol('TRACKING_POINTS');

/** Asia/Baghdad is UTC+3 all year (no DST). */
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

export function sameBaghdadDay(a: Date, b: Date): boolean {
  const day = (d: Date) => Math.floor((d.getTime() + BAGHDAD_OFFSET_MS) / 86_400_000);
  return day(a) === day(b);
}

/** Orders whose courier is no longer coming to this customer (nothing left to track live). */
const SETTLED_ORDER_STATES: ReadonlySet<Order['state']> = new Set([
  'delivered',
  'completed',
  'closed',
  'merchant_rejected',
  'customer_cancelled',
  'platform_cancelled',
  'refunded',
  'disputed',
  'failed',
]);

/** Courier cards are cached per trip and reader so a polling screen logs one vault read per trip, not one per poll. */
const CARD_CACHE_MAX = 2000;

/** At-risk predictions kept at most (one per live order). */
const RISK_CACHE_MAX = 2_000;

/**
 * Customer live order/ride screen reads (customer app spec §4). Only the orderer or a participant
 * of the order may read it. The courier is shown by first name, vehicle, plate and "verified today";
 * his position only between accept and complete, and never after this customer's own drop-off.
 */
@Injectable()
export class TrackingService implements TrackingPort {
  private readonly cards = new Map<string, { firstName: string | null; lastVerifiedAt: Date | null }>();

  constructor(
    @Inject(TRACKING_ORDERS) private readonly orders: TrackingOrdersPort,
    @Inject(TRACKING_TRIPS) private readonly trips: TrackingTripsPort,
    @Inject(TRACKING_IDENTITY) private readonly identity: TrackingIdentityPort,
    @Inject(TRACKING_MERCHANTS) private readonly merchants: TrackingMerchantsPort,
    @Inject(TRACKING_POINTS) private readonly points: TrackingPointsPort,
    @Inject(COURIER_VEHICLES) private readonly vehicles: CourierVehicleDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly eta: EtaService,
    @Optional() @Inject(TRACKING_LATE_CREDIT) private readonly lateCredit: TrackingLateCreditPort | null = null,
  ) {}

  /** Minutes past the promised time after which the delivery fee comes back (`MoneyRules.latePromise`). */
  private readonly latePromiseAfterMin = AZIZIYAH_MONEY_RULES.latePromise.afterMin;
  /** The at-risk predictions, by order (`AT_RISK_RULES.cacheMs`). */
  private readonly risks = new Map<string, { at: number; risk: { orderId: string; predictedAt: Date; promisedAt: Date; lateByMin: number } | null }>();

  async track(actor: Actor, input: { orderId: string }): Promise<OrderTracking> {
    const agg = await this.assertOwner(actor, input.orderId);
    const order = await this.orders.get(input.orderId);
    const now = this.clock.now();

    const trip = await this.currentTrip(order.id);
    const history = await this.trips.orderHistory(order.id);
    const working = Boolean(trip?.courierId && positionVisible(trip.state));
    const lostCourier = history.some((l) => l.detachedAt !== null) || trip?.state === 'driver_cancelled';
    const reassigning = !SETTLED_ORDER_STATES.has(order.state) && lostCourier && !working;

    const merchant = agg.order.merchantOrgId ? await this.merchants.merchant(agg.order.merchantOrgId) : null;
    const items = await this.items(agg);
    const courier = trip?.courierId && (working || trip.state === 'completed') ? await this.courierCard(trip, actor.personId, now) : null;

    const promisedAt = await this.promise(agg.order, merchant?.pin ?? null, order.acceptedAt);
    return {
      order,
      items,
      merchant: merchant && agg.order.merchantOrgId ? { id: agg.order.merchantOrgId, name: merchant.name, pin: merchant.pin } : null,
      dropoff: agg.order.dropoff,
      trip: trip && !(reassigning && trip.state === 'driver_cancelled') ? this.tripView(trip, order.id) : null,
      courier,
      reassigning,
      promisedAt,
      latePromise: await this.latePromise(order, trip, promisedAt, now),
      pointsEarned: order.state === 'closed' ? await this.points.earnedOn(actor.personId, order.id) : null,
      serverNow: now,
    };
  }

  async courierPosition(actor: Actor, input: { orderId: string }): Promise<CourierPosition | null> {
    await this.assertOwner(actor, input.orderId);
    const order = await this.orders.get(input.orderId);
    if (SETTLED_ORDER_STATES.has(order.state)) return null;
    const trip = await this.trips.activeForOrder(order.id);
    if (!trip?.courierId || !positionVisible(trip.state) || !trip.acceptedAt) return null;
    // Batched courier: once my own drop-off is done his further route is none of my business.
    const myDrop = trip.stops.find((s) => s.orderId === order.id && s.type === 'dropoff');
    if (myDrop && (myDrop.state === 'completed' || myDrop.state === 'skipped')) return null;
    // Trail points carry the trip only once he holds it (trips checks the courier on report), so the
    // trip's last point is his; its device time may be old (queued offline) — the age says so.
    const p = await this.trips.lastPosition(trip.id);
    if (!p || p.driverId !== trip.courierId) return null;
    const now = this.clock.now();
    const ageSec = Math.max(0, Math.round((now.getTime() - p.at.getTime()) / 1000));
    const eta = await this.liveEta(order, trip, p.pin, now);
    return { tripId: trip.id, pin: p.pin, bearing: p.bearing, speedKmh: p.speedKmh, at: p.at, ageSec, etaAt: eta?.at ?? null, etaBasis: eta?.basis ?? null };
  }

  /**
   * The road still ahead for this customer (maps program SP5a): from the courier's fix (sharing window)
   * — or the kitchen before anyone has the order — through this order's remaining stops. Null polyline
   * when there is no road router or fewer than two points.
   */
  async route(actor: Actor, input: { orderId: string }): Promise<OrderRoute> {
    const agg = await this.assertOwner(actor, input.orderId);
    const order = await this.orders.get(input.orderId);
    const now = this.clock.now();
    const none: OrderRoute = { polyline6: null, basis: 'estimated', from: null, computedAt: now };
    if (SETTLED_ORDER_STATES.has(order.state)) return none;
    const trip = await this.trips.activeForOrder(order.id);
    const fix = trip?.courierId && positionVisible(trip.state) && trip.acceptedAt ? await this.trips.lastPosition(trip.id) : null;
    const courier = fix && fix.driverId === trip?.courierId ? fix.pin : null;
    const mine = (trip?.stops ?? []).filter((s) => s.orderId === order.id && s.target && s.state !== 'completed' && s.state !== 'skipped');
    const kitchenOrg = agg.order.merchantOrgId ? await this.merchants.merchant(agg.order.merchantOrgId) : null;
    const door = agg.order.dropoff?.pin ?? null;
    let ahead: LatLng[];
    if (mine.length > 0) ahead = mine.map((s) => s.target!);
    else if (order.type !== 'ride' && !order.pickedUpAt && kitchenOrg?.pin && door) ahead = [kitchenOrg.pin, door];
    else ahead = door ? [door] : [];
    const points = courier ? [courier, ...ahead] : ahead;
    if (points.length < 2) return none;
    const r = await this.eta.path(points);
    return { polyline6: r.polyline6, basis: r.basis, from: points[0]!, computedAt: now };
  }

  /**
   * When the courier at `pin` reaches this customer's next step — the one ETA every screen shows (maps
   * program SP4b). Ride: to the pickup, then to the drop-off. Delivery: to the kitchen, waiting for the
   * food if it isn't ready, then to the door, plus a few minutes per batched drop before this one.
   * Used by `courierPosition` and the live channel's position events.
   */
  async liveEta(order: Order, trip: Trip, pin: LatLng, now: Date): Promise<{ at: Date; basis: EtaBasis } | null> {
    const agg = await this.orders.aggregate(order.id);
    const stop = (type: 'pickup' | 'dropoff'): LatLng | null => trip.stops.find((s) => s.orderId === order.id && (s.type === type || (type === 'pickup' && s.type === 'shop')))?.target ?? null;
    const vehicle: VehicleClass = (trip.courierId ? (await this.vehicles.forCourier(trip.courierId, trip.vehicleId ?? null))?.vehicleClass : undefined) ?? order.minVehicleClass ?? (order.type === 'ride' ? 'car' : 'bike');
    const legs: EtaMinutes[] = [];
    const leg = async (a: LatLng, b: LatLng): Promise<number> => {
      const m = await this.eta.minutes(a, b, vehicle);
      legs.push(m);
      return m.minutes;
    };
    const done = (atMs: number) => ({ at: new Date(atMs), basis: legs.every((l) => l.basis === 'road') ? ('road' as const) : ('estimated' as const) });
    const MIN = 60_000;

    if (order.type === 'ride') {
      if (trip.state === 'completed') return null;
      if (trip.state === 'arrived_pickup') return done(now.getTime());
      const target = trip.state === 'in_transit' || trip.state === 'arrived_dropoff' ? stop('dropoff') : stop('pickup');
      return target ? done(now.getTime() + (await leg(pin, target)) * MIN) : null;
    }
    if (order.state === 'delivered' || order.state === 'closed' || order.deliveredAt) return null;
    const door = agg.order.dropoff?.pin ?? stop('dropoff');
    if (!door) return null;
    const kitchenOrg = agg.order.merchantOrgId ? await this.merchants.merchant(agg.order.merchantOrgId) : null;
    const kitchen = kitchenOrg?.pin ?? stop('pickup');
    const extra = (this.tripView(trip, order.id)?.dropsBeforeMine ?? 0) * MIN_PER_EARLIER_DROP;
    if (order.pickedUpAt || order.state === 'picked_up') return done(now.getTime() + ((await leg(pin, door)) + extra) * MIN);
    if (!kitchen) return null;
    const atKitchen = now.getTime() + (await leg(pin, kitchen)) * MIN;
    const ready = (order.readyAt ?? order.promisedReadyAt)?.getTime() ?? now.getTime();
    return done(Math.max(atKitchen, ready, now.getTime()) + ((await leg(kitchen, door)) + extra) * MIN);
  }

  /**
   * Audit d-5, the honest-delay promise: past the promised time + `afterMin` (still on the way, or
   * delivered after it) the delivery fee comes back as wallet credit, once — posted here when the
   * customer is watching, and at delivery by the `order.delivered` subscriber otherwise. No credit on a
   * cancelled order, without a delivery fee, or while the customer is the one not answering.
   */
  private async latePromise(order: Order, trip: Trip | null, promisedAt: Date | null, now: Date, tx?: Tx): Promise<LatePromise | null> {
    if (!this.lateCredit || !promisedAt) return null;
    const creditIqd = latePromiseCreditIqd(order);
    if (creditIqd <= 0) return null;
    const deadlineAt = new Date(promisedAt.getTime() + this.latePromiseAfterMin * 60_000);
    let credit = await this.lateCredit.issued(order.id);
    const doorAt = order.deliveredAt ?? (SETTLED_ORDER_STATES.has(order.state) ? null : now);
    const customerUnreachable = Boolean(trip?.unreachable);
    if (!credit && doorAt && doorAt.getTime() > deadlineAt.getTime() && !customerUnreachable) {
      await this.lateCredit.issue({ orderId: order.id, customerId: order.ordererId, amountIqd: creditIqd, at: now }, tx);
      credit = (await this.lateCredit.issued(order.id)) ?? { amountIqd: creditIqd, at: now };
    }
    return { afterMin: this.latePromiseAfterMin, creditIqd, deadlineAt, credit };
  }

  /** The `order.delivered` subscriber: a delivery that came past the promise gets its credit even if nobody watched. */
  async settleLatePromise(orderId: string, tx?: Tx): Promise<void> {
    if (!this.lateCredit) return;
    const agg = await this.orders.aggregate(orderId);
    const order = await this.orders.get(orderId);
    if (!order.deliveredAt) return;
    const merchant = agg.order.merchantOrgId ? await this.merchants.merchant(agg.order.merchantOrgId) : null;
    const promisedAt = await this.promise(agg.order, merchant?.pin ?? null, order.acceptedAt);
    await this.latePromise(order, await this.currentTrip(order.id), promisedAt, this.clock.now(), tx);
  }

  /**
   * Late before it's late (maps program o4): the city's live deliveries whose one ETA lands more than
   * `AT_RISK_RULES.marginMin` after what the customer was promised — worst first. One prediction per
   * order is reused for `cacheMs` (every Console tab polls this).
   */
  async atRisk(cityId: string): Promise<Array<{ orderId: string; predictedAt: Date; promisedAt: Date; lateByMin: number }>> {
    if (!this.orders.listActive) return [];
    const now = this.clock.now();
    const out: Array<{ orderId: string; predictedAt: Date; promisedAt: Date; lateByMin: number }> = [];
    for (const order of await this.orders.listActive({ cityId })) {
      if (order.type === 'ride') continue;
      const hit = this.risks.get(order.id);
      let risk = hit && now.getTime() - hit.at < AT_RISK_RULES.cacheMs ? hit.risk : undefined;
      if (risk === undefined) {
        risk = await this.riskOf(order, now).catch(() => null);
        if (this.risks.size >= RISK_CACHE_MAX) this.risks.delete(this.risks.keys().next().value!);
        this.risks.set(order.id, { at: now.getTime(), risk });
      }
      if (risk) out.push(risk);
    }
    return out.sort((a, b) => b.lateByMin - a.lateByMin);
  }

  private async riskOf(order: Order, now: Date): Promise<{ orderId: string; predictedAt: Date; promisedAt: Date; lateByMin: number } | null> {
    if (SETTLED_ORDER_STATES.has(order.state) || order.deliveredAt) return null;
    const trip = await this.trips.activeForOrder(order.id);
    if (!trip?.courierId || !positionVisible(trip.state)) return null;
    const fix = await this.trips.lastPosition(trip.id);
    if (!fix || fix.driverId !== trip.courierId) return null;
    const eta = await this.liveEta(order, trip, fix.pin, now);
    if (!eta) return null;
    const agg = await this.orders.aggregate(order.id);
    const merchant = agg.order.merchantOrgId ? await this.merchants.merchant(agg.order.merchantOrgId) : null;
    const promised = await this.promise(agg.order, merchant?.pin ?? null, order.acceptedAt);
    if (!promised) return null;
    const lateByMin = Math.ceil((eta.at.getTime() - promised.getTime()) / 60_000);
    return lateByMin > AT_RISK_RULES.marginMin ? { orderId: order.id, predictedAt: eta.at, promisedAt: promised, lateByMin } : null;
  }

  /** The promised arrival: the kitchen's promised ready time plus the kitchen → door ride. */
  private async promise(order: Parameters<typeof promisedArrival>[0], kitchen: LatLng | null, acceptedAt: Date | null): Promise<Date | null> {
    const door = order.dropoff?.pin ?? null;
    if (!kitchen || !door) return promisedArrival(order, kitchen, acceptedAt, null);
    const ride = await this.eta.minutes(kitchen, door, order.minVehicleClass ?? 'bike');
    return promisedArrival(order, kitchen, acceptedAt, ride.minutes);
  }

  /**
   * طلباتي (audit C-15): the actor's orders (as orderer or participant, like `orders.mine`), newest first, each with the restaurant's name and
   * its dishes, so the list reads "مطعم خالد · لفة تكة، بيبسي" without a read per row. Names are
   * looked up once per merchant; rides add the zone they went to.
   */
  async history(actor: Actor): Promise<OrderHistoryRow[]> {
    const orders = [...(await this.orders.listForPerson(actor.personId))]
      .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())
      .slice(0, ORDER_HISTORY_LIMIT);
    const merchantNames = new Map<string, string | null>();
    const itemIds = new Map<string, Set<string>>();
    for (const o of orders) {
      if (!o.merchantOrgId) continue;
      const ids = itemIds.get(o.merchantOrgId) ?? new Set<string>();
      for (const l of o.lines) if (l.catalogItemId) ids.add(l.catalogItemId);
      itemIds.set(o.merchantOrgId, ids);
    }
    const names = new Map<string, Map<string, string>>();
    for (const [orgId, ids] of itemIds) {
      merchantNames.set(orgId, (await this.merchants.merchant(orgId))?.name ?? null);
      names.set(orgId, ids.size > 0 ? await this.merchants.itemNames(orgId, [...ids]) : new Map());
    }
    const rows: OrderHistoryRow[] = [];
    for (const o of orders) {
      const menu = o.merchantOrgId ? names.get(o.merchantOrgId) : undefined;
      const items = o.lines
        .filter((l) => l.availability !== 'removed')
        .map((l) => ({ lineId: l.id, catalogItemId: l.catalogItemId, name: (l.catalogItemId ? menu?.get(l.catalogItemId) : null) ?? l.freeText ?? '', qty: Math.max(1, l.qty) }))
        .filter((i) => i.name !== '');
      const trip = o.type === 'ride' || o.type === 'errand' || o.type === 'parcel';
      const dropoffZoneKey = trip ? ((await this.orders.aggregate(o.id)).order.dropoff?.zoneKey ?? null) : null;
      rows.push({ order: o, merchantName: o.merchantOrgId ? (merchantNames.get(o.merchantOrgId) ?? null) : null, items, dropoffZoneKey });
    }
    return rows;
  }

  // ───────────────────────── internals ─────────────────────────

  /** The orderer or a participant with an account. Ops and merchants use their own consoles. */
  private async assertOwner(actor: Actor, orderId: string) {
    const agg = await this.orders.aggregate(orderId);
    const mine = agg.order.ordererId === actor.personId || agg.participants.some((p) => p.personId !== null && p.personId === actor.personId);
    if (!mine) throw new DriverError('forbidden');
    return agg;
  }

  /** The live trip; after completion the trip that carried it (for the timestamps on the timeline). */
  private async currentTrip(orderId: string): Promise<Trip | null> {
    const active = await this.trips.activeForOrder(orderId);
    if (active) return active;
    const carried = await this.trips.courierOf(orderId);
    return carried ? this.trips.get(carried.tripId) : null;
  }

  private tripView(trip: Trip, orderId: string): OrderTracking['trip'] {
    const stops: TrackStop[] = trip.stops.map((s) => {
      const mine = s.orderId === orderId;
      return { id: s.id, seq: s.seq, type: s.type, state: s.state, mine, target: mine ? s.target : null, arrivedAt: s.arrivedAt, completedAt: s.completedAt };
    });
    const myDrop = stops.find((s) => s.mine && s.type === 'dropoff');
    const dropsBeforeMine = myDrop ? stops.filter((s) => !s.mine && s.type === 'dropoff' && s.seq < myDrop.seq && s.state !== 'completed' && s.state !== 'skipped').length : 0;
    const unreachable = trip.unreachable && (!trip.unreachable.stopId || trip.stops.some((s) => s.id === trip.unreachable!.stopId && s.orderId === orderId)) ? trip.unreachable : null;
    return { id: trip.id, state: trip.state, acceptedAt: trip.acceptedAt, completedAt: trip.completedAt, stops, dropsBeforeMine, unreachable, vertical: trip.vertical };
  }

  private async courierCard(trip: Trip, readerId: string, now: Date): Promise<CourierCard> {
    const courierId = trip.courierId!;
    const key = `${trip.id}:${courierId}:${readerId}`;
    let who = this.cards.get(key);
    if (!who) {
      who = await this.identity.courierCard(courierId, readerId);
      if (this.cards.size >= CARD_CACHE_MAX) this.cards.delete(this.cards.keys().next().value!);
      this.cards.set(key, who);
    }
    const vehicle = await this.vehicles.forCourier(courierId, trip.vehicleId);
    return {
      firstName: who.firstName,
      vehicleClass: vehicle?.vehicleClass ?? defaultVehicle(trip.vertical),
      plate: vehicle?.plate ?? null,
      vehicleLabel: vehicle?.label ?? null,
      // TODO(scoring): customer-facing courier rating; the scoring module keeps internal scores only.
      rating: null,
      ratingCount: 0,
      verifiedTodayAt: who.lastVerifiedAt && sameBaghdadDay(who.lastVerifiedAt, now) ? who.lastVerifiedAt : null,
      photoUrl: null,
    };
  }

  private async items(agg: Awaited<ReturnType<TrackingOrdersPort['aggregate']>>): Promise<TrackItem[]> {
    const live = agg.lines.filter((l) => l.substitution?.state !== 'removed');
    const ids = live.map((l) => l.catalogItemId).filter((id): id is string => id !== null);
    const names = agg.order.merchantOrgId && ids.length > 0 ? await this.merchants.itemNames(agg.order.merchantOrgId, ids) : new Map<string, string>();
    return live.map((l) => {
      const mods = l.modifiers.reduce((a, m) => a + (typeof m.priceIqd === 'number' ? m.priceIqd : 0), 0);
      return {
        lineId: l.id,
        name: (l.catalogItemId ? names.get(l.catalogItemId) : null) ?? l.freeText ?? '—',
        qty: l.qty,
        totalIqd: l.qty * (l.unitPriceIqd + mods),
        participantId: l.participantId,
        note: l.note,
      };
    });
  }
}

/** A ride's or a vertical's usual vehicle when the fleet registry has none on file. */
function defaultVehicle(vertical: Trip['vertical']): VehicleClass | null {
  if (vertical === 'taxi') return 'car';
  if (vertical === 'tuktuk') return 'tuktuk';
  if (vertical === 'food' || vertical === 'grocery' || vertical === 'errand' || vertical === 'parcel') return 'bike';
  return null;
}

/**
 * The promised arrival (kitchen orders): ready time plus the kitchen → door ride at town speed.
 * Null when the kitchen has not accepted yet or either pin is unknown.
 */
export function promisedArrival(
  order: { type: Order['type']; promisedReadyAt: Date | null; dropoff: DeliveryPoint | null; minVehicleClass: VehicleClass | null },
  kitchen: LatLng | null,
  acceptedAt: Date | null,
  /** Kitchen → door minutes from the ETA service; null when unknown. */
  rideMin: number | null,
): Date | null {
  if (order.type !== 'food' && order.type !== 'grocery_catalog') return null;
  const ready = order.promisedReadyAt ?? null;
  const door = order.dropoff?.pin ?? null;
  if (!ready || !acceptedAt || !kitchen || !door || rideMin === null) return null;
  return new Date(ready.getTime() + rideMin * 60_000);
}
