import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  positionVisible,
  SHARE_AFTER_COMPLETE_MIN,
  SHARE_MAX_HOURS,
  travelMinutes,
  type Actor,
  type CreateShareLinkInput,
  type LatLng,
  type Order,
  type RevokeShareLinkInput,
  type SharedTrip,
  type SharedTripInput,
  type SharedTripStatus,
  type ShareLink,
  type ShareSubject,
  type TrackingSharePort,
  type Trip,
  type VehicleClass,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { TRACKING_ORDERS, TRACKING_TRIPS, type TrackingOrdersPort, type TrackingTripsPort } from './tracking.service.js';
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
}

export const SHARE_INTERCITY = Symbol('SHARE_INTERCITY');
export const SHARE_NAMES = Symbol('SHARE_NAMES');
export const SHARE_SECRET = Symbol('SHARE_SECRET');

const MIN_MS = 60_000;
const LIVE_BOOKING = new Set(['booked', 'checked_in', 'completed']);
const RIDE_CANCELLED_ORDER: ReadonlySet<Order['state']> = new Set(['customer_cancelled', 'platform_cancelled', 'refunded', 'failed']);
const RIDE_CANCELLED_TRIP: ReadonlySet<Trip['state']> = new Set(['customer_cancelled', 'platform_cancelled', 'failed']);
const NAME_CACHE_MAX = 2000;

/**
 * Share-trip links (scoring & safety §5; edge-case review C-126). The token is `<link id>.<HMAC>`
 * signed with SHARE_LINK_SECRET (else JWT_SECRET), so ids cannot be guessed or walked. The public
 * read (`tracking.shared`) carries coarse data only — first name, vehicle, plate, the car inside the
 * sharing window, ETA — and every first-name read is a vault access logged against the link.
 */
@Injectable()
export class ShareLinksService implements TrackingSharePort {
  private readonly names = new Map<string, string | null>();

  constructor(
    @Inject(SHARE_LINKS_REPOSITORY) private readonly repo: ShareLinksRepository,
    @Inject(TRACKING_ORDERS) private readonly orders: TrackingOrdersPort,
    @Inject(TRACKING_TRIPS) private readonly trips: TrackingTripsPort,
    @Inject(SHARE_NAMES) private readonly people: ShareNamesPort,
    @Inject(COURIER_VEHICLES) private readonly vehicles: CourierVehicleDirectory,
    @Inject(SHARE_INTERCITY) private readonly intercity: ShareIntercityPort,
    @Inject(SHARE_SECRET) private readonly secret: string,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createShareLink(actor: Actor, input: CreateShareLinkInput): Promise<ShareLink> {
    const now = this.clock.now();
    let subject: ShareSubject;
    let subjectId: string;
    if (input.orderId) {
      const agg = await this.orders.aggregate(input.orderId);
      const mine = agg.order.ordererId === actor.personId || agg.participants.some((p) => p.personId === actor.personId);
      if (!mine) throw new DriverError('order_not_found');
      if (agg.order.type !== 'ride') throw new DriverError('share_not_shareable');
      const s = await this.rideState(input.orderId, now);
      if (s.status === 'arrived' || s.status === 'ended') throw new DriverError('share_trip_over');
      subject = 'ride';
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
    const id = this.verify(input.token);
    const rec = id ? await this.repo.get(id) : null;
    if (!rec) throw new DriverError('share_link_invalid');
    await this.repo.addView(rec.id);
    const ended = (reason: 'expired' | 'revoked' | 'cancelled', expiresAt: Date | null): SharedTrip => ({
      status: 'ended',
      subject: rec.subjectKind,
      endedReason: reason,
      driverFirstName: null,
      vehicleClass: null,
      vehicleLabel: null,
      plate: null,
      position: null,
      eta: null,
      route: null,
      expiresAt,
      serverNow: now,
    });
    if (rec.revokedAt) return ended('revoked', null);
    const state = rec.subjectKind === 'ride' ? await this.rideState(rec.subjectId, now) : await this.intercityState(rec.subjectId, now);
    const expiresAt = expiryOf(rec.createdAt, state.completedAt);
    if (now.getTime() >= expiresAt.getTime()) return ended('expired', expiresAt);
    if (state.status === 'ended') return ended('cancelled', expiresAt);
    const driverFirstName = state.driverId ? await this.firstName(rec.id, state.driverId) : null;
    return {
      status: state.status,
      subject: rec.subjectKind,
      endedReason: null,
      driverFirstName,
      vehicleClass: state.vehicleClass,
      vehicleLabel: state.vehicleLabel,
      plate: state.plate,
      position: state.position ? { ...state.position, ageSec: Math.max(0, Math.round((now.getTime() - state.position.at.getTime()) / 1000)) } : null,
      eta: state.eta,
      route: state.route,
      expiresAt,
      serverNow: now,
    };
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
    const state = rec.subjectKind === 'ride' ? await this.rideState(rec.subjectId, now) : await this.intercityState(rec.subjectId, now);
    const token = this.tokenOf(rec.id);
    return { token, path: `/share/${token}`, subject: rec.subjectKind, createdAt: rec.createdAt, expiresAt: expiryOf(rec.createdAt, state.completedAt), revokedAt: rec.revokedAt, views: rec.views };
  }

  private async firstName(linkId: string, personId: string): Promise<string | null> {
    const key = `${linkId}:${personId}`;
    if (this.names.has(key)) return this.names.get(key)!;
    const name = (await this.people.firstNamesFor([personId], `share:${linkId}`, 'share_trip'))[personId] ?? null;
    if (this.names.size >= NAME_CACHE_MAX) this.names.delete(this.names.keys().next().value!);
    this.names.set(key, name);
    return name;
  }

  // ───────────────────────── subjects ─────────────────────────

  private async rideState(orderId: string, now: Date): Promise<SubjectState> {
    const order = await this.orders.get(orderId);
    let trip = await this.trips.activeForOrder(orderId);
    if (!trip) {
      const carried = await this.trips.courierOf(orderId);
      trip = carried ? await this.trips.get(carried.tripId) : null;
    }
    const base: SubjectState = { status: 'waiting', completedAt: null, driverId: null, vehicleClass: null, vehicleLabel: null, plate: null, position: null, eta: null, route: null };
    if (RIDE_CANCELLED_ORDER.has(order.state) || (trip && RIDE_CANCELLED_TRIP.has(trip.state))) {
      return { ...base, status: 'ended', completedAt: order.cancelledAt ?? trip?.cancelledAt ?? now };
    }
    if (!trip || !trip.courierId || !trip.acceptedAt || trip.state === 'driver_cancelled') return base;
    const completed = trip.state === 'completed';
    const vehicle = await this.vehicles.forCourier(trip.courierId, trip.vehicleId);
    const vehicleClass: VehicleClass | null = vehicle?.vehicleClass ?? (trip.vertical === 'tuktuk' ? 'tuktuk' : 'car');
    const status: SharedTripStatus = completed ? 'arrived' : trip.state === 'in_transit' || trip.state === 'arrived_dropoff' ? 'on_trip' : 'to_pickup';
    let position: SubjectState['position'] = null;
    let eta: Date | null = null;
    if (positionVisible(trip.state)) {
      const p = await this.trips.lastPosition(trip.id);
      if (p && p.driverId === trip.courierId) {
        position = { lat: p.pin.lat, lng: p.pin.lng, at: p.at };
        const target = trip.stops.find((s) => s.orderId === orderId && s.type === (status === 'on_trip' ? 'dropoff' : 'pickup'))?.target ?? null;
        if (target) eta = new Date(now.getTime() + travelMinutes(p.pin as LatLng, target, vehicleClass ?? 'car') * MIN_MS);
      }
    }
    return {
      status,
      completedAt: completed ? trip.completedAt : null,
      driverId: trip.courierId,
      vehicleClass,
      vehicleLabel: vehicle?.label ?? null,
      plate: vehicle?.plate ?? null,
      position,
      eta,
      route: null,
    };
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
      plate: dep.vehicle.plate,
      position: null,
      eta: null,
      route: { fromCityId: dep.fromCityId, toCityId: dep.toCityId },
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
      position: sharing && dep.lastPosition ? { lat: dep.lastPosition.lat, lng: dep.lastPosition.lng, at: dep.lastPosition.at } : null,
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
  plate: string | null;
  position: { lat: number; lng: number; at: Date } | null;
  eta: Date | null;
  route: { fromCityId: string; toCityId: string } | null;
}

/** Completion + 30 min, capped at creation + 24 h. */
export function expiryOf(createdAt: Date, completedAt: Date | null): Date {
  const cap = createdAt.getTime() + SHARE_MAX_HOURS * 3_600_000;
  return new Date(completedAt ? Math.min(cap, completedAt.getTime() + SHARE_AFTER_COMPLETE_MIN * MIN_MS) : cap);
}

/** A per-process secret when none is configured (links then die with the process — dev only). */
export function shareSecret(): string {
  return process.env['SHARE_LINK_SECRET'] ?? process.env['JWT_SECRET'] ?? randomBytes(32).toString('hex');
}
