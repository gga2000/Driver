import type { RoleKind } from '../auth.js';
import {
  BoardPolicy,
  DispatchBoard,
  DispatchBoardInput,
  OfferSeenInput,
  OfferSeenOutput,
  OverrideInput,
  OverrideOutput,
  RespondInput,
  RespondOutput,
  SetPolicyInput,
} from '../dispatch-io.js';
import { DriverPositions, DriverPositionsInput } from '../console-io.js';
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
});
