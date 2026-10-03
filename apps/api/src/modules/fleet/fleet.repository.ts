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
}

/** `fleet_drivers`: a driver working for a fleet. */
export interface FleetDriverRecord {
  id: string;
  fleetOrgId: string;
  personId: string;
  addedById: string;
  removedAt: Date | null;
  createdAt: Date;
}

export interface FleetRepository {
  vehicles(fleetOrgId: string, tx?: Tx): Promise<VehicleRecord[]>;
  vehicle(id: string, tx?: Tx): Promise<VehicleRecord | null>;
  vehicleByPlate(plate: string, tx?: Tx): Promise<VehicleRecord | null>;
  createVehicle(input: { plate: string; vehicleClass: VehicleClass; ownerOrgId: string }, tx?: Tx): Promise<VehicleRecord>;
  /** Sets the vehicle's active driver (null unassigns); the driver leaves any other vehicle of the fleet. */
  setActiveDriver(vehicleId: string, driverId: string | null, tx?: Tx): Promise<VehicleRecord>;
  drivers(fleetOrgId: string, tx?: Tx): Promise<FleetDriverRecord[]>;
  /** Idempotent: an existing (or removed) link is returned (re-activated). */
  addDriver(input: { fleetOrgId: string; personId: string; addedById: string; at: Date }, tx?: Tx): Promise<FleetDriverRecord>;
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

  async createVehicle(input: { plate: string; vehicleClass: VehicleClass; ownerOrgId: string }): Promise<VehicleRecord> {
    if (await this.vehicleByPlate(input.plate)) throw new Error('unique violation: vehicles.plate');
    const v: VehicleRecord = { id: this.id('veh'), plate: input.plate, vehicleClass: input.vehicleClass, ownerOrgId: input.ownerOrgId, activeDriverId: null, active: true };
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
      existing.removedAt = null;
      return { ...existing };
    }
    const row: FleetDriverRecord = { id: this.id('fdrv'), fleetOrgId: input.fleetOrgId, personId: input.personId, addedById: input.addedById, removedAt: null, createdAt: input.at };
    this.driverRows.push(row);
    return { ...row };
  }
}

type VehicleRow = { id: string; plate: string; class: string; ownerOrgId: string | null; activeDriverId: string | null; active: boolean };

function vehicleFromRow(r: VehicleRow): VehicleRecord {
  return { id: r.id, plate: r.plate, vehicleClass: r.class as VehicleClass, ownerOrgId: r.ownerOrgId, activeDriverId: r.activeDriverId, active: r.active };
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

  async createVehicle(input: { plate: string; vehicleClass: VehicleClass; ownerOrgId: string }, tx?: Tx): Promise<VehicleRecord> {
    return vehicleFromRow(await this.db(tx).vehicle.create({ data: { plate: input.plate, class: input.vehicleClass, ownerOrgId: input.ownerOrgId } }));
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
      update: { removedAt: null },
    });
  }
}
