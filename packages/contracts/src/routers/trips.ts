import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  AcceptTripInput,
  ActiveTripsInput,
  ArriveStopInput,
  CancelTripInput,
  CompleteStopInput,
  DeclineTripInput,
  FailTripInput,
  ReportPositionInput,
  ReportPositionOutput,
  SkipStopInput,
  StartUnreachableInput,
  Trip,
  TripIdInput,
} from '../trip.js';
import { protectedProcedure, router } from '../trpc.js';

/** Everyone who drives a job for the platform. */
export const DRIVING_ROLES: readonly RoleKind[] = ['courier', 'shopper', 'driver', 'intercity_driver', 'khat_driver'];
/** Ops roles that may watch the board and act on any trip. */
export const OPS_ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'admin'];

/** Trips procedures (plan Step 4). Implementations live in `modules/trips` behind `ctx.trips`. */
export const tripsRouter = router({
  get: protectedProcedure([...DRIVING_ROLES, ...OPS_ROLES]).input(TripIdInput).output(Trip).query(({ ctx, input }) => ctx.trips.get(ctx.actor, input)),
  mine: protectedProcedure(DRIVING_ROLES).output(z.array(Trip)).query(({ ctx }) => ctx.trips.mine(ctx.actor)),
  board: protectedProcedure(OPS_ROLES).input(ActiveTripsInput).output(z.array(Trip)).query(({ ctx, input }) => ctx.trips.board(ctx.actor, input)),
  accept: protectedProcedure(DRIVING_ROLES).input(AcceptTripInput).output(Trip).mutation(({ ctx, input }) => ctx.trips.accept(ctx.actor, input)),
  decline: protectedProcedure(DRIVING_ROLES).input(DeclineTripInput).output(Trip).mutation(({ ctx, input }) => ctx.trips.decline(ctx.actor, input)),
  reportPosition: protectedProcedure(DRIVING_ROLES)
    .input(ReportPositionInput)
    .output(ReportPositionOutput)
    .mutation(({ ctx, input }) => ctx.trips.reportPosition(ctx.actor, input)),
  arrive: protectedProcedure(DRIVING_ROLES).input(ArriveStopInput).output(Trip).mutation(({ ctx, input }) => ctx.trips.arrive(ctx.actor, input)),
  completeStop: protectedProcedure(DRIVING_ROLES).input(CompleteStopInput).output(Trip).mutation(({ ctx, input }) => ctx.trips.completeStop(ctx.actor, input)),
  skipStop: protectedProcedure(DRIVING_ROLES).input(SkipStopInput).output(Trip).mutation(({ ctx, input }) => ctx.trips.skipStop(ctx.actor, input)),
  startUnreachable: protectedProcedure(DRIVING_ROLES)
    .input(StartUnreachableInput)
    .output(Trip)
    .mutation(({ ctx, input }) => ctx.trips.startUnreachable(ctx.actor, input)),
  /** Driver after 5:00 of the unreachable timer; dispatcher from 3:00. */
  fail: protectedProcedure([...DRIVING_ROLES, 'dispatcher']).input(FailTripInput).output(Trip).mutation(({ ctx, input }) => ctx.trips.fail(ctx.actor, input)),
  /** Driver cancel (scoring hit, fees per spec §4) or dispatcher/platform cancel. */
  cancel: protectedProcedure([...DRIVING_ROLES, 'dispatcher', 'admin']).input(CancelTripInput).output(Trip).mutation(({ ctx, input }) => ctx.trips.cancel(ctx.actor, input)),
});
