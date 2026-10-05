import { randomUUID } from 'node:crypto';
import type { LatLng, StopState, StopType, TripState, VehicleClass, Vertical } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { TripOrderLookup } from './trip-order.lookup.js';

/**
 * The trips module's persistence port: `trips`, `stops`, `trip_orders`, `trail_points` — its own
 * tables only. `PrismaTripsRepository` is bound when DATABASE_URL is set; `InMemoryTripsRepository`
 * (same contract) serves unit tests, the simulator and a database-less dev API.
 *
 * Geography columns (`stops.target_pin`, `stops.arrivalPin`, `trail_points.pin`) are Prisma
 * `Unsupported`, so the Prisma implementation reads and writes them with raw SQL.
 */

export interface TripRecord {
  id: string;
  cityId: string;
  vertical: Vertical;
  state: TripState;
  courierId: string | null;
  vehicleId: string | null;
  routeId: string | null;
  departureId: string | null;
  quoteId: string | null;
  batchId: string | null;
  offeredAt: Date | null;
  acceptedAt: Date | null;
  unreachableStartedAt: Date | null;
  unreachableEscalatedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StopRecord {
  id: string;
  tripId: string;
  seq: number;
  orderId: string | null;
  type: StopType;
  state: StopState;
  placeId: string | null;
  meetingPointId: string | null;
  zoneKey: string;
  target: LatLng | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  geofenceEnteredAt: Date | null;
  /** First live fix within `NEAR_DROPOFF_M` of a drop-off (the "almost there" moment). */
  courierNearAt: Date | null;
  arrivedAt: Date | null;
  arrivedOutsideGeofence: boolean;
  arrivalPin: LatLng | null;
  arrivalDistanceM: number | null;
  completedAt: Date | null;
  skippedAt: Date | null;
  skipReason: string | null;
  handoverProof: Record<string, unknown>;
  childRef: string | null;
  childTapInAt: Date | null;
  childTapOutAt: Date | null;
}

export interface TripOrderRecord {
  id: string;
  tripId: string;
  orderId: string;
  attachedAt: Date;
  detachedAt: Date | null;
  reason: string | null;
  changedBy: string | null;
  minVehicleClass: VehicleClass | null;
}

export interface TrailPointRecord {
  tripId: string | null;
  driverId: string;
  at: Date;
  pin: LatLng;
  speedKmh: number | null;
  bearing: number | null;
  accuracyM: number | null;
}

export interface NewTrip {
  cityId: string;
  vertical: Vertical;
  quoteId?: string | null;
  batchId?: string | null;
  routeId?: string | null;
  departureId?: string | null;
}

export interface NewStop {
  orderId?: string | null;
  type: StopType;
  zoneKey: string;
  placeId?: string | null;
  meetingPointId?: string | null;
  target?: LatLng | null;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  childRef?: string | null;
}

export type TripPatch = Partial<Omit<TripRecord, 'id' | 'cityId' | 'vertical' | 'createdAt' | 'updatedAt'>>;
export type StopPatch = Partial<
  Pick<
    StopRecord,
    | 'state'
    | 'geofenceEnteredAt'
    | 'courierNearAt'
    | 'arrivedAt'
    | 'arrivedOutsideGeofence'
    | 'arrivalPin'
    | 'arrivalDistanceM'
    | 'completedAt'
    | 'skippedAt'
    | 'skipReason'
    | 'handoverProof'
    | 'childTapInAt'
    | 'childTapOutAt'
  >
>;

export interface TripsRepository extends TripOrderLookup {
  createTrip(input: NewTrip, now: Date, tx?: Tx): Promise<TripRecord>;
  findTrip(id: string, tx?: Tx): Promise<TripRecord | null>;
  /**
   * With `expectState`, the update only applies while the row is still in that state (a
   * conditional UPDATE … WHERE state = $expect) and returns null otherwise: two concurrent
   * accepts can never both win.
   */
  updateTrip(id: string, patch: TripPatch, now: Date, tx?: Tx): Promise<TripRecord>;
  updateTripIf(id: string, expectState: TripState, patch: TripPatch, now: Date, tx?: Tx): Promise<TripRecord | null>;
  findTrips(filter: { cityId?: string; courierId?: string; states?: readonly TripState[] }, tx?: Tx): Promise<TripRecord[]>;

  stopsOf(tripId: string, tx?: Tx): Promise<StopRecord[]>;
  /** Appends stops after the trip's last `seq`. */
  addStops(tripId: string, stops: readonly NewStop[], now: Date, tx?: Tx): Promise<StopRecord[]>;
  updateStop(id: string, patch: StopPatch, now: Date, tx?: Tx): Promise<StopRecord>;

  linksOf(tripId: string, tx?: Tx): Promise<TripOrderRecord[]>;
  linksForOrder(orderId: string, tx?: Tx): Promise<TripOrderRecord[]>;
  attach(input: { tripId: string; orderId: string; at: Date; reason: string | null; changedBy: string | null; minVehicleClass: VehicleClass | null }, tx?: Tx): Promise<TripOrderRecord>;
  detach(linkId: string, input: { at: Date; reason: string; changedBy: string | null }, tx?: Tx): Promise<TripOrderRecord>;

  addTrailPoint(point: TrailPointRecord, tx?: Tx): Promise<void>;
  lastTrailPoint(filter: { tripId?: string; driverId?: string }, tx?: Tx): Promise<TrailPointRecord | null>;
  /**
   * Deletes up to `batch` trail points older than `cutoff`, except those of `keepTripIds` (decision D6:
   * 30 days, then the trip row is the summary). Returns how many went; a short count means done.
   */
  purgeTrail(cutoff: Date, keepTripIds: readonly string[], batch: number): Promise<number>;
}

export const TRIPS_REPOSITORY = Symbol('TRIPS_REPOSITORY');

// ───────────────────────── Prisma implementation ─────────────────────────

type TripRow = Omit<TripRecord, 'vertical' | 'state'> & { vertical: string; state: string };

function tripFromRow(r: TripRow & Record<string, unknown>): TripRecord {
  return {
    id: r.id,
    cityId: r.cityId,
    vertical: r.vertical as Vertical,
    state: r.state as TripState,
    courierId: r.courierId,
    vehicleId: r.vehicleId,
    routeId: r.routeId,
    departureId: r.departureId,
    quoteId: r.quoteId,
    batchId: r.batchId,
    offeredAt: r.offeredAt,
    acceptedAt: r.acceptedAt,
    unreachableStartedAt: r.unreachableStartedAt,
    unreachableEscalatedAt: r.unreachableEscalatedAt,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    cancellationReason: r.cancellationReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

interface StopRow {
  id: string;
  tripId: string;
  seq: number;
  orderId: string | null;
  type: string;
  state: string;
  placeId: string | null;
  meetingPointId: string | null;
  zoneKey: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  geofenceEnteredAt: Date | null;
  courierNearAt: Date | null;
  arrivedAt: Date | null;
  arrivedOutsideGeofence: boolean;
  arrivalDistanceM: number | null;
  completedAt: Date | null;
  skippedAt: Date | null;
  skipReason: string | null;
  handoverProof: unknown;
  childRef: string | null;
  childTapInAt: Date | null;
  childTapOutAt: Date | null;
}

interface PinRow {
  id: string;
  target_lat: number | null;
  target_lng: number | null;
  arrival_lat: number | null;
  arrival_lng: number | null;
}

function pin(lat: number | null, lng: number | null): LatLng | null {
  return lat === null || lng === null ? null : { lat: Number(lat), lng: Number(lng) };
}

function linkFromRow(r: { id: string; tripId: string; orderId: string; attachedAt: Date; detachedAt: Date | null; reason: string | null; changedBy: string | null; minVehicleClass: string | null }): TripOrderRecord {
  return { ...r, minVehicleClass: (r.minVehicleClass as VehicleClass | null) ?? null };
}

/** Bound when DATABASE_URL is set. Touches only trips, stops, trip_orders and trail_points. */
export class PrismaTripsRepository implements TripsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  /** Creates this and next month's trail partitions (idempotent; the default partition catches the rest). */
  async ensureTrailPartitions(now: Date): Promise<void> {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    await this.db().$executeRaw`SELECT "public"."ensure_trail_partition"(${month}::date)`;
    await this.db().$executeRaw`SELECT "public"."ensure_trail_partition"(${next}::date)`;
  }

  async createTrip(input: NewTrip, _now: Date, tx?: Tx) {
    const row = await this.db(tx).trip.create({
      data: {
        cityId: input.cityId,
        vertical: input.vertical,
        quoteId: input.quoteId ?? null,
        batchId: input.batchId ?? null,
        routeId: input.routeId ?? null,
        departureId: input.departureId ?? null,
      },
    });
    return tripFromRow(row);
  }

  async findTrip(id: string, tx?: Tx) {
    const row = await this.db(tx).trip.findUnique({ where: { id } });
    return row ? tripFromRow(row) : null;
  }

  async updateTrip(id: string, patch: TripPatch, _now: Date, tx?: Tx) {
    const { state, ...rest } = patch;
    const row = await this.db(tx).trip.update({ where: { id }, data: { ...rest, ...(state ? { state } : {}) } });
    return tripFromRow(row);
  }

  async updateTripIf(id: string, expectState: TripState, patch: TripPatch, _now: Date, tx?: Tx) {
    const { state, ...rest } = patch;
    const res = await this.db(tx).trip.updateMany({ where: { id, state: expectState }, data: { ...rest, ...(state ? { state } : {}) } });
    if (res.count === 0) return null;
    return this.findTrip(id, tx);
  }

  async findTrips(filter: { cityId?: string; courierId?: string; states?: readonly TripState[] }, tx?: Tx) {
    const rows = await this.db(tx).trip.findMany({
      where: {
        ...(filter.cityId ? { cityId: filter.cityId } : {}),
        ...(filter.courierId ? { courierId: filter.courierId } : {}),
        ...(filter.states ? { state: { in: [...filter.states] } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(tripFromRow);
  }

  async stopsOf(tripId: string, tx?: Tx) {
    const db = this.db(tx);
    const rows = (await db.stop.findMany({ where: { tripId }, orderBy: { seq: 'asc' } })) as unknown as StopRow[];
    if (rows.length === 0) return [];
    const pins = await db.$queryRaw<PinRow[]>`
      SELECT id,
             ST_Y(target_pin::geometry) AS target_lat, ST_X(target_pin::geometry) AS target_lng,
             ST_Y("arrivalPin"::geometry) AS arrival_lat, ST_X("arrivalPin"::geometry) AS arrival_lng
        FROM "public"."stops" WHERE trip_id = ${tripId}`;
    const byId = new Map(pins.map((p) => [p.id, p]));
    return rows.map((r) => {
      const p = byId.get(r.id);
      return {
        ...r,
        type: r.type as StopType,
        state: r.state as StopState,
        handoverProof: (r.handoverProof ?? {}) as Record<string, unknown>,
        target: p ? pin(p.target_lat, p.target_lng) : null,
        arrivalPin: p ? pin(p.arrival_lat, p.arrival_lng) : null,
      };
    });
  }

  async addStops(tripId: string, stops: readonly NewStop[], _now: Date, tx?: Tx) {
    const db = this.db(tx);
    const last = await db.stop.findFirst({ where: { tripId }, orderBy: { seq: 'desc' }, select: { seq: true } });
    let seq = last ? last.seq + 1 : 0;
    for (const s of stops) {
      const row = await db.stop.create({
        data: {
          tripId,
          seq,
          orderId: s.orderId ?? null,
          type: s.type,
          zoneKey: s.zoneKey,
          placeId: s.placeId ?? null,
          meetingPointId: s.meetingPointId ?? null,
          windowStart: s.windowStart ?? null,
          windowEnd: s.windowEnd ?? null,
          childRef: s.childRef ?? null,
        },
      });
      if (s.target) {
        await db.$executeRaw`UPDATE "public"."stops" SET target_pin = ST_SetSRID(ST_MakePoint(${s.target.lng}, ${s.target.lat}), 4326)::geography WHERE id = ${row.id}`;
      }
      seq += 1;
    }
    return this.stopsOf(tripId, tx);
  }

  async updateStop(id: string, patch: StopPatch, _now: Date, tx?: Tx) {
    const db = this.db(tx);
    const { arrivalPin, handoverProof, ...rest } = patch;
    const row = await db.stop.update({
      where: { id },
      data: { ...rest, ...(handoverProof !== undefined ? { handoverProof: handoverProof as object } : {}) },
    });
    if (arrivalPin) {
      await db.$executeRaw`UPDATE "public"."stops" SET "arrivalPin" = ST_SetSRID(ST_MakePoint(${arrivalPin.lng}, ${arrivalPin.lat}), 4326)::geography WHERE id = ${id}`;
    }
    const all = await this.stopsOf(row.tripId, tx);
    return all.find((s) => s.id === id)!;
  }

  async linksOf(tripId: string, tx?: Tx) {
    const rows = await this.db(tx).tripOrder.findMany({ where: { tripId }, orderBy: { attachedAt: 'asc' } });
    return rows.map(linkFromRow);
  }

  async linksForOrder(orderId: string, tx?: Tx) {
    const rows = await this.db(tx).tripOrder.findMany({ where: { orderId }, orderBy: { attachedAt: 'asc' } });
    return rows.map(linkFromRow);
  }

  async attach(input: { tripId: string; orderId: string; at: Date; reason: string | null; changedBy: string | null; minVehicleClass: VehicleClass | null }, tx?: Tx) {
    const row = await this.db(tx).tripOrder.create({
      data: { tripId: input.tripId, orderId: input.orderId, attachedAt: input.at, reason: input.reason, changedBy: input.changedBy, minVehicleClass: input.minVehicleClass },
    });
    return linkFromRow(row);
  }

  async detach(linkId: string, input: { at: Date; reason: string; changedBy: string | null }, tx?: Tx) {
    const row = await this.db(tx).tripOrder.update({ where: { id: linkId }, data: { detachedAt: input.at, reason: input.reason, changedBy: input.changedBy } });
    return linkFromRow(row);
  }

  async addTrailPoint(p: TrailPointRecord, tx?: Tx) {
    const now = new Date();
    await this.db(tx).$executeRaw`
      INSERT INTO "public"."trail_points" (id, trip_id, driver_id, at, pin, speed_kmh, bearing, accuracy_m, recorded_at, created_at, updated_at)
      VALUES (${randomUUID()}, ${p.tripId}, ${p.driverId}, ${p.at}, ST_SetSRID(ST_MakePoint(${p.pin.lng}, ${p.pin.lat}), 4326)::geography,
              ${p.speedKmh}, ${p.bearing}, ${p.accuracyM}, ${now}, ${now}, ${now})`;
  }

  async lastTrailPoint(filter: { tripId?: string; driverId?: string }, tx?: Tx) {
    const db = this.db(tx);
    type Row = { trip_id: string | null; driver_id: string; at: Date; lat: number; lng: number; speed_kmh: number | null; bearing: number | null; accuracy_m: number | null };
    const rows = filter.tripId
      ? await db.$queryRaw<Row[]>`SELECT trip_id, driver_id, at, ST_Y(pin::geometry) AS lat, ST_X(pin::geometry) AS lng, speed_kmh, bearing, accuracy_m
           FROM "public"."trail_points" WHERE trip_id = ${filter.tripId} ORDER BY at DESC LIMIT 1`
      : await db.$queryRaw<Row[]>`SELECT trip_id, driver_id, at, ST_Y(pin::geometry) AS lat, ST_X(pin::geometry) AS lng, speed_kmh, bearing, accuracy_m
           FROM "public"."trail_points" WHERE driver_id = ${filter.driverId ?? ''} ORDER BY at DESC LIMIT 1`;
    const r = rows[0];
    if (!r) return null;
    return { tripId: r.trip_id, driverId: r.driver_id, at: r.at, pin: { lat: Number(r.lat), lng: Number(r.lng) }, speedKmh: r.speed_kmh, bearing: r.bearing, accuracyM: r.accuracy_m };
  }

  async purgeTrail(cutoff: Date, keepTripIds: readonly string[], batch: number): Promise<number> {
    return this.db().$executeRaw`
      WITH doomed AS (
        SELECT "id", "at" FROM "public"."trail_points"
        WHERE "at" < ${cutoff} AND ("trip_id" IS NULL OR NOT ("trip_id" = ANY(${[...keepTripIds]}::text[])))
        LIMIT ${batch}
      )
      DELETE FROM "public"."trail_points" t USING doomed d WHERE t."id" = d."id" AND t."at" = d."at"`;
  }

  async detachedAt(tripId: string, orderId: string): Promise<Date | null> {
    const latest = await this.db().tripOrder.findFirst({ where: { tripId, orderId }, orderBy: { attachedAt: 'desc' } });
    return latest?.detachedAt ?? null;
  }
}

// ───────────────────────── In-memory twin ─────────────────────────

/** Same contract as the Prisma repository, in process. Records are copied in and out so callers never alias state. */
export class InMemoryTripsRepository implements TripsRepository {
  readonly trips = new Map<string, TripRecord>();
  readonly stops = new Map<string, StopRecord>();
  readonly links: TripOrderRecord[] = [];
  readonly trail: TrailPointRecord[] = [];
  private seq = 0;
  // Indexes (the simulator runs thousands of trips and a trail point per driver per tick).
  private readonly stopIds = new Map<string, string[]>();
  private readonly linksByTrip = new Map<string, TripOrderRecord[]>();
  private readonly linksByOrder = new Map<string, TripOrderRecord[]>();
  private readonly lastByTrip = new Map<string, TrailPointRecord>();
  private readonly lastByDriver = new Map<string, TrailPointRecord>();
  private readonly tripsByCourier = new Map<string, Set<string>>();

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async createTrip(input: NewTrip, now: Date) {
    const trip: TripRecord = {
      id: this.id('trip'),
      cityId: input.cityId,
      vertical: input.vertical,
      state: 'created',
      courierId: null,
      vehicleId: null,
      routeId: input.routeId ?? null,
      departureId: input.departureId ?? null,
      quoteId: input.quoteId ?? null,
      batchId: input.batchId ?? null,
      offeredAt: null,
      acceptedAt: null,
      unreachableStartedAt: null,
      unreachableEscalatedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.trips.set(trip.id, trip);
    return { ...trip };
  }

  async findTrip(id: string) {
    const t = this.trips.get(id);
    return t ? { ...t } : null;
  }

  async updateTrip(id: string, patch: TripPatch, now: Date) {
    const t = this.trips.get(id);
    if (!t) throw new Error(`trip ${id} not found`);
    const next = { ...t, ...patch, updatedAt: now };
    this.trips.set(id, next);
    if (next.courierId !== t.courierId) {
      if (t.courierId) this.tripsByCourier.get(t.courierId)?.delete(id);
      if (next.courierId) this.tripsByCourier.set(next.courierId, (this.tripsByCourier.get(next.courierId) ?? new Set()).add(id));
    }
    return { ...next };
  }

  async updateTripIf(id: string, expectState: TripState, patch: TripPatch, now: Date) {
    const t = this.trips.get(id);
    if (!t || t.state !== expectState) return null;
    return this.updateTrip(id, patch, now);
  }

  async findTrips(filter: { cityId?: string; courierId?: string; states?: readonly TripState[] }) {
    // Creation order either way (ids are `trip_<seq>`).
    const scope = filter.courierId
      ? [...(this.tripsByCourier.get(filter.courierId) ?? [])].sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))).map((id) => this.trips.get(id)!)
      : [...this.trips.values()];
    return scope
      .filter((t) => (!filter.cityId || t.cityId === filter.cityId) && (!filter.courierId || t.courierId === filter.courierId) && (!filter.states || filter.states.includes(t.state)))
      .map((t) => ({ ...t }));
  }

  async stopsOf(tripId: string) {
    return (this.stopIds.get(tripId) ?? []).map((id) => this.stops.get(id)!).sort((a, b) => a.seq - b.seq).map((s) => ({ ...s }));
  }

  async addStops(tripId: string, stops: readonly NewStop[]) {
    const existing = await this.stopsOf(tripId);
    let seq = existing.length ? Math.max(...existing.map((s) => s.seq)) + 1 : 0;
    for (const s of stops) {
      const stop: StopRecord = {
        id: this.id('stop'),
        tripId,
        seq,
        orderId: s.orderId ?? null,
        type: s.type,
        state: 'pending',
        placeId: s.placeId ?? null,
        meetingPointId: s.meetingPointId ?? null,
        zoneKey: s.zoneKey,
        target: s.target ?? null,
        windowStart: s.windowStart ?? null,
        windowEnd: s.windowEnd ?? null,
        geofenceEnteredAt: null,
        courierNearAt: null,
        arrivedAt: null,
        arrivedOutsideGeofence: false,
        arrivalPin: null,
        arrivalDistanceM: null,
        completedAt: null,
        skippedAt: null,
        skipReason: null,
        handoverProof: {},
        childRef: s.childRef ?? null,
        childTapInAt: null,
        childTapOutAt: null,
      };
      this.stops.set(stop.id, stop);
      const ids = this.stopIds.get(tripId);
      if (ids) ids.push(stop.id);
      else this.stopIds.set(tripId, [stop.id]);
      seq += 1;
    }
    return this.stopsOf(tripId);
  }

  async updateStop(id: string, patch: StopPatch) {
    const s = this.stops.get(id);
    if (!s) throw new Error(`stop ${id} not found`);
    const next = { ...s, ...patch };
    this.stops.set(id, next);
    return { ...next };
  }

  async linksOf(tripId: string) {
    return (this.linksByTrip.get(tripId) ?? []).map((l) => ({ ...l }));
  }

  async linksForOrder(orderId: string) {
    return (this.linksByOrder.get(orderId) ?? []).map((l) => ({ ...l }));
  }

  async attach(input: { tripId: string; orderId: string; at: Date; reason: string | null; changedBy: string | null; minVehicleClass: VehicleClass | null }) {
    if ((this.linksByTrip.get(input.tripId) ?? []).some((l) => l.orderId === input.orderId && l.attachedAt.getTime() === input.at.getTime())) {
      throw new Error('unique violation: trip_orders(trip_id, order_id, attached_at)');
    }
    const link: TripOrderRecord = { id: this.id('to'), tripId: input.tripId, orderId: input.orderId, attachedAt: input.at, detachedAt: null, reason: input.reason, changedBy: input.changedBy, minVehicleClass: input.minVehicleClass };
    this.links.push(link);
    for (const [m, k] of [[this.linksByTrip, link.tripId], [this.linksByOrder, link.orderId]] as const) {
      const list = m.get(k);
      if (list) list.push(link);
      else m.set(k, [link]);
    }
    return { ...link };
  }

  async detach(linkId: string, input: { at: Date; reason: string; changedBy: string | null }) {
    const link = [...this.linksByTrip.values()].flat().find((l) => l.id === linkId);
    if (!link) throw new Error(`trip_order ${linkId} not found`);
    link.detachedAt = input.at;
    link.reason = input.reason;
    link.changedBy = input.changedBy;
    return { ...link };
  }

  async addTrailPoint(point: TrailPointRecord) {
    const p = { ...point };
    this.trail.push(p);
    // The latest by `at` (ties: the later write), as the scan picked it.
    const later = (prev: TrailPointRecord | undefined) => !prev || p.at.getTime() >= prev.at.getTime();
    if (p.tripId && later(this.lastByTrip.get(p.tripId))) this.lastByTrip.set(p.tripId, p);
    if (later(this.lastByDriver.get(p.driverId))) this.lastByDriver.set(p.driverId, p);
  }

  async lastTrailPoint(filter: { tripId?: string; driverId?: string }) {
    const last = filter.tripId ? this.lastByTrip.get(filter.tripId) : filter.driverId !== undefined ? this.lastByDriver.get(filter.driverId) : undefined;
    return last ? { ...last } : null;
  }

  async purgeTrail(cutoff: Date, keepTripIds: readonly string[], batch: number): Promise<number> {
    const keep = new Set(keepTripIds);
    const doomed = new Set(this.trail.filter((p) => p.at.getTime() < cutoff.getTime() && !(p.tripId && keep.has(p.tripId))).slice(0, batch));
    if (doomed.size === 0) return 0;
    const kept = this.trail.filter((p) => !doomed.has(p));
    this.trail.splice(0, this.trail.length, ...kept);
    for (const [k, p] of [...this.lastByTrip]) if (doomed.has(p)) this.lastByTrip.delete(k);
    for (const [k, p] of [...this.lastByDriver]) if (doomed.has(p)) this.lastByDriver.delete(k);
    return doomed.size;
  }

  async detachedAt(tripId: string, orderId: string): Promise<Date | null> {
    const latest = (this.linksByTrip.get(tripId) ?? []).filter((l) => l.orderId === orderId).sort((a, b) => b.attachedAt.getTime() - a.attachedAt.getTime())[0];
    return latest?.detachedAt ?? null;
  }
}
