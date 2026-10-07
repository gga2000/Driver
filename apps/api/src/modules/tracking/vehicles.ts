import { sortFeatures, VehicleColour, vehicleColourKey, VehicleFeature, type VehicleClass } from '@driver/contracts';
import { t } from '@driver/i18n';
import type { PrismaService } from '../../shared/db/prisma.service.js';

/** What the courier card shows about the vehicle: class, plate, model, colour and confirmed features. */
export interface CourierVehicle {
  vehicleClass: VehicleClass;
  plate: string;
  /** "تويوتا كورولا · أبيض"; null when the registry has no model. */
  label: string | null;
  /** "Toyota Corolla"; null when unknown (ride step 3, d1). */
  model: string | null;
  colour: VehicleColour | null;
  /** Ops-confirmed at the car check only, loud ones first (`sortFeatures`). Never the driver's bare claims. */
  features: VehicleFeature[];
}

/**
 * "Toyota Corolla · أبيض": the model and the colour's Iraqi name, as riders look for the car. Null
 * without a model (a colour alone names no car); the model alone when the colour is unknown.
 */
export function vehicleLabel(model: string | null, colour: VehicleColour | null): string | null {
  if (!model) return null;
  return colour ? `${model} · ${t(vehicleColourKey(colour))}` : model;
}

/**
 * Read-only lookup of the vehicle a courier is driving (`vehicles`: the trip's `vehicleId` first,
 * otherwise the vehicle whose active driver he is). The fleet module owns the registry and its
 * writes; this is a narrow read for the customer's courier card and never writes.
 */
export interface CourierVehicleDirectory {
  forCourier(courierId: string, vehicleId: string | null): Promise<CourierVehicle | null>;
}

export const COURIER_VEHICLES = Symbol('COURIER_VEHICLES');

/** The card's view of a `vehicles` row: unknown colours and features (never written) are dropped. */
export function courierVehicleFromRow(row: { class: string; plate: string; model: string | null; colour: string | null; featuresConfirmed: readonly string[] }): CourierVehicle {
  const colour = VehicleColour.safeParse(row.colour);
  const model = row.model?.trim() || null;
  return {
    vehicleClass: row.class as VehicleClass,
    plate: row.plate,
    model,
    colour: colour.success ? colour.data : null,
    label: vehicleLabel(model, colour.success ? colour.data : null),
    features: sortFeatures(row.featuresConfirmed.filter((f): f is VehicleFeature => VehicleFeature.safeParse(f).success)),
  };
}

/** Bound when DATABASE_URL is set. */
export class PrismaCourierVehicles implements CourierVehicleDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async forCourier(courierId: string, vehicleId: string | null): Promise<CourierVehicle | null> {
    const db = this.prisma.prisma;
    const row =
      (vehicleId ? await db.vehicle.findUnique({ where: { id: vehicleId } }) : null) ??
      (await db.vehicle.findFirst({ where: { activeDriverId: courierId, active: true }, orderBy: { updatedAt: 'desc' } }));
    return row ? courierVehicleFromRow(row) : null;
  }
}

/** What a test or the demo registers: class and plate, and the car's details when it has them. */
export type CourierVehicleInput = Pick<CourierVehicle, 'vehicleClass' | 'plate'> & Partial<Pick<CourierVehicle, 'model' | 'colour' | 'features'>>;

/** In-process twin (tests, simulator, the database-less demo API): vehicles registered by courier. */
export class InMemoryCourierVehicles implements CourierVehicleDirectory {
  private readonly byCourier = new Map<string, CourierVehicle>();

  /** `features` are the confirmed ones (what the card shows); the label is built from model + colour. */
  register(courierId: string, vehicle: CourierVehicleInput): void {
    const model = vehicle.model ?? null;
    const colour = vehicle.colour ?? null;
    this.byCourier.set(courierId, { vehicleClass: vehicle.vehicleClass, plate: vehicle.plate, model, colour, label: vehicleLabel(model, colour), features: sortFeatures(vehicle.features ?? []) });
  }

  async forCourier(courierId: string): Promise<CourierVehicle | null> {
    const v = this.byCourier.get(courierId);
    return v ? { ...v, features: [...v.features] } : null;
  }
}
