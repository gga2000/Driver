import type { VehicleClass } from '@driver/contracts';
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
  createVehicle(input: { plate: string; vehicleClass: VehicleClass; ownerOrgId: string; seats?: number }, tx?: Tx): Promise<VehicleRecord>;
  /** Sets the vehicle's active driver (null unassigns); the driver leaves any other vehicle of the fleet. */
  setActiveDriver(vehicleId: string, driverId: string | null, tx?: Tx): Promise<VehicleRecord>;
  drivers(fleetOrgId: string, tx?: Tx): Promise<FleetDriverRecord[]>;
  /** Idempotent: an existing live link is returned; a removed one comes back as a new, pending invite. */
  addDriver(input: { fleetOrgId: string; personId: string; addedById: string; at: Date }, tx?: Tx): Promise<FleetDriverRecord>;
  /** A driver's live links (pending invites and accepted fleets). */
  linksOf(personId: string, tx?: Tx): Promise<FleetDriverRecord[]>;
  /** Accepts (acceptedAt = at) or ends (removedAt = at) a live link; null when there is none. */
  answerLink(input: { fleetOrgId: string; personId: string; accept: boolean; at: Date }, tx?: Tx): Promise<FleetDriverRecord | null>;
}

export const FLEET_REPOSITORY = Symbol('FLEET_REPOSITORY');

export class InMemoryFleetRepository implements FleetRepository {
  readonly vehicleRows = new Map<string, VehicleRecord>();
  readonly driverRows: FleetDriverRecord[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async vehicles(fleetOrgId: string): Promise<VehicleRecord[]> {
    return [...this.vehicleRows.values()].filter((v) => v.ownerOrgId === fleetOrgId).map((v) => ({ ...v }));
  }

  async vehicle(id: string): Promise<VehicleRecord | null> {
    const v = this.vehicleRows.get(id);
    return v ? { ...v } : null;
  }

  async vehicleByPlate(plate: string): Promise<VehicleRecord | null> {
    const v = [...this.vehicleRows.values()].find((x) => x.plate === plate);
    return v ? { ...v } : null;
  }

  async activeVehicleOf(driverId: string): Promise<VehicleRecord | null> {
    const v = [...this.vehicleRows.values()].reverse().find((x) => x.activeDriverId === driverId && x.active);
    return v ? { ...v } : null;
  }

  async createVehicle(input: { plate: string; vehicleClass: VehicleClass; ownerOrgId: string; seats?: number }): Promise<VehicleRecord> {
    if (await this.vehicleByPlate(input.plate)) throw new Error('unique violation: vehicles.plate');
    const seats = input.seats ?? DEFAULT_SEATS[input.vehicleClass];
    const v: VehicleRecord = { id: this.id('veh'), plate: input.plate, vehicleClass: input.vehicleClass, ownerOrgId: input.ownerOrgId, activeDriverId: null, active: true, seats };
    this.vehicleRows.set(v.id, v);
    return { ...v };
  }

  async setActiveDriver(vehicleId: string, driverId: string | null): Promise<VehicleRecord> {
    const v = this.vehicleRows.get(vehicleId);
    if (!v) throw new Error(`vehicle ${vehicleId} not found`);
    if (driverId) for (const o of this.vehicleRows.values()) if (o.id !== vehicleId && o.ownerOrgId === v.ownerOrgId && o.activeDriverId === driverId) o.activeDriverId = null;
    v.activeDriverId = driverId;
    return { ...v };
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

  async answerLink(input: { fleetOrgId: string; personId: string; accept: boolean; at: Date }): Promise<FleetDriverRecord | null> {
    const row = this.driverRows.find((d) => d.fleetOrgId === input.fleetOrgId && d.personId === input.personId && d.removedAt === null);
    if (!row) return null;
    if (input.accept) row.acceptedAt ??= input.at;
    else Object.assign(row, { removedAt: input.at, acceptedAt: null });
    return { ...row };
  }
}

type VehicleRow = { id: string; plate: string; class: string; ownerOrgId: string | null; activeDriverId: string | null; active: boolean; seatMap?: unknown };

function vehicleFromRow(r: VehicleRow): VehicleRecord {
  const seats = Array.isArray(r.seatMap) ? r.seatMap.length : DEFAULT_SEATS[r.class as VehicleClass] ?? 0;
  return { id: r.id, plate: r.plate, vehicleClass: r.class as VehicleClass, ownerOrgId: r.ownerOrgId, activeDriverId: r.activeDriverId, active: r.active, seats };
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

  async createVehicle(input: { plate: string; vehicleClass: VehicleClass; ownerOrgId: string; seats?: number }, tx?: Tx): Promise<VehicleRecord> {
    const seatMap = seatMapFor(input.seats ?? DEFAULT_SEATS[input.vehicleClass]);
    return vehicleFromRow(await this.db(tx).vehicle.create({ data: { plate: input.plate, class: input.vehicleClass, ownerOrgId: input.ownerOrgId, seatMap } }));
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

  async answerLink(input: { fleetOrgId: string; personId: string; accept: boolean; at: Date }, tx?: Tx): Promise<FleetDriverRecord | null> {
    const db = this.db(tx);
    const row = await db.fleetDriver.findFirst({ where: { fleetOrgId: input.fleetOrgId, personId: input.personId, removedAt: null } });
    if (!row) return null;
    if (input.accept) return row.acceptedAt ? row : db.fleetDriver.update({ where: { id: row.id }, data: { acceptedAt: input.at } });
    return db.fleetDriver.update({ where: { id: row.id }, data: { removedAt: input.at, acceptedAt: null } });
  }
}
