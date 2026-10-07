import { sortFeatures, VehicleColour, VehicleFeature, type VehicleClass } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** A row of `vehicles` owned by a fleet org (the fleet module is the registry's owner). */
export interface VehicleRecord {
  id: string;
  plate: string;
  vehicleClass: VehicleClass;
  ownerOrgId: string | null;
  activeDriverId: string | null;
  active: boolean;
  /** Passenger seats: the length of the vehicle's seat map. */
  seats: number;
  /** Ops check of a fleet owner's new vehicle (Console approvals queue); absent = verified. */
  reviewState?: 'pending' | 'verified' | 'rejected';
  createdAt?: Date;
  /** Last change (the features check queue waits longest-first by it). */
  updatedAt?: Date;
  /** "Toyota Corolla"; null on older rows (ride step 3, d1). */
  model: string | null;
  colour: VehicleColour | null;
  /** The driver's claims (n1, n2), in display order. */
  features: VehicleFeature[];
  /** The claims ops confirmed at the car check (a subset of `features`), in display order. */
  featuresConfirmed: VehicleFeature[];
}

/** What a new vehicle is registered with. */
export interface NewVehicle {
  plate: string;
  vehicleClass: VehicleClass;
  /** Null: a driver's own car, registered by ops (no fleet). */
  ownerOrgId: string | null;
  seats?: number | undefined;
  model?: string | null | undefined;
  colour?: VehicleColour | null | undefined;
}

/** The two feature lists a vehicle carries. */
export type VehicleFeatures = Pick<VehicleRecord, 'features' | 'featuresConfirmed'>;

/** The driver's edit: what he claims now; a confirmation survives only on what he still claims. */
export function claimFeatures(v: Pick<VehicleRecord, 'featuresConfirmed'>, features: readonly VehicleFeature[]): VehicleFeatures {
  const claimed = sortFeatures(features);
  return { features: claimed, featuresConfirmed: v.featuresConfirmed.filter((f) => claimed.includes(f)) };
}

/** The car check: what ops saw becomes confirmed, and a claim they did not see is cleared. */
export function checkFeatures(v: Pick<VehicleRecord, 'features'>, seen: readonly VehicleFeature[]): VehicleFeatures {
  const confirmed = v.features.filter((f) => seen.includes(f));
  return { features: confirmed, featuresConfirmed: [...confirmed] };
}

/** Claims the car check has not confirmed yet. */
export function unconfirmedFeatures(v: VehicleFeatures): VehicleFeature[] {
  return v.features.filter((f) => !v.featuresConfirmed.includes(f));
}

/** Default passenger seats by class (edge-case §9: saloon 4, SUV 6, van 7/11). */
export const DEFAULT_SEATS: Record<VehicleClass, number> = { bike: 0, tuktuk: 3, car: 4, suv: 6, van: 7, intercity: 4 };

/** A plain seat map for `seats` seats: the front passenger seat, then rows of three. */
export function seatMapFor(seats: number): Array<{ position: number; row: number }> {
  return Array.from({ length: seats }, (_, i) => ({ position: i + 1, row: i === 0 ? 0 : Math.floor((i - 1) / 3) + 1 }));
}

/** `fleet_drivers`: a driver working for a fleet. */
export interface FleetDriverRecord {
  id: string;
  fleetOrgId: string;
  personId: string;
  addedById: string;
  /** The driver's yes (`fleet.respondInvite`); null while the invite is pending. */
  acceptedAt: Date | null;
  removedAt: Date | null;
  createdAt: Date;
}

export interface FleetRepository {
  vehicles(fleetOrgId: string, tx?: Tx): Promise<VehicleRecord[]>;
  vehicle(id: string, tx?: Tx): Promise<VehicleRecord | null>;
  vehicleByPlate(plate: string, tx?: Tx): Promise<VehicleRecord | null>;
  /** The active vehicle `driverId` is the active driver of (latest first); null when none. */
  activeVehicleOf?(driverId: string, tx?: Tx): Promise<VehicleRecord | null>;
  /** Batched `activeVehicleOf` (one query): each driver's latest active vehicle; drivers without one are left out. */
  activeVehiclesOf?(driverIds: readonly string[], tx?: Tx): Promise<Map<string, VehicleRecord>>;
  createVehicle(input: NewVehicle, tx?: Tx): Promise<VehicleRecord>;
  /** Sets the vehicle's active driver (null unassigns); the driver leaves any other vehicle of the fleet. */
  setActiveDriver(vehicleId: string, driverId: string | null, tx?: Tx): Promise<VehicleRecord>;
  drivers(fleetOrgId: string, tx?: Tx): Promise<FleetDriverRecord[]>;
  /** Idempotent: an existing live link is returned; a removed one comes back as a new, pending invite. */
  addDriver(input: { fleetOrgId: string; personId: string; addedById: string; at: Date }, tx?: Tx): Promise<FleetDriverRecord>;
  /** A driver's live links (pending invites and accepted fleets). */
  linksOf(personId: string, tx?: Tx): Promise<FleetDriverRecord[]>;
  /** Accepts (acceptedAt = at) or ends (removedAt = at) a live link; null when there is none. */
  answerLink(input: { fleetOrgId: string; personId: string; accept: boolean; at: Date }, tx?: Tx): Promise<FleetDriverRecord | null>;
  /** New fleet vehicles waiting for the ops check, oldest first. */
  vehiclesInReview(limit: number, tx?: Tx): Promise<VehicleRecord[]>;
  /**
   * Records the ops decision while still pending (null otherwise); a rejected vehicle goes inactive,
   * unassigned. `features` (an approval's car check, `checkFeatures`) is written with it.
   */
  reviewVehicle(id: string, input: { verified: boolean; by: string; at: Date; note: string | null; features?: VehicleFeatures | undefined }, tx?: Tx): Promise<VehicleRecord | null>;
  /** Writes the vehicle's claimed and confirmed features (`claimFeatures` / `checkFeatures` decide them). */
  setFeatures(id: string, features: VehicleFeatures, at: Date, tx?: Tx): Promise<VehicleRecord>;
  /** Verified, active vehicles with claims the car check has not confirmed, longest-waiting first. */
  vehiclesWithUnconfirmedFeatures(limit: number, tx?: Tx): Promise<VehicleRecord[]>;
}

export const FLEET_REPOSITORY = Symbol('FLEET_REPOSITORY');

function copy(v: VehicleRecord): VehicleRecord {
  return { ...v, features: [...v.features], featuresConfirmed: [...v.featuresConfirmed] };
}

export class InMemoryFleetRepository implements FleetRepository {
  readonly vehicleRows = new Map<string, VehicleRecord>();
  readonly driverRows: FleetDriverRecord[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async vehicles(fleetOrgId: string): Promise<VehicleRecord[]> {
    return [...this.vehicleRows.values()].filter((v) => v.ownerOrgId === fleetOrgId).map(copy);
  }

  async vehicle(id: string): Promise<VehicleRecord | null> {
    const v = this.vehicleRows.get(id);
    return v ? copy(v) : null;
  }

  async vehicleByPlate(plate: string): Promise<VehicleRecord | null> {
    const v = [...this.vehicleRows.values()].find((x) => x.plate === plate);
    return v ? copy(v) : null;
  }

  async activeVehicleOf(driverId: string): Promise<VehicleRecord | null> {
    const v = [...this.vehicleRows.values()].reverse().find((x) => x.activeDriverId === driverId && x.active);
    return v ? copy(v) : null;
  }

  async activeVehiclesOf(driverIds: readonly string[]): Promise<Map<string, VehicleRecord>> {
    const out = new Map<string, VehicleRecord>();
    for (const id of new Set(driverIds)) {
      const v = await this.activeVehicleOf(id);
      if (v) out.set(id, v);
    }
    return out;
  }

  async createVehicle(input: NewVehicle): Promise<VehicleRecord> {
    if (await this.vehicleByPlate(input.plate)) throw new Error('unique violation: vehicles.plate');
    const seats = input.seats ?? DEFAULT_SEATS[input.vehicleClass];
    const now = new Date();
    const v: VehicleRecord = {
      id: this.id('veh'),
      plate: input.plate,
      vehicleClass: input.vehicleClass,
      ownerOrgId: input.ownerOrgId,
      activeDriverId: null,
      active: true,
      seats,
      reviewState: 'pending',
      createdAt: now,
      updatedAt: now,
      model: input.model ?? null,
      colour: input.colour ?? null,
      features: [],
      featuresConfirmed: [],
    };
    this.vehicleRows.set(v.id, v);
    return copy(v);
  }

  async setActiveDriver(vehicleId: string, driverId: string | null): Promise<VehicleRecord> {
    const v = this.vehicleRows.get(vehicleId);
    if (!v) throw new Error(`vehicle ${vehicleId} not found`);
    if (driverId) for (const o of this.vehicleRows.values()) if (o.id !== vehicleId && o.ownerOrgId === v.ownerOrgId && o.activeDriverId === driverId) o.activeDriverId = null;
    v.activeDriverId = driverId;
    return copy(v);
  }

  async drivers(fleetOrgId: string): Promise<FleetDriverRecord[]> {
    return this.driverRows.filter((d) => d.fleetOrgId === fleetOrgId && d.removedAt === null).map((d) => ({ ...d }));
  }

  async addDriver(input: { fleetOrgId: string; personId: string; addedById: string; at: Date }): Promise<FleetDriverRecord> {
    const existing = this.driverRows.find((d) => d.fleetOrgId === input.fleetOrgId && d.personId === input.personId);
    if (existing) {
      if (existing.removedAt) Object.assign(existing, { removedAt: null, acceptedAt: null, addedById: input.addedById, createdAt: input.at });
      return { ...existing };
    }
    const row: FleetDriverRecord = { id: this.id('fdrv'), fleetOrgId: input.fleetOrgId, personId: input.personId, addedById: input.addedById, acceptedAt: null, removedAt: null, createdAt: input.at };
    this.driverRows.push(row);
    return { ...row };
  }

  async linksOf(personId: string): Promise<FleetDriverRecord[]> {
    return this.driverRows.filter((d) => d.personId === personId && d.removedAt === null).map((d) => ({ ...d }));
  }

  async vehiclesInReview(limit: number): Promise<VehicleRecord[]> {
    return [...this.vehicleRows.values()].filter((v) => v.reviewState === 'pending').slice(0, limit).map(copy);
  }

  async reviewVehicle(id: string, input: { verified: boolean; by: string; at: Date; note: string | null; features?: VehicleFeatures | undefined }): Promise<VehicleRecord | null> {
    const v = this.vehicleRows.get(id);
    if (!v || v.reviewState !== 'pending') return null;
    v.reviewState = input.verified ? 'verified' : 'rejected';
    v.updatedAt = input.at;
    if (!input.verified) Object.assign(v, { active: false, activeDriverId: null });
    else if (input.features) Object.assign(v, { features: [...input.features.features], featuresConfirmed: [...input.features.featuresConfirmed] });
    return copy(v);
  }

  async setFeatures(id: string, features: VehicleFeatures, at: Date): Promise<VehicleRecord> {
    const v = this.vehicleRows.get(id);
    if (!v) throw new Error(`vehicle ${id} not found`);
    Object.assign(v, { features: [...features.features], featuresConfirmed: [...features.featuresConfirmed], updatedAt: at });
    return copy(v);
  }

  async vehiclesWithUnconfirmedFeatures(limit: number): Promise<VehicleRecord[]> {
    return [...this.vehicleRows.values()]
      .filter((v) => (v.reviewState ?? 'verified') === 'verified' && v.active && unconfirmedFeatures(v).length > 0)
      .sort((a, b) => (a.updatedAt?.getTime() ?? 0) - (b.updatedAt?.getTime() ?? 0))
      .slice(0, limit)
      .map(copy);
  }

  async answerLink(input: { fleetOrgId: string; personId: string; accept: boolean; at: Date }): Promise<FleetDriverRecord | null> {
    const row = this.driverRows.find((d) => d.fleetOrgId === input.fleetOrgId && d.personId === input.personId && d.removedAt === null);
    if (!row) return null;
    if (input.accept) row.acceptedAt ??= input.at;
    else Object.assign(row, { removedAt: input.at, acceptedAt: null });
    return { ...row };
  }
}

type VehicleRow = {
  id: string;
  plate: string;
  class: string;
  ownerOrgId: string | null;
  activeDriverId: string | null;
  active: boolean;
  seatMap?: unknown;
  reviewState?: string;
  createdAt?: Date;
  updatedAt?: Date;
  model?: string | null;
  colour?: string | null;
  features?: string[];
  featuresConfirmed?: string[];
};

/** Known features only, in display order (the column is plain text[]; a check constraint keeps it clean). */
function featuresFrom(raw: readonly string[] | undefined): VehicleFeature[] {
  return sortFeatures((raw ?? []).filter((f): f is VehicleFeature => VehicleFeature.safeParse(f).success));
}

export function vehicleFromRow(r: VehicleRow): VehicleRecord {
  const seats = Array.isArray(r.seatMap) ? r.seatMap.length : DEFAULT_SEATS[r.class as VehicleClass] ?? 0;
  const reviewState = r.reviewState === 'pending' || r.reviewState === 'rejected' ? r.reviewState : 'verified';
  const colour = VehicleColour.safeParse(r.colour);
  return {
    id: r.id,
    plate: r.plate,
    vehicleClass: r.class as VehicleClass,
    ownerOrgId: r.ownerOrgId,
    activeDriverId: r.activeDriverId,
    active: r.active,
    seats,
    reviewState,
    ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}),
    model: r.model ?? null,
    colour: colour.success ? colour.data : null,
    features: featuresFrom(r.features),
    featuresConfirmed: featuresFrom(r.featuresConfirmed),
  };
}

/**
 * `vehicles` + `fleet_drivers`. `vehicles.owner_org_id` references `orgs`, so a fleet must exist as an
 * `orgs` row (seeded / created in the Console) before vehicles are added with a database.
 */
export class PrismaFleetRepository implements FleetRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async vehicles(fleetOrgId: string, tx?: Tx): Promise<VehicleRecord[]> {
    return (await this.db(tx).vehicle.findMany({ where: { ownerOrgId: fleetOrgId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(vehicleFromRow);
  }

  async vehicle(id: string, tx?: Tx): Promise<VehicleRecord | null> {
    const r = await this.db(tx).vehicle.findUnique({ where: { id } });
    return r ? vehicleFromRow(r) : null;
  }

  async vehicleByPlate(plate: string, tx?: Tx): Promise<VehicleRecord | null> {
    const r = await this.db(tx).vehicle.findUnique({ where: { plate } });
    return r ? vehicleFromRow(r) : null;
  }

  async activeVehicleOf(driverId: string, tx?: Tx): Promise<VehicleRecord | null> {
    const r = await this.db(tx).vehicle.findFirst({ where: { activeDriverId: driverId, active: true }, orderBy: { updatedAt: 'desc' } });
    return r ? vehicleFromRow(r) : null;
  }

  async activeVehiclesOf(driverIds: readonly string[], tx?: Tx): Promise<Map<string, VehicleRecord>> {
    const out = new Map<string, VehicleRecord>();
    if (driverIds.length === 0) return out;
    const rows = await this.db(tx).vehicle.findMany({ where: { activeDriverId: { in: [...driverIds] }, active: true }, orderBy: { updatedAt: 'desc' } });
    for (const r of rows) if (r.activeDriverId && !out.has(r.activeDriverId)) out.set(r.activeDriverId, vehicleFromRow(r));
    return out;
  }

  async createVehicle(input: NewVehicle, tx?: Tx): Promise<VehicleRecord> {
    const seatMap = seatMapFor(input.seats ?? DEFAULT_SEATS[input.vehicleClass]);
    // A fleet owner's new vehicle waits for the ops check (Console approvals queue); it can work meanwhile.
    return vehicleFromRow(
      await this.db(tx).vehicle.create({
        data: { plate: input.plate, class: input.vehicleClass, ownerOrgId: input.ownerOrgId, seatMap, reviewState: 'pending', model: input.model ?? null, colour: input.colour ?? null },
      }),
    );
  }

  async setActiveDriver(vehicleId: string, driverId: string | null, tx?: Tx): Promise<VehicleRecord> {
    const db = this.db(tx);
    const v = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    if (driverId) await db.vehicle.updateMany({ where: { ownerOrgId: v.ownerOrgId, activeDriverId: driverId, NOT: { id: vehicleId } }, data: { activeDriverId: null } });
    return vehicleFromRow(await db.vehicle.update({ where: { id: vehicleId }, data: { activeDriverId: driverId } }));
  }

  async drivers(fleetOrgId: string, tx?: Tx): Promise<FleetDriverRecord[]> {
    return this.db(tx).fleetDriver.findMany({ where: { fleetOrgId, removedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async addDriver(input: { fleetOrgId: string; personId: string; addedById: string; at: Date }, tx?: Tx): Promise<FleetDriverRecord> {
    return this.db(tx).fleetDriver.upsert({
      where: { fleetOrgId_personId: { fleetOrgId: input.fleetOrgId, personId: input.personId } },
      create: { fleetOrgId: input.fleetOrgId, personId: input.personId, addedById: input.addedById, createdAt: input.at },
      update: {},
    }).then(async (row) => {
      if (!row.removedAt) return row;
      // A removed link comes back as a fresh invite: the driver says yes again.
      return this.db(tx).fleetDriver.update({ where: { id: row.id }, data: { removedAt: null, acceptedAt: null, addedById: input.addedById, createdAt: input.at } });
    });
  }

  async linksOf(personId: string, tx?: Tx): Promise<FleetDriverRecord[]> {
    return this.db(tx).fleetDriver.findMany({ where: { personId, removedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async vehiclesInReview(limit: number, tx?: Tx): Promise<VehicleRecord[]> {
    return (await this.db(tx).vehicle.findMany({ where: { reviewState: 'pending' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit })).map(vehicleFromRow);
  }

  async reviewVehicle(id: string, input: { verified: boolean; by: string; at: Date; note: string | null; features?: VehicleFeatures | undefined }, tx?: Tx): Promise<VehicleRecord | null> {
    const checked = input.verified && input.features ? { features: input.features.features, featuresConfirmed: input.features.featuresConfirmed } : {};
    const res = await this.db(tx).vehicle.updateMany({
      where: { id, reviewState: 'pending' },
      data: { reviewState: input.verified ? 'verified' : 'rejected', reviewedById: input.by, reviewedAt: input.at, reviewNote: input.note, ...(input.verified ? checked : { active: false, activeDriverId: null }) },
    });
    if (res.count !== 1) return null;
    return this.vehicle(id, tx);
  }

  async setFeatures(id: string, features: VehicleFeatures, _at: Date, tx?: Tx): Promise<VehicleRecord> {
    return vehicleFromRow(await this.db(tx).vehicle.update({ where: { id }, data: { features: features.features, featuresConfirmed: features.featuresConfirmed } }));
  }

  async vehiclesWithUnconfirmedFeatures(limit: number, tx?: Tx): Promise<VehicleRecord[]> {
    // `features <@ features_confirmed` is false exactly when a claim is still waiting for the car check.
    const ids = await this.db(tx).$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "public"."vehicles"
      WHERE "review_state" = 'verified' AND "active" AND NOT ("features" <@ "features_confirmed")
      ORDER BY "updated_at" ASC, "id" ASC
      LIMIT ${limit}`;
    if (ids.length === 0) return [];
    const rows = await this.db(tx).vehicle.findMany({ where: { id: { in: ids.map((r) => r.id) } } });
    const byId = new Map(rows.map((r) => [r.id, vehicleFromRow(r)]));
    return ids.map((r) => byId.get(r.id)).filter((v): v is VehicleRecord => v !== undefined);
  }

  async answerLink(input: { fleetOrgId: string; personId: string; accept: boolean; at: Date }, tx?: Tx): Promise<FleetDriverRecord | null> {
    const db = this.db(tx);
    const row = await db.fleetDriver.findFirst({ where: { fleetOrgId: input.fleetOrgId, personId: input.personId, removedAt: null } });
    if (!row) return null;
    if (input.accept) return row.acceptedAt ? row : db.fleetDriver.update({ where: { id: row.id }, data: { acceptedAt: input.at } });
    return db.fleetDriver.update({ where: { id: row.id }, data: { removedAt: input.at, acceptedAt: null } });
  }
}
