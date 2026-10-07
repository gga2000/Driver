import { sortFeatures, VehicleColour, VehicleFeature, type VehicleClass } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import { withoutOff, type OffNow } from './climate-checks.js';

/**
 * What riders are told about a driver's car before he accepts (ride step 3: n3 offered drivers, n5
 * profile) and what n6 / s6 / x1 rank on: the car's model and colour, the features ops CONFIRMED at the
 * car check (never the driver's own claims) less any he said are not working this shift (x1, `offNow`),
 * and his completed trips. Read-only; the vehicle registry (`vehicles`) is written by the fleet /
 * partner flows.
 */
export interface VehicleFacts {
  vehicleClass: VehicleClass | null;
  /** "Toyota Corolla"; null when the registry has none. */
  model: string | null;
  colour: VehicleColour | null;
  /** Ops-confirmed only, less what he said is not working this shift (x1); display order (`sortFeatures`). */
  confirmedFeatures: VehicleFeature[];
  /** His completed trips as courier / driver, every vertical. */
  tripCount: number;
}

export interface VehicleFactsPort {
  /** The facts of each driver's active vehicle; drivers with no vehicle on file get empty facts. */
  factsOf(driverIds: readonly string[]): Promise<Map<string, VehicleFacts>>;
  /** Only the confirmed features, less this shift's «لا» (cheap: dispatch ranks on these every wave). */
  confirmedFeatures(driverIds: readonly string[]): Promise<Map<string, VehicleFeature[]>>;
}

export const VEHICLE_FACTS = Symbol('VEHICLE_FACTS');

/** Values the registry holds that the contract does not know are dropped, never shown. */
export function parseColour(raw: string | null | undefined): VehicleColour | null {
  const c = VehicleColour.safeParse(raw);
  return c.success ? c.data : null;
}

export function parseFeatures(raw: readonly string[] | null | undefined): VehicleFeature[] {
  return sortFeatures((raw ?? []).flatMap((f) => (VehicleFeature.safeParse(f).success ? [f as VehicleFeature] : [])));
}

const EMPTY: VehicleFacts = { vehicleClass: null, model: null, colour: null, confirmedFeatures: [], tripCount: 0 };

/** Bound when DATABASE_URL is set: the driver's active vehicle and a count of his completed trips. */
export class PrismaVehicleFacts implements VehicleFactsPort {
  constructor(
    private readonly prisma: PrismaService,
    /** x1: features said not working this shift; absent = the car check alone. */
    private readonly offNow: OffNow = async () => new Map(),
  ) {}

  private async vehicles(driverIds: readonly string[]) {
    const rows = await this.prisma.prisma.vehicle.findMany({ where: { activeDriverId: { in: [...driverIds] }, active: true }, orderBy: { updatedAt: 'desc' } });
    // Newest first: a driver with two active vehicles is shown the one touched last.
    const byDriver = new Map<string, (typeof rows)[number]>();
    for (const v of rows) if (v.activeDriverId && !byDriver.has(v.activeDriverId)) byDriver.set(v.activeDriverId, v);
    return byDriver;
  }

  async factsOf(driverIds: readonly string[]): Promise<Map<string, VehicleFacts>> {
    const ids = [...new Set(driverIds)];
    if (ids.length === 0) return new Map();
    const [vehicles, counts, off] = await Promise.all([
      this.vehicles(ids),
      this.prisma.prisma.trip.groupBy({ by: ['courierId'], where: { courierId: { in: ids }, state: 'completed' }, _count: { _all: true } }),
      this.offNow(ids),
    ]);
    const trips = new Map(counts.map((c) => [c.courierId, c._count._all]));
    return new Map(
      ids.map((id) => {
        const v = vehicles.get(id);
        const facts: VehicleFacts = v
          ? { vehicleClass: v.class as VehicleClass, model: v.model?.trim() || null, colour: parseColour(v.colour), confirmedFeatures: withoutOff(parseFeatures(v.featuresConfirmed), off.get(id)), tripCount: trips.get(id) ?? 0 }
          : { ...EMPTY, tripCount: trips.get(id) ?? 0 };
        return [id, facts];
      }),
    );
  }

  async confirmedFeatures(driverIds: readonly string[]): Promise<Map<string, VehicleFeature[]>> {
    const ids = [...new Set(driverIds)];
    if (ids.length === 0) return new Map();
    const [vehicles, off] = await Promise.all([this.vehicles(ids), this.offNow(ids)]);
    return new Map(ids.map((id) => [id, withoutOff(parseFeatures(vehicles.get(id)?.featuresConfirmed), off.get(id))]));
  }
}

/**
 * In-process twin (tests, the simulator, the database-less demo API): cars registered by driver, trip
 * counts from the trips module (its completed trips for the driver).
 */
export class InMemoryVehicleFacts implements VehicleFactsPort {
  private readonly cars = new Map<string, Omit<VehicleFacts, 'tripCount'>>();

  constructor(
    private readonly completedTrips: (driverId: string) => Promise<number> = async () => 0,
    /** x1: features said not working this shift; absent = the registered car alone. */
    private readonly offNow: OffNow = async () => new Map(),
  ) {}

  register(driverId: string, car: { vehicleClass?: VehicleClass | null; model?: string | null; colour?: VehicleColour | null; confirmedFeatures?: readonly VehicleFeature[] }): void {
    this.cars.set(driverId, { vehicleClass: car.vehicleClass ?? null, model: car.model ?? null, colour: car.colour ?? null, confirmedFeatures: sortFeatures(car.confirmedFeatures ?? []) });
  }

  async factsOf(driverIds: readonly string[]): Promise<Map<string, VehicleFacts>> {
    const out = new Map<string, VehicleFacts>();
    const off = await this.offNow([...new Set(driverIds)]);
    for (const id of new Set(driverIds)) {
      const car = this.cars.get(id);
      out.set(id, { ...(car ?? EMPTY), confirmedFeatures: withoutOff(car?.confirmedFeatures ?? [], off.get(id)), tripCount: await this.completedTrips(id) });
    }
    return out;
  }

  async confirmedFeatures(driverIds: readonly string[]): Promise<Map<string, VehicleFeature[]>> {
    const ids = [...new Set(driverIds)];
    const off = await this.offNow(ids);
    return new Map(ids.map((id) => [id, withoutOff(this.cars.get(id)?.confirmedFeatures ?? [], off.get(id))]));
  }
}
