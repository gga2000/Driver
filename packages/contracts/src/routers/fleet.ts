import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import { EarningsView } from '../driver-account-io.js';
import { AddFleetDriverInput, AddVehicleInput, AssignDriverInput, FleetDriver, FleetDriverEarningsInput, FleetOverview, FleetScopeInput, FleetVehicle } from '../fleet-io.js';
import { protectedProcedure, router } from '../trpc.js';

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
});
