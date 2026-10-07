import type { RoleKind } from '../auth.js';
import {
  BoardPolicy,
  MyRideOffers,
  MyRideOffersInput,
  NudgeOfferInput,
  NudgeOfferResult,
  DispatchBoard,
  DispatchBoardInput,
  NearbyVehicles,
  NearbyVehiclesInput,
  NudgeZoneInput,
  NudgeZoneResult,
  ZoneDemandInput,
  OfferSeenInput,
  OfferSeenOutput,
  OverrideInput,
  OverrideOutput,
  RespondInput,
  RespondOutput,
  SetPolicyInput,
} from '../dispatch-io.js';
import { DriverPositions, DriverPositionsInput } from '../console-io.js';
import { PartnerDemandMap } from '../partner-io.js';
import { CONSOLE_READ_ROLES } from './console.js';
import { protectedProcedure, router } from '../trpc.js';

/** Console roles that run the dispatch board. */
export const DISPATCH_CONSOLE_ROLES: readonly RoleKind[] = ['dispatcher', 'admin'];
/** Roles that receive offers: couriers and city drivers, plus khat drivers for substitute auctions. */
export const DISPATCH_DRIVER_ROLES: readonly RoleKind[] = ['courier', 'driver', 'khat_driver'];

/** Dispatch procedures (plan Step 5). Everything goes through `ctx.dispatch`, the API's port. */
export const dispatchRouter = router({
  board: protectedProcedure(DISPATCH_CONSOLE_ROLES)
    .input(DispatchBoardInput)
    .output(DispatchBoard)
    .query(({ ctx, input }) => ctx.dispatch.board(input.cityId)),
  /** Live driver pins for the map: presence + job state + cash vs cap (composed by the console reads). */
  drivers: protectedProcedure(CONSOLE_READ_ROLES)
    .input(DriverPositionsInput)
    .output(DriverPositions)
    .query(({ ctx, input }) => ctx.console.driverPositions(input.cityId)),
  override: protectedProcedure(DISPATCH_CONSOLE_ROLES)
    .input(OverrideInput)
    .output(OverrideOutput)
    .mutation(({ ctx, input }) => ctx.dispatch.override(ctx.actor, input)),
  setPolicy: protectedProcedure(DISPATCH_CONSOLE_ROLES)
    .input(SetPolicyInput)
    .output(BoardPolicy)
    .mutation(({ ctx, input }) => ctx.dispatch.setPolicy(ctx.actor, input)),
  respond: protectedProcedure(DISPATCH_DRIVER_ROLES)
    .input(RespondInput)
    .output(RespondOutput)
    .mutation(({ ctx, input }) => ctx.dispatch.respond(ctx.actor, input)),
  offerSeen: protectedProcedure(DISPATCH_DRIVER_ROLES)
    .input(OfferSeenInput)
    .output(OfferSeenOutput)
    .mutation(({ ctx, input }) => ctx.dispatch.offerSeen(ctx.actor, input)),
  /** Busy zones for the Console map (maps program o5). */
  zoneDemand: protectedProcedure(CONSOLE_READ_ROLES)
    .input(ZoneDemandInput)
    .output(PartnerDemandMap)
    .query(({ ctx, input }) => ctx.dispatch.zoneDemand(input.cityId)),
  /** "Send drivers here": a push to the free drivers around a busy zone, once per 10 minutes. */
  nudgeZone: protectedProcedure(DISPATCH_CONSOLE_ROLES)
    .input(NudgeZoneInput)
    .output(NudgeZoneResult)
    .mutation(({ ctx, input }) => ctx.dispatch.nudgeZone(ctx.actor, input)),
  /** Any signed-in customer about to book a ride: free taxis or tuktuks nearby, blurred (maps program c10). */
  nearby: protectedProcedure()
    .input(NearbyVehiclesInput)
    .output(NearbyVehicles)
    .query(({ ctx, input }) => ctx.dispatch.nearby(ctx.actor, input)),
  /**
   * Ride step 3 (n3): the drivers who were sent my searching ride — first name, photo, rating, car and
   * minutes away, never a position. The order's orderer or rider only (ride habits composes it).
   */
  myRideOffers: protectedProcedure()
    .input(MyRideOffersInput)
    .output(MyRideOffers)
    .query(({ ctx, input }) => ctx.rideHabits.myRideOffers(ctx.actor, input)),
  /** Ride step 3 (n4) «نبّهه»: a soft «راكب ينتظرك» to one driver whose offer is open; once per driver. */
  nudgeOffer: protectedProcedure()
    .input(NudgeOfferInput)
    .output(NudgeOfferResult)
    .mutation(({ ctx, input }) => ctx.rideHabits.nudgeOffer(ctx.actor, input)),
});
