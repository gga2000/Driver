import { z } from 'zod';
import { Iqd } from './common.js';
import { DriverDocumentKind, DriverDocumentStatus, EarningsPeriod, type EarningsView } from './driver-account-io.js';
import type { Actor } from './identity-io.js';
import { CapTier } from './ledger-rules.js';
import { VehicleClass } from './trip.js';

/**
 * `fleet.*` — the fleet owner's dashboard (partner spec "fleet owner dashboard (vehicles, drivers,
 * earnings)"). A fleet is an org; the owner holds `fleet_owner` scoped to it. Drivers' names reach
 * the owner only through the identity vault (each read logged, purpose `fleet_view`).
 */

/** Omit when the caller owns exactly one fleet. */
export const FleetScopeInput = z.object({ fleetOrgId: z.string().min(1).optional() });
export type FleetScopeInput = z.infer<typeof FleetScopeInput>;

export const FleetDriverState = z.enum(['offline', 'online', 'on_job', 'over_cap']);
export type FleetDriverState = z.infer<typeof FleetDriverState>;

export const FleetVehicle = z.object({
  vehicleId: z.string(),
  plate: z.string(),
  vehicleClass: VehicleClass,
  activeDriverId: z.string().nullable(),
  active: z.boolean(),
});
export type FleetVehicle = z.infer<typeof FleetVehicle>;

export const FleetDriver = z.object({
  driverId: z.string(),
  name: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  state: FleetDriverState,
  vehicleId: z.string().nullable(),
  tier: CapTier,
  todayEarningsIqd: Iqd,
  weekEarningsIqd: Iqd,
  owedIqd: Iqd,
  /** Worst document status (expired > expiring > pending > rejected > approved); null without documents. */
  documents: DriverDocumentStatus.nullable(),
});
export type FleetDriver = z.infer<typeof FleetDriver>;

export const FleetExpiringDocument = z.object({
  driverId: z.string(),
  kind: DriverDocumentKind,
  status: DriverDocumentStatus,
  expiresAt: z.coerce.date().nullable(),
  daysToExpiry: z.number().int().nullable(),
});

export const FleetOverview = z.object({
  fleetOrgId: z.string(),
  totals: z.object({
    vehicles: z.number().int(),
    drivers: z.number().int(),
    online: z.number().int(),
    onJob: z.number().int(),
    todayEarningsIqd: Iqd,
    weekEarningsIqd: Iqd,
    owedIqd: Iqd,
  }),
  vehicles: z.array(FleetVehicle),
  drivers: z.array(FleetDriver),
  /** Expired or expiring within 30 days, soonest first. */
  expiringDocuments: z.array(FleetExpiringDocument),
});
export type FleetOverview = z.infer<typeof FleetOverview>;

export const AssignDriverInput = FleetScopeInput.extend({
  vehicleId: z.string().min(1),
  /** Null unassigns the vehicle. */
  driverId: z.string().min(1).nullable(),
});
export type AssignDriverInput = z.infer<typeof AssignDriverInput>;

export const AddVehicleInput = FleetScopeInput.extend({ plate: z.string().trim().min(2).max(20), vehicleClass: VehicleClass });
export type AddVehicleInput = z.infer<typeof AddVehicleInput>;

/** Links a driver to the fleet by phone; the driving role itself still comes from ops review. */
export const AddFleetDriverInput = FleetScopeInput.extend({ phone: z.string().min(7).max(20) });
export type AddFleetDriverInput = z.infer<typeof AddFleetDriverInput>;

/** One of the fleet's drivers' earnings, every component named (same view as `driverAccount.earnings`). */
export const FleetDriverEarningsInput = FleetScopeInput.extend({ driverId: z.string().min(1), period: EarningsPeriod.default('week'), anchor: z.coerce.date().optional() });
export type FleetDriverEarningsInput = z.output<typeof FleetDriverEarningsInput>;

export interface FleetPort {
  driverEarnings(actor: Actor, input: FleetDriverEarningsInput): Promise<EarningsView>;
  overview(actor: Actor, input: FleetScopeInput): Promise<FleetOverview>;
  vehicles(actor: Actor, input: FleetScopeInput): Promise<FleetVehicle[]>;
  drivers(actor: Actor, input: FleetScopeInput): Promise<FleetDriver[]>;
  assignDriver(actor: Actor, input: AssignDriverInput): Promise<FleetVehicle>;
  addVehicle(actor: Actor, input: AddVehicleInput): Promise<FleetVehicle>;
  addDriver(actor: Actor, input: AddFleetDriverInput): Promise<FleetDriver>;
}
