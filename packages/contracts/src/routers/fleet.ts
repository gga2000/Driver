import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import { EarningsView } from '../driver-account-io.js';
import { AddFleetDriverInput, AddVehicleInput, AssignDriverInput, FleetDriver, FleetDriverEarningsInput, FleetInvite, FleetOverview, FleetScopeInput, FleetVehicle, RespondFleetInviteInput, SetVehicleFeaturesInput } from '../fleet-io.js';
import { protectedProcedure, router } from '../trpc.js';
import { DRIVING_ROLES } from './trips.js';

export const FLEET_ROLES: readonly RoleKind[] = ['fleet_owner'];

/** `fleet.*` — fleet owner dashboard; every call is scoped to a fleet org the caller owns. */
export const fleetRouter = router({
  overview: protectedProcedure(FLEET_ROLES)
    .input(FleetScopeInput)
    .output(FleetOverview)
    .query(({ ctx, input }) => ctx.fleet.overview(ctx.actor, input)),
  vehicles: protectedProcedure(FLEET_ROLES)
    .input(FleetScopeInput)
    .output(z.array(FleetVehicle))
    .query(({ ctx, input }) => ctx.fleet.vehicles(ctx.actor, input)),
  drivers: protectedProcedure(FLEET_ROLES)
    .input(FleetScopeInput)
    .output(z.array(FleetDriver))
    .query(({ ctx, input }) => ctx.fleet.drivers(ctx.actor, input)),
  driverEarnings: protectedProcedure(FLEET_ROLES)
    .input(FleetDriverEarningsInput)
    .output(EarningsView)
    .query(({ ctx, input }) => ctx.fleet.driverEarnings(ctx.actor, input)),
  assignDriver: protectedProcedure(FLEET_ROLES)
    .input(AssignDriverInput)
    .output(FleetVehicle)
    .mutation(({ ctx, input }) => ctx.fleet.assignDriver(ctx.actor, input)),
  addVehicle: protectedProcedure(FLEET_ROLES)
    .input(AddVehicleInput)
    .output(FleetVehicle)
    .mutation(({ ctx, input }) => ctx.fleet.addVehicle(ctx.actor, input)),
  addDriver: protectedProcedure(FLEET_ROLES)
    .input(AddFleetDriverInput)
    .output(FleetDriver)
    .mutation(({ ctx, input }) => ctx.fleet.addDriver(ctx.actor, input)),
  /** Driver side: fleets that invited him (pending) or that he works for (accepted). */
  myInvites: protectedProcedure(DRIVING_ROLES)
    .output(z.array(FleetInvite))
    .query(({ ctx }) => ctx.fleet.myInvites(ctx.actor)),
  /** Driver side: the vehicle he drives (model, colour, claimed and confirmed features); null without one. */
  myVehicle: protectedProcedure(DRIVING_ROLES)
    .output(FleetVehicle.nullable())
    .query(({ ctx }) => ctx.fleet.myVehicle(ctx.actor)),
  /** Driver side: «مميزات سيارتك» — what the car offers; new claims wait for the ops car check. */
  setMyVehicleFeatures: protectedProcedure(DRIVING_ROLES)
    .input(SetVehicleFeaturesInput)
    .output(FleetVehicle)
    .mutation(({ ctx, input }) => ctx.fleet.setMyVehicleFeatures(ctx.actor, input)),
  /** Driver side: accept an invite, or decline it / leave the fleet. Returns his links after. */
  respondInvite: protectedProcedure(DRIVING_ROLES)
    .input(RespondFleetInviteInput)
    .output(z.array(FleetInvite))
    .mutation(({ ctx, input }) => ctx.fleet.respondInvite(ctx.actor, input)),
});
