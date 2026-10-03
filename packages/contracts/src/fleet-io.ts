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
  /** Passenger seats (the vehicle's seat map; edge-case §9: saloon 4, SUV 6, van 7/11); 0 for a bike. */
  seats: z.number().int().min(0),
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
  /** Cash in his hand that is not his (customers' cash not yet returned), for the cap bar. */
  cashHeldIqd: Iqd,
  /** His cash cap by role and tier (money §4). */
  capIqd: Iqd,
  /** Worst document status (expired > expiring > pending > rejected > approved); null without documents. */
  documents: DriverDocumentStatus.nullable(),
  /**
   * Invited, not yet accepted (`fleet.respondInvite`): the owner sees only the id — no name, phone,
   * money, documents or live state — until the driver says yes.
   */
  pending: z.boolean().default(false),
  /**
   * Pending rows only: the number the owner typed, as "0770 ••• 4567" (he knows it already; the name
   * stays hidden until the driver accepts). Null on accepted rows. Additive (2026-10-04 follow-up).
   */
  phoneHint: z.string().nullable().optional(),
  /** Pending rows only: when the owner sent the invite. */
  invitedAt: z.coerce.date().nullable().optional(),
});
export type FleetDriver = z.infer<typeof FleetDriver>;

export const FleetExpiringDocument = z.object({
  driverId: z.string(),
  kind: DriverDocumentKind,
  status: DriverDocumentStatus,
  expiresAt: z.coerce.date().nullable(),
  daysToExpiry: z.number().int().nullable(),
});

/** One local day of the fleet's earnings (sum of its drivers' jobs that day). */
export const FleetDay = z.object({
  /** Local date `YYYY-MM-DD` (Baghdad). */
  date: z.string(),
  earningsIqd: Iqd,
  jobs: z.number().int(),
});
export type FleetDay = z.infer<typeof FleetDay>;

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
  /** This local week, Sunday → Saturday (7 entries; days still to come are 0). */
  days: z.array(FleetDay),
});
export type FleetOverview = z.infer<typeof FleetOverview>;

export const AssignDriverInput = FleetScopeInput.extend({
  vehicleId: z.string().min(1),
  /** Null unassigns the vehicle. */
  driverId: z.string().min(1).nullable(),
});
export type AssignDriverInput = z.infer<typeof AssignDriverInput>;

export const AddVehicleInput = FleetScopeInput.extend({
  plate: z.string().trim().min(2).max(20),
  vehicleClass: VehicleClass,
  /** Passenger seats; defaults by class (bike 0, tuktuk 3, car 4, SUV 6, van 7, intercity 4). */
  seats: z.number().int().min(0).max(14).optional(),
});
export type AddVehicleInput = z.infer<typeof AddVehicleInput>;

/**
 * Invites a driver to the fleet by phone (the driving role itself still comes from ops review). The
 * link stays pending until the driver accepts it in his app (`fleet.respondInvite`).
 */
export const AddFleetDriverInput = FleetScopeInput.extend({ phone: z.string().min(7).max(20) });
export type AddFleetDriverInput = z.infer<typeof AddFleetDriverInput>;

/** One of the fleet's drivers' earnings, every component named (same view as `driverAccount.earnings`). */
export const FleetDriverEarningsInput = FleetScopeInput.extend({ driverId: z.string().min(1), period: EarningsPeriod.default('week'), anchor: z.coerce.date().optional() });
export type FleetDriverEarningsInput = z.output<typeof FleetDriverEarningsInput>;

/** A driver's own fleet links (Partner app): invites to accept, and fleets he works for. */
export const FleetInvite = z.object({
  fleetOrgId: z.string(),
  invitedAt: z.coerce.date(),
  /** The inviting owner's first name (vault read, logged); null when unknown. */
  invitedByName: z.string().nullable(),
  /** The fleet's name ("أسطول الربيعي"); null when the org is unknown here. Additive. */
  fleetName: z.string().nullable().optional(),
  accepted: z.boolean(),
});
export type FleetInvite = z.infer<typeof FleetInvite>;

/** Accept a fleet's invite, or decline it / leave the fleet. */
export const RespondFleetInviteInput = z.object({ fleetOrgId: z.string().min(1), accept: z.boolean() });
export type RespondFleetInviteInput = z.infer<typeof RespondFleetInviteInput>;

export interface FleetPort {
  driverEarnings(actor: Actor, input: FleetDriverEarningsInput): Promise<EarningsView>;
  overview(actor: Actor, input: FleetScopeInput): Promise<FleetOverview>;
  vehicles(actor: Actor, input: FleetScopeInput): Promise<FleetVehicle[]>;
  drivers(actor: Actor, input: FleetScopeInput): Promise<FleetDriver[]>;
  assignDriver(actor: Actor, input: AssignDriverInput): Promise<FleetVehicle>;
  addVehicle(actor: Actor, input: AddVehicleInput): Promise<FleetVehicle>;
  addDriver(actor: Actor, input: AddFleetDriverInput): Promise<FleetDriver>;
  myInvites(actor: Actor): Promise<FleetInvite[]>;
  respondInvite(actor: Actor, input: RespondFleetInviteInput): Promise<FleetInvite[]>;
}
