import type { VehicleClass } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';

/** What the courier card shows about the vehicle: class, plate and a short label. */
export interface CourierVehicle {
  vehicleClass: VehicleClass;
  plate: string;
  /** "تويوتا كورولا · أبيض"; null when the registry has no model/colour. */
  label: string | null;
}

/**
 * Read-only lookup of the vehicle a courier is driving (`vehicles`: the trip's `vehicleId` first,
 * otherwise the vehicle whose active driver he is). The fleet registry has no owning module yet;
 * this is a narrow read for the customer's courier card and never writes.
 */
export interface CourierVehicleDirectory {
  forCourier(courierId: string, vehicleId: string | null): Promise<CourierVehicle | null>;
}

export const COURIER_VEHICLES = Symbol('COURIER_VEHICLES');

/** Bound when DATABASE_URL is set. */
export class PrismaCourierVehicles implements CourierVehicleDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async forCourier(courierId: string, vehicleId: string | null): Promise<CourierVehicle | null> {
    const db = this.prisma.prisma;
    const row =
      (vehicleId ? await db.vehicle.findUnique({ where: { id: vehicleId } }) : null) ??
      (await db.vehicle.findFirst({ where: { activeDriverId: courierId, active: true }, orderBy: { updatedAt: 'desc' } }));
    return row ? { vehicleClass: row.class as VehicleClass, plate: row.plate, label: null } : null;
  }
}

/** In-process twin (tests, simulator, the database-less demo API): vehicles registered by courier. */
export class InMemoryCourierVehicles implements CourierVehicleDirectory {
  private readonly byCourier = new Map<string, CourierVehicle>();

  register(courierId: string, vehicle: CourierVehicle): void {
    this.byCourier.set(courierId, { ...vehicle });
  }

  async forCourier(courierId: string): Promise<CourierVehicle | null> {
    const v = this.byCourier.get(courierId);
    return v ? { ...v } : null;
  }
}
