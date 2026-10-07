import { randomUUID } from 'node:crypto';
import { baghdadMinuteOfDay, DeliveryPoint, RegularTripPlan, type CalendarDate, type FavouriteKind, type RegularRemind, type RideFootprint } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** A rider's favourite driver (`favourite_drivers`): ids and the kinds of trips only. */
export interface FavouriteRecord {
  id: string;
  personId: string;
  driverId: string;
  kinds: FavouriteKind[];
  createdAt: Date;
}

/** A regular trip (`regular_trips`). */
export interface RegularTripRecord {
  id: string;
  personId: string;
  days: number[];
  timeMin: number;
  remind: RegularRemind;
  paymentMethod: 'cash' | 'wallet';
  favouriteId: string | null;
  active: boolean;
  plan: RegularTripPlan;
  createdAt: Date;
}

export type NewRegularTrip = Omit<RegularTripRecord, 'id' | 'createdAt'>;

/** One day's decision on a regular trip (`regular_trip_occurrences`). */
export interface OccurrenceRecord {
  regularTripId: string;
  date: CalendarDate;
  state: 'confirmed' | 'skipped';
  orderId: string | null;
  bookingId: string | null;
  demandId: string | null;
  decidedAt: Date;
}

/**
 * Favourite drivers, regular trips and their decisions (public schema; ids only — names and photos
 * are read from the vault when shown). A write that loses a race returns what won.
 */
export interface RideHabitsRepository {
  favouritesOf(personId: string): Promise<FavouriteRecord[]>;
  favourite(personId: string, favouriteId: string): Promise<FavouriteRecord | null>;
  /** Adds the driver (or merges the kind into the existing row). */
  addFavourite(personId: string, driverId: string, kind: FavouriteKind, now: Date): Promise<FavouriteRecord>;
  removeFavourite(personId: string, driverId: string): Promise<void>;

  tripsOf(personId: string): Promise<RegularTripRecord[]>;
  trip(id: string): Promise<RegularTripRecord | null>;
  activeTrips(): Promise<RegularTripRecord[]>;
  createTrip(t: NewRegularTrip, now: Date): Promise<RegularTripRecord>;
  updateTrip(id: string, t: NewRegularTrip): Promise<RegularTripRecord>;
  deleteTrip(id: string): Promise<void>;

  /** Decisions of these trips from `fromDate` on. */
  decisions(tripIds: readonly string[], fromDate: CalendarDate): Promise<OccurrenceRecord[]>;
  decision(tripId: string, date: CalendarDate): Promise<OccurrenceRecord | null>;
  /** The first decision for a day wins; returns the stored one. */
  decide(o: OccurrenceRecord): Promise<OccurrenceRecord>;

  /** Step 4 (o4): one ride's footprint (`ride_footprints`, one per order: a repeat changes nothing). */
  addFootprint(personId: string, f: RideFootprint): Promise<void>;
  /**
   * Footprints wanted at or after `since` whose Baghdad minute of the day is in `[fromMin, toMin]`, with
   * their riders: the slice of the day the «نفس مشوار البارحة؟» job looks at.
   */
  footprintsAround(since: Date, fromMin: number, toMin: number): Promise<Array<RideFootprint & { personId: string }>>;
  /** One rider's footprints wanted at or after `since`. */
  footprintsOf(personId: string, since: Date): Promise<RideFootprint[]>;
}

export const RIDE_HABITS_REPOSITORY = Symbol('RIDE_HABITS_REPOSITORY');

const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

export class InMemoryRideHabitsRepository implements RideHabitsRepository {
  private readonly favs: FavouriteRecord[] = [];
  private readonly trips = new Map<string, RegularTripRecord>();
  private readonly occ = new Map<string, OccurrenceRecord>();
  private readonly prints = new Map<string, RideFootprint & { personId: string }>();

  async favouritesOf(personId: string): Promise<FavouriteRecord[]> {
    return this.favs.filter((f) => f.personId === personId).map((f) => ({ ...f, kinds: [...f.kinds] }));
  }
  async favourite(personId: string, favouriteId: string): Promise<FavouriteRecord | null> {
    const f = this.favs.find((x) => x.id === favouriteId && x.personId === personId);
    return f ? { ...f, kinds: [...f.kinds] } : null;
  }
  async addFavourite(personId: string, driverId: string, kind: FavouriteKind, now: Date): Promise<FavouriteRecord> {
    let f = this.favs.find((x) => x.personId === personId && x.driverId === driverId);
    if (!f) {
      f = { id: newId('fav'), personId, driverId, kinds: [], createdAt: now };
      this.favs.push(f);
    }
    if (!f.kinds.includes(kind)) f.kinds.push(kind);
    return { ...f, kinds: [...f.kinds] };
  }
  async removeFavourite(personId: string, driverId: string): Promise<void> {
    const i = this.favs.findIndex((x) => x.personId === personId && x.driverId === driverId);
    if (i < 0) return;
    const [gone] = this.favs.splice(i, 1);
    for (const t of this.trips.values()) if (t.favouriteId === gone!.id) t.favouriteId = null;
  }

  async tripsOf(personId: string): Promise<RegularTripRecord[]> {
    return [...this.trips.values()].filter((t) => t.personId === personId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(copyTrip);
  }
  async trip(id: string): Promise<RegularTripRecord | null> {
    const t = this.trips.get(id);
    return t ? copyTrip(t) : null;
  }
  async activeTrips(): Promise<RegularTripRecord[]> {
    return [...this.trips.values()].filter((t) => t.active).map(copyTrip);
  }
  async createTrip(t: NewRegularTrip, now: Date): Promise<RegularTripRecord> {
    const rec: RegularTripRecord = { ...t, id: newId('rgt'), createdAt: now };
    this.trips.set(rec.id, rec);
    return copyTrip(rec);
  }
  async updateTrip(id: string, t: NewRegularTrip): Promise<RegularTripRecord> {
    const prior = this.trips.get(id);
    if (!prior) throw new Error(`no regular trip ${id}`);
    const rec: RegularTripRecord = { ...t, id, createdAt: prior.createdAt };
    this.trips.set(id, rec);
    return copyTrip(rec);
  }
  async deleteTrip(id: string): Promise<void> {
    this.trips.delete(id);
    for (const k of [...this.occ.keys()]) if (k.startsWith(`${id}|`)) this.occ.delete(k);
  }

  async decisions(tripIds: readonly string[], fromDate: CalendarDate): Promise<OccurrenceRecord[]> {
    return [...this.occ.values()].filter((o) => tripIds.includes(o.regularTripId) && o.date >= fromDate).map((o) => ({ ...o }));
  }
  async decision(tripId: string, date: CalendarDate): Promise<OccurrenceRecord | null> {
    const o = this.occ.get(`${tripId}|${date}`);
    return o ? { ...o } : null;
  }
  async decide(o: OccurrenceRecord): Promise<OccurrenceRecord> {
    const key = `${o.regularTripId}|${o.date}`;
    const prior = this.occ.get(key);
    if (prior) return { ...prior };
    this.occ.set(key, { ...o });
    return { ...o };
  }

  async addFootprint(personId: string, f: RideFootprint): Promise<void> {
    if (!this.prints.has(f.orderId)) this.prints.set(f.orderId, { ...structuredClone(f), personId });
  }
  async footprintsAround(since: Date, fromMin: number, toMin: number): Promise<Array<RideFootprint & { personId: string }>> {
    return [...this.prints.values()]
      .filter((f) => f.at >= since && baghdadMinuteOfDay(f.at) >= fromMin && baghdadMinuteOfDay(f.at) <= toMin)
      .map((f) => structuredClone(f));
  }
  async footprintsOf(personId: string, since: Date): Promise<RideFootprint[]> {
    return [...this.prints.values()].filter((f) => f.personId === personId && f.at >= since).map((f) => withoutPerson(structuredClone(f)));
  }
}

function withoutPerson(f: RideFootprint & { personId: string }): RideFootprint {
  return { orderId: f.orderId, vertical: f.vertical, doorPickup: f.doorPickup, pickup: f.pickup, dropoff: f.dropoff, at: f.at };
}

function copyTrip(t: RegularTripRecord): RegularTripRecord {
  return { ...t, days: [...t.days], plan: structuredClone(t.plan) };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

type FavRow = { id: string; personId: string; driverId: string; kinds: string[]; createdAt: Date };
const favOf = (r: FavRow): FavouriteRecord => ({ id: r.id, personId: r.personId, driverId: r.driverId, kinds: r.kinds.filter((k): k is FavouriteKind => k === 'taxi' || k === 'tuktuk' || k === 'intercity'), createdAt: r.createdAt });

type TripRow = { id: string; personId: string; days: number[]; timeMin: number; remind: string; paymentMethod: string; favouriteId: string | null; active: boolean; plan: unknown; createdAt: Date };
const tripOf = (r: TripRow): RegularTripRecord => ({
  id: r.id,
  personId: r.personId,
  days: [...r.days],
  timeMin: r.timeMin,
  remind: r.remind === 'morning' ? 'morning' : 'evening',
  paymentMethod: r.paymentMethod === 'wallet' ? 'wallet' : 'cash',
  favouriteId: r.favouriteId,
  active: r.active,
  plan: RegularTripPlan.parse(r.plan),
  createdAt: r.createdAt,
});

type OccRow = { regularTripId: string; date: string; state: string; orderId: string | null; bookingId: string | null; demandId: string | null; decidedAt: Date };
const occOf = (r: OccRow): OccurrenceRecord => ({ regularTripId: r.regularTripId, date: r.date, state: r.state === 'skipped' ? 'skipped' : 'confirmed', orderId: r.orderId, bookingId: r.bookingId, demandId: r.demandId, decidedAt: r.decidedAt });

type PrintRow = { orderId: string; personId: string; vertical: string; doorPickup: boolean; pickup: unknown; dropoff: unknown; at: Date };
/** A stored end: the booked point with its pin (rows without one are never written). */
const End = DeliveryPoint.pick({ zoneKey: true, placeId: true }).extend({ pin: DeliveryPoint.shape.pin.unwrap() });
const printOf = (r: PrintRow): RideFootprint & { personId: string } => ({
  orderId: r.orderId,
  personId: r.personId,
  vertical: r.vertical === 'tuktuk' ? 'tuktuk' : 'taxi',
  doorPickup: r.doorPickup,
  pickup: End.parse(r.pickup),
  dropoff: End.parse(r.dropoff),
  at: r.at,
});

const tripData = (t: NewRegularTrip) => ({ personId: t.personId, kind: t.plan.kind, days: t.days, timeMin: t.timeMin, remind: t.remind, paymentMethod: t.paymentMethod, favouriteId: t.favouriteId, active: t.active, plan: t.plan });

export class PrismaRideHabitsRepository implements RideHabitsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Tx {
    return this.prisma.prisma as unknown as Tx;
  }

  async favouritesOf(personId: string): Promise<FavouriteRecord[]> {
    return (await this.db.favouriteDriver.findMany({ where: { personId }, orderBy: { createdAt: 'asc' } })).map(favOf);
  }
  async favourite(personId: string, favouriteId: string): Promise<FavouriteRecord | null> {
    const r = await this.db.favouriteDriver.findFirst({ where: { id: favouriteId, personId } });
    return r ? favOf(r) : null;
  }
  async addFavourite(personId: string, driverId: string, kind: FavouriteKind, now: Date): Promise<FavouriteRecord> {
    const where = { personId_driverId: { personId, driverId } };
    const prior = await this.db.favouriteDriver.findUnique({ where });
    if (!prior) {
      try {
        return favOf(await this.db.favouriteDriver.create({ data: { personId, driverId, kinds: [kind], createdAt: now } }));
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    const row = (await this.db.favouriteDriver.findUnique({ where }))!;
    if (row.kinds.includes(kind)) return favOf(row);
    return favOf(await this.db.favouriteDriver.update({ where, data: { kinds: [...row.kinds, kind] } }));
  }
  async removeFavourite(personId: string, driverId: string): Promise<void> {
    await this.db.favouriteDriver.deleteMany({ where: { personId, driverId } });
  }

  async tripsOf(personId: string): Promise<RegularTripRecord[]> {
    return (await this.db.regularTrip.findMany({ where: { personId }, orderBy: { createdAt: 'asc' } })).map(tripOf);
  }
  async trip(id: string): Promise<RegularTripRecord | null> {
    const r = await this.db.regularTrip.findUnique({ where: { id } });
    return r ? tripOf(r) : null;
  }
  async activeTrips(): Promise<RegularTripRecord[]> {
    return (await this.db.regularTrip.findMany({ where: { active: true } })).map(tripOf);
  }
  async createTrip(t: NewRegularTrip, now: Date): Promise<RegularTripRecord> {
    return tripOf(await this.db.regularTrip.create({ data: { ...tripData(t), createdAt: now } }));
  }
  async updateTrip(id: string, t: NewRegularTrip): Promise<RegularTripRecord> {
    return tripOf(await this.db.regularTrip.update({ where: { id }, data: tripData(t) }));
  }
  async deleteTrip(id: string): Promise<void> {
    await this.db.regularTrip.deleteMany({ where: { id } });
  }

  async decisions(tripIds: readonly string[], fromDate: CalendarDate): Promise<OccurrenceRecord[]> {
    if (tripIds.length === 0) return [];
    return (await this.db.regularTripOccurrence.findMany({ where: { regularTripId: { in: [...tripIds] }, date: { gte: fromDate } } })).map(occOf);
  }
  async decision(tripId: string, date: CalendarDate): Promise<OccurrenceRecord | null> {
    const r = await this.db.regularTripOccurrence.findUnique({ where: { regularTripId_date: { regularTripId: tripId, date } } });
    return r ? occOf(r) : null;
  }
  async decide(o: OccurrenceRecord): Promise<OccurrenceRecord> {
    try {
      return occOf(await this.db.regularTripOccurrence.create({ data: { regularTripId: o.regularTripId, date: o.date, state: o.state, orderId: o.orderId, bookingId: o.bookingId, demandId: o.demandId, decidedAt: o.decidedAt } }));
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return (await this.decision(o.regularTripId, o.date))!;
    }
  }

  async addFootprint(personId: string, f: RideFootprint): Promise<void> {
    await this.db.rideFootprint.createMany({
      data: [{ orderId: f.orderId, personId, vertical: f.vertical, doorPickup: f.doorPickup, pickup: f.pickup, dropoff: f.dropoff, at: f.at, minuteOfDay: baghdadMinuteOfDay(f.at) }],
      skipDuplicates: true,
    });
  }
  async footprintsAround(since: Date, fromMin: number, toMin: number): Promise<Array<RideFootprint & { personId: string }>> {
    return (await this.db.rideFootprint.findMany({ where: { at: { gte: since }, minuteOfDay: { gte: fromMin, lte: toMin } } })).map(printOf);
  }
  async footprintsOf(personId: string, since: Date): Promise<RideFootprint[]> {
    return (await this.db.rideFootprint.findMany({ where: { personId, at: { gte: since } }, orderBy: { at: 'desc' } })).map((r) => withoutPerson(printOf(r)));
  }
}
