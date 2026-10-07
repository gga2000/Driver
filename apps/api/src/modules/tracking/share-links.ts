import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DriverError,
  liveChannel,
  positionVisible,
  SHARE_AFTER_COMPLETE_MIN,
  SHARE_MAX_HOURS,
  type Actor,
  type CreateShareLinkInput,
  type Order,
  type OrderRoute,
  type RevokeShareLinkInput,
  type SharedTrip,
  type SharedTripInput,
  type SharedTripStatus,
  type ShareLink,
  type ShareSubject,
  type TrackingSharePort,
  type LatLng,
  type Trip,
  type VehicleClass,
  VehicleColour,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { EtaService } from '../routing/index.js';
import { TRACKING_MERCHANTS, TRACKING_ORDERS, TRACKING_TRIPS, type TrackingMerchantsPort, type TrackingOrdersPort, type TrackingTripsPort } from './tracking.service.js';
import { COURIER_VEHICLES, type CourierVehicleDirectory } from './vehicles.js';

// ───────────────────────── storage ─────────────────────────

export interface ShareLinkRecord {
  id: string;
  subjectKind: ShareSubject;
  subjectId: string;
  createdById: string;
  revokedAt: Date | null;
  views: number;
  createdAt: Date;
}

export interface ShareLinksRepository {
  create(input: { subjectKind: ShareSubject; subjectId: string; createdById: string; now: Date }): Promise<ShareLinkRecord>;
  get(id: string): Promise<ShareLinkRecord | null>;
  /** The creator's links to a subject, newest first. */
  forSubject(subjectKind: ShareSubject, subjectId: string, createdById: string): Promise<ShareLinkRecord[]>;
  revoke(id: string, now: Date): Promise<ShareLinkRecord>;
  addView(id: string): Promise<void>;
}

export const SHARE_LINKS_REPOSITORY = Symbol('SHARE_LINKS_REPOSITORY');

export class InMemoryShareLinksRepository implements ShareLinksRepository {
  private readonly rows = new Map<string, ShareLinkRecord>();

  async create(input: { subjectKind: ShareSubject; subjectId: string; createdById: string; now: Date }): Promise<ShareLinkRecord> {
    const rec: ShareLinkRecord = { id: `shr_${randomUUID().replace(/-/g, '').slice(0, 20)}`, subjectKind: input.subjectKind, subjectId: input.subjectId, createdById: input.createdById, revokedAt: null, views: 0, createdAt: input.now };
    this.rows.set(rec.id, rec);
    return { ...rec };
  }
  async get(id: string): Promise<ShareLinkRecord | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async forSubject(subjectKind: ShareSubject, subjectId: string, createdById: string): Promise<ShareLinkRecord[]> {
    return [...this.rows.values()].filter((r) => r.subjectKind === subjectKind && r.subjectId === subjectId && r.createdById === createdById).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => ({ ...r }));
  }
  async revoke(id: string, now: Date): Promise<ShareLinkRecord> {
    const r = this.rows.get(id);
    if (!r) throw new DriverError('share_link_invalid');
    r.revokedAt ??= now;
    return { ...r };
  }
  async addView(id: string): Promise<void> {
    const r = this.rows.get(id);
    if (r) r.views += 1;
  }
}

type ShareRow = { id: string; subjectKind: string; subjectId: string; createdById: string; revokedAt: Date | null; views: number; createdAt: Date };
const recordOf = (r: ShareRow): ShareLinkRecord => ({ ...r, subjectKind: r.subjectKind as ShareSubject });

export class PrismaShareLinksRepository implements ShareLinksRepository {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): Tx {
    return this.prisma.prisma as unknown as Tx;
  }
  async create(input: { subjectKind: ShareSubject; subjectId: string; createdById: string; now: Date }): Promise<ShareLinkRecord> {
    return recordOf(await this.db.shareLink.create({ data: { subjectKind: input.subjectKind, subjectId: input.subjectId, createdById: input.createdById, createdAt: input.now } }));
  }
  async get(id: string): Promise<ShareLinkRecord | null> {
    const r = await this.db.shareLink.findUnique({ where: { id } });
    return r ? recordOf(r) : null;
  }
  async forSubject(subjectKind: ShareSubject, subjectId: string, createdById: string): Promise<ShareLinkRecord[]> {
    return (await this.db.shareLink.findMany({ where: { subjectKind, subjectId, createdById }, orderBy: { createdAt: 'desc' } })).map(recordOf);
  }
  async revoke(id: string, now: Date): Promise<ShareLinkRecord> {
    const cur = await this.get(id);
    if (!cur) throw new DriverError('share_link_invalid');
    if (cur.revokedAt) return cur;
    return recordOf(await this.db.shareLink.update({ where: { id }, data: { revokedAt: now } }));
  }
  async addView(id: string): Promise<void> {
    await this.db.shareLink.update({ where: { id }, data: { views: { increment: 1 } } });
  }
}

// ───────────────────────── ports ─────────────────────────

/** الرجعة reads (the routes module's `DeparturesService`, narrowed). */
export interface ShareIntercityPort {
  booking(id: string): Promise<{ riderId: string; departureId: string; state: string }>;
  departure(id: string): Promise<{
    driverId: string;
    corridorId: string;
    fromCityId: string;
    toCityId: string;
    state: string;
    departAt: Date;
    departedAt: Date | null;
    arrivedAt: Date | null;
    closedAt: Date | null;
    cancelledAt: Date | null;
    vehicle: { plate: string; model: string | null; color: string | null };
    lastPosition: { lat: number; lng: number; at: Date } | null;
  }>;
  /** T−30: the car is shared from here (review C-45). */
  boardingWindowMin(): number;
  /** The corridor's travel time, for the ETA after departing; null when unknown. */
  travelMin(corridorId: string): number | null;
}

/** First names for the share page (logged vault reads with the link as accessor). */
export interface ShareNamesPort {
  firstNamesFor(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string | null>>;
  /** Approved main photos (Ali, 2026-10-06), storage refs by person; logged vault reads. Optional for fakes. */
  mainPhotoRefs?(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string>>;
}

/** Signs a short-lived read URL for a stored photo (the places module's blob store). */
export interface SharePhotosPort {
  readUrl(ref: string): string;
}

/** The one ETA the customer sees (`TrackingService.liveEta`): the family page shows the same time. */
export interface ShareDeliveryEtaPort {
  liveEta(order: Order, trip: Trip, pin: LatLng, now: Date): Promise<{ at: Date } | null>;
}

export const SHARE_INTERCITY = Symbol('SHARE_INTERCITY');
export const SHARE_DELIVERY_ETA = Symbol('SHARE_DELIVERY_ETA');
export const SHARE_NAMES = Symbol('SHARE_NAMES');
export const SHARE_SECRET = Symbol('SHARE_SECRET');
export const SHARE_PHOTOS = Symbol('SHARE_PHOTOS');

const MIN_MS = 60_000;
const LIVE_BOOKING = new Set(['booked', 'checked_in', 'completed']);
const RIDE_CANCELLED_ORDER: ReadonlySet<Order['state']> = new Set(['customer_cancelled', 'platform_cancelled', 'refunded', 'failed']);
const RIDE_CANCELLED_TRIP: ReadonlySet<Trip['state']> = new Set(['customer_cancelled', 'platform_cancelled', 'failed']);
const DELIVERY_CANCELLED_ORDER: ReadonlySet<Order['state']> = new Set(['merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'failed']);
/** Orders a courier brings to the door: the family at home can follow them (maps program SP3c). */
const DELIVERY_TYPES: ReadonlySet<Order['type']> = new Set(['food', 'grocery_catalog', 'errand', 'parcel']);
const NAME_CACHE_MAX = 2000;

/**
 * Share-trip links (scoring & safety §5; edge-case review C-126). The token is `<link id>.<HMAC>`
 * signed with SHARE_LINK_SECRET (else JWT_SECRET), so ids cannot be guessed or walked. The public
 * read (`tracking.shared`) carries coarse data only — first name, vehicle, plate, the car inside the
 * sharing window, ETA — and every first-name read is a vault access logged against the link.
 */
@Injectable()
export class ShareLinksService implements TrackingSharePort {
  private readonly logger = new Logger('ShareLinks');
  private readonly names = new Map<string, { firstName: string | null; photoRef: string | null }>();

  constructor(
    @Inject(SHARE_LINKS_REPOSITORY) private readonly repo: ShareLinksRepository,
    @Inject(TRACKING_ORDERS) private readonly orders: TrackingOrdersPort,
    @Inject(TRACKING_TRIPS) private readonly trips: TrackingTripsPort,
    @Inject(SHARE_NAMES) private readonly people: ShareNamesPort,
    @Inject(COURIER_VEHICLES) private readonly vehicles: CourierVehicleDirectory,
    @Inject(SHARE_INTERCITY) private readonly intercity: ShareIntercityPort,
    @Inject(SHARE_SECRET) private readonly secret: string,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly eta: EtaService,
    @Inject(TRACKING_MERCHANTS) private readonly merchants: TrackingMerchantsPort,
    @Inject(SHARE_DELIVERY_ETA) private readonly deliveryEta: ShareDeliveryEtaPort,
    /** Signs the driver's approved main photo for the page; without it the page draws his initial. */
    @Optional() @Inject(SHARE_PHOTOS) private readonly photos: SharePhotosPort | null = null,
  ) {}

  async createShareLink(actor: Actor, input: CreateShareLinkInput): Promise<ShareLink> {
    const now = this.clock.now();
    let subject: ShareSubject;
    let subjectId: string;
    if (input.orderId) {
      const agg = await this.orders.aggregate(input.orderId);
      const mine = agg.order.ordererId === actor.personId || agg.participants.some((p) => p.personId === actor.personId);
      if (!mine) throw new DriverError('order_not_found');
      if (agg.order.type === 'ride') subject = 'ride';
      else if (DELIVERY_TYPES.has(agg.order.type)) subject = 'delivery';
      else throw new DriverError('share_not_shareable');
      const s = await this.state(subject, input.orderId, now);
      if (s.status === 'arrived' || s.status === 'ended') throw new DriverError('share_trip_over');
      subjectId = input.orderId;
    } else {
      const booking = await this.intercity.booking(input.bookingId!);
      if (booking.riderId !== actor.personId) throw new DriverError('booking_not_found');
      if (!LIVE_BOOKING.has(booking.state)) throw new DriverError('share_not_shareable');
      const s = await this.intercityState(input.bookingId!, now);
      if (s.status === 'arrived' || s.status === 'ended') throw new DriverError('share_trip_over');
      subject = 'intercity';
      subjectId = input.bookingId!;
    }
    // One live link per rider and trip: sharing twice hands back the same link.
    for (const existing of await this.repo.forSubject(subject, subjectId, actor.personId)) {
      if (existing.revokedAt) continue;
      const view = await this.view(existing, now);
      if (view.expiresAt.getTime() > now.getTime()) return view;
    }
    return this.view(await this.repo.create({ subjectKind: subject, subjectId, createdById: actor.personId, now }), now);
  }

  async revokeShareLink(actor: Actor, input: RevokeShareLinkInput): Promise<ShareLink> {
    const id = this.verify(input.token);
    const rec = id ? await this.repo.get(id) : null;
    if (!rec || rec.createdById !== actor.personId) throw new DriverError('share_link_invalid');
    return this.view(await this.repo.revoke(rec.id, this.clock.now()), this.clock.now());
  }

  async shared(input: SharedTripInput): Promise<SharedTrip> {
    const now = this.clock.now();
    const rec = await this.link(input.token);
    // The rider sees page opens, not the page's refreshes or its live stream.
    if (!input.again) await this.repo.addView(rec.id);
    const ended = (reason: 'expired' | 'revoked' | 'cancelled', expiresAt: Date | null, arrivedAt: Date | null = null): SharedTrip => ({
      status: 'ended',
      subject: rec.subjectKind,
      endedReason: reason,
      driverFirstName: null,
      driverPhotoUrl: null,
      vehicleClass: null,
      vehicleLabel: null,
      vehicleModel: null,
      vehicleColour: null,
      plate: null,
      position: null,
      target: null,
      eta: null,
      route: null,
      storeName: null,
      arrivedAt,
      expiresAt,
      serverNow: now,
    });
    if (rec.revokedAt) return ended('revoked', null);
    const state = await this.state(rec.subjectKind, rec.subjectId, now);
    const expiresAt = expiryOf(rec.createdAt, state.completedAt);
    // l8: a link that ran out after the trip arrived still says it ended safely, and when.
    if (now.getTime() >= expiresAt.getTime()) return ended('expired', expiresAt, state.status === 'arrived' ? state.completedAt : null);
    if (state.status === 'ended') return ended('cancelled', expiresAt);
    // CRIT2-02: the driver's name and photo are best-effort; the live location keeps flowing without them.
    const driver = state.driverId
      ? await this.driverCard(rec.id, state.driverId).catch((err: unknown) => {
          this.logger.warn(`share page driver card: ${(err as Error).message}`);
          return null;
        })
      : null;
    return {
      status: state.status,
      subject: rec.subjectKind,
      endedReason: null,
      driverFirstName: driver?.firstName ?? null,
      driverPhotoUrl: driver?.photoRef && this.photos ? this.photos.readUrl(driver.photoRef) : null,
      vehicleClass: state.vehicleClass,
      vehicleLabel: state.vehicleLabel,
      vehicleModel: state.vehicleModel,
      vehicleColour: state.vehicleColour,
      plate: state.plate,
      position: state.position ? { ...state.position, ageSec: Math.max(0, Math.round((now.getTime() - state.position.at.getTime()) / 1000)) } : null,
      target: state.target,
      eta: state.eta,
      route: state.route,
      storeName: state.storeName,
      arrivedAt: state.status === 'arrived' ? state.completedAt : null,
      expiresAt,
      serverNow: now,
    };
  }

  async sharedRoute(input: SharedTripInput): Promise<OrderRoute> {
    const now = this.clock.now();
    const none: OrderRoute = { polyline6: null, basis: 'estimated', from: null, computedAt: now };
    const rec = await this.link(input.token);
    if (rec.revokedAt || rec.subjectKind === 'intercity') return none;
    const state = await this.state(rec.subjectKind, rec.subjectId, now);
    if (now.getTime() >= expiryOf(rec.createdAt, state.completedAt).getTime()) return none;
    if (!state.position || !state.target) return none;
    const from = { lat: state.position.lat, lng: state.position.lng };
    const r = await this.eta.path([from, { lat: state.target.lat, lng: state.target.lng }]);
    return { polyline6: r.polyline6, basis: r.basis, from, computedAt: now };
  }

  async liveChannels(input: SharedTripInput): Promise<string[]> {
    const rec = await this.link(input.token);
    // Intercity positions are not on the bus (the stream re-reads them on its timer).
    return rec.subjectKind === 'intercity' ? [] : [liveChannel.order(rec.subjectId)];
  }

  /** The link behind a token; `share_link_invalid` for a forged, unknown or malformed one. */
  private async link(token: string): Promise<ShareLinkRecord> {
    const id = this.verify(token);
    const rec = id ? await this.repo.get(id) : null;
    if (!rec) throw new DriverError('share_link_invalid');
    return rec;
  }

  // ───────────────────────── tokens ─────────────────────────

  tokenOf(id: string): string {
    return `${id}.${this.sign(id)}`;
  }

  private sign(id: string): string {
    return createHmac('sha256', this.secret).update(`share:${id}`).digest('base64url').slice(0, 32);
  }

  /** The link id behind a well-signed token; null for anything else. */
  private verify(token: string): string | null {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const id = token.slice(0, dot);
    const want = Buffer.from(this.sign(id));
    const got = Buffer.from(token.slice(dot + 1));
    return want.length === got.length && timingSafeEqual(want, got) ? id : null;
  }

  private async view(rec: ShareLinkRecord, now: Date): Promise<ShareLink> {
    const state = await this.state(rec.subjectKind, rec.subjectId, now);
    const token = this.tokenOf(rec.id);
    return { token, path: `/share/${token}`, subject: rec.subjectKind, createdAt: rec.createdAt, expiresAt: expiryOf(rec.createdAt, state.completedAt), revokedAt: rec.revokedAt, views: rec.views };
  }

  /** His first name and approved main photo ref, read once per link (both logged against the link). */
  private async driverCard(linkId: string, personId: string): Promise<{ firstName: string | null; photoRef: string | null }> {
    const key = `${linkId}:${personId}`;
    if (this.names.has(key)) return this.names.get(key)!;
    const accessor = `share:${linkId}`;
    const firstName = (await this.people.firstNamesFor([personId], accessor, 'share_trip'))[personId] ?? null;
    const photoRef = this.people.mainPhotoRefs ? ((await this.people.mainPhotoRefs([personId], accessor, 'share_trip'))[personId] ?? null) : null;
    const card = { firstName, photoRef };
    if (this.names.size >= NAME_CACHE_MAX) this.names.delete(this.names.keys().next().value!);
    this.names.set(key, card);
    return card;
  }

  // ───────────────────────── subjects ─────────────────────────

  private state(kind: ShareSubject, id: string, now: Date): Promise<SubjectState> {
    if (kind === 'ride') return this.rideState(id, now);
    if (kind === 'delivery') return this.deliveryState(id, now);
    return this.intercityState(id, now);
  }

  /** The trip carrying an order now, else the one that last carried it. */
  private async tripOf(orderId: string): Promise<Trip | null> {
    const active = await this.trips.activeForOrder(orderId);
    if (active) return active;
    const carried = await this.trips.courierOf(orderId);
    return carried ? this.trips.get(carried.tripId) : null;
  }

  private async rideState(orderId: string, now: Date): Promise<SubjectState> {
    const order = await this.orders.get(orderId);
    const trip = await this.tripOf(orderId);
    const base: SubjectState = { ...EMPTY_STATE };
    if (RIDE_CANCELLED_ORDER.has(order.state) || (trip && RIDE_CANCELLED_TRIP.has(trip.state))) {
      return { ...base, status: 'ended', completedAt: order.cancelledAt ?? trip?.cancelledAt ?? now };
    }
    if (!trip || !trip.courierId || !trip.acceptedAt || trip.state === 'driver_cancelled') return base;
    const completed = trip.state === 'completed';
    const vehicle = await this.vehicles.forCourier(trip.courierId, trip.vehicleId);
    const vehicleClass: VehicleClass | null = vehicle?.vehicleClass ?? (trip.vertical === 'tuktuk' ? 'tuktuk' : 'car');
    const status: SharedTripStatus = completed ? 'arrived' : trip.state === 'in_transit' || trip.state === 'arrived_dropoff' ? 'on_trip' : 'to_pickup';
    let position: SubjectState['position'] = null;
    let target: SubjectState['target'] = null;
    let eta: Date | null = null;
    if (positionVisible(trip.state)) {
      // Where the car is heading (maps program c9): the rider's pickup until they are in, then the destination.
      const kind = status === 'on_trip' ? 'dropoff' : 'pickup';
      const stop = trip.stops.find((s) => s.orderId === orderId && s.type === kind)?.target ?? null;
      target = stop ? { lat: stop.lat, lng: stop.lng, kind } : null;
      const p = await this.trips.lastPosition(trip.id);
      if (p && p.driverId === trip.courierId) {
        position = { lat: p.pin.lat, lng: p.pin.lng, at: p.at, bearing: p.bearing, speedKmh: p.speedKmh };
        if (stop) eta = new Date(now.getTime() + (await this.eta.minutes(p.pin, stop, vehicleClass ?? 'car')).minutes * MIN_MS);
      }
    }
    return {
      status,
      completedAt: completed ? trip.completedAt : null,
      driverId: trip.courierId,
      vehicleClass,
      vehicleLabel: vehicle?.label ?? null,
      vehicleModel: vehicle?.model ?? null,
      vehicleColour: vehicle?.colour ?? null,
      plate: vehicle?.plate ?? null,
      position,
      target,
      eta,
      route: null,
      storeName: null,
    };
  }

  /**
   * A delivery (maps program SP3c): preparing until a courier takes it, then the courier on his way to
   * the store (the store's pin), then on the way to the door (the door's pin) with the customer's own
   * ETA. Done at the order's delivery, even while the courier's batched trip goes on.
   */
  private async deliveryState(orderId: string, now: Date): Promise<SubjectState> {
    const order = await this.orders.get(orderId);
    const storeName = order.merchantOrgId ? ((await this.merchants.merchant(order.merchantOrgId))?.name ?? null) : null;
    const base: SubjectState = { ...EMPTY_STATE, storeName };
    // Fallbacks are fixed times (never `now`): on inconsistent data the link must still expire.
    if (DELIVERY_CANCELLED_ORDER.has(order.state)) return { ...base, status: 'ended', completedAt: order.cancelledAt ?? order.placedAt };
    const trip = await this.tripOf(orderId);
    const stop = (type: 'pickup' | 'dropoff') => trip?.stops.find((st) => st.orderId === orderId && (st.type === type || (type === 'pickup' && st.type === 'shop')));
    // A stop is done before the order's own picked-up / delivered marks land (they follow from the trip's events).
    const delivered = order.deliveredAt ?? stop('dropoff')?.completedAt ?? (order.state === 'delivered' || order.state === 'closed' ? order.placedAt : null);
    if (!trip || !trip.courierId || !trip.acceptedAt || trip.state === 'driver_cancelled') {
      return delivered ? { ...base, status: 'arrived', completedAt: delivered } : base;
    }
    const vehicle = await this.vehicles.forCourier(trip.courierId, trip.vehicleId);
    const courier = { ...base, driverId: trip.courierId, vehicleClass: vehicle?.vehicleClass ?? order.minVehicleClass ?? 'bike', vehicleLabel: vehicle?.label ?? null, vehicleModel: vehicle?.model ?? null, vehicleColour: vehicle?.colour ?? null, plate: vehicle?.plate ?? null };
    if (delivered) return { ...courier, status: 'arrived', completedAt: delivered };
    const collected = Boolean(order.pickedUpAt) || order.state === 'picked_up' || stop('pickup')?.state === 'completed';
    const state: SubjectState = { ...courier, status: collected ? 'on_trip' : 'to_pickup' };
    if (!positionVisible(trip.state)) return state;
    const pin = stop(collected ? 'dropoff' : 'pickup')?.target ?? null;
    state.target = pin ? { lat: pin.lat, lng: pin.lng, kind: collected ? 'dropoff' : 'pickup' } : null;
    const p = await this.trips.lastPosition(trip.id);
    if (p && p.driverId === trip.courierId) {
      state.position = { lat: p.pin.lat, lng: p.pin.lng, at: p.at, bearing: p.bearing, speedKmh: p.speedKmh };
      state.eta = (await this.deliveryEta.liveEta(order, trip, p.pin, now))?.at ?? null;
    }
    return state;
  }

  private async intercityState(bookingId: string, now: Date): Promise<SubjectState> {
    const booking = await this.intercity.booking(bookingId);
    const dep = await this.intercity.departure(booking.departureId);
    const base: SubjectState = {
      status: 'waiting',
      completedAt: null,
      driverId: dep.driverId,
      vehicleClass: 'intercity',
      vehicleLabel: [dep.vehicle.model, dep.vehicle.color].filter(Boolean).join(' · ') || null,
      vehicleModel: dep.vehicle.model,
      // The garage form's colour is free text; the paint dot only when it names one of ours.
      vehicleColour: VehicleColour.safeParse(dep.vehicle.color).data ?? null,
      plate: dep.vehicle.plate,
      position: null,
      target: null,
      eta: null,
      route: { fromCityId: dep.fromCityId, toCityId: dep.toCityId },
      storeName: null,
    };
    if (!LIVE_BOOKING.has(booking.state) || dep.state.startsWith('cancelled')) return { ...base, status: 'ended', completedAt: dep.cancelledAt ?? now };
    if (dep.state === 'arrived' || dep.state === 'closed') return { ...base, status: 'arrived', completedAt: dep.arrivedAt ?? dep.closedAt ?? now };
    const boardingOpen = now.getTime() >= dep.departAt.getTime() - this.intercity.boardingWindowMin() * MIN_MS;
    // Review C-45: the car from the boarding window to arrival, never the stop list.
    const sharing = boardingOpen && (dep.state === 'scheduled' || dep.state === 'boarding' || dep.state === 'departed');
    const travel = this.intercity.travelMin(dep.corridorId);
    return {
      ...base,
      status: dep.state === 'departed' ? 'on_trip' : 'waiting',
      position: sharing && dep.lastPosition ? { lat: dep.lastPosition.lat, lng: dep.lastPosition.lng, at: dep.lastPosition.at, bearing: null, speedKmh: null } : null,
      eta: dep.state === 'departed' && dep.departedAt && travel ? new Date(dep.departedAt.getTime() + travel * MIN_MS) : null,
    };
  }
}

interface SubjectState {
  status: SharedTripStatus;
  completedAt: Date | null;
  driverId: string | null;
  vehicleClass: VehicleClass | null;
  vehicleLabel: string | null;
  vehicleModel: string | null;
  vehicleColour: VehicleColour | null;
  plate: string | null;
  position: { lat: number; lng: number; at: Date; bearing: number | null; speedKmh: number | null } | null;
  target: SharedTrip['target'];
  eta: Date | null;
  route: { fromCityId: string; toCityId: string } | null;
  storeName: string | null;
}

const EMPTY_STATE: SubjectState = { status: 'waiting', completedAt: null, driverId: null, vehicleClass: null, vehicleLabel: null, vehicleModel: null, vehicleColour: null, plate: null, position: null, target: null, eta: null, route: null, storeName: null };

/** Completion + 30 min, capped at creation + 24 h. */
export function expiryOf(createdAt: Date, completedAt: Date | null): Date {
  const cap = createdAt.getTime() + SHARE_MAX_HOURS * 3_600_000;
  return new Date(completedAt ? Math.min(cap, completedAt.getTime() + SHARE_AFTER_COMPLETE_MIN * MIN_MS) : cap);
}

/** A per-process secret when none is configured (links then die with the process — dev only). */
export function shareSecret(): string {
  return process.env['SHARE_LINK_SECRET'] ?? process.env['JWT_SECRET'] ?? randomBytes(32).toString('hex');
}
