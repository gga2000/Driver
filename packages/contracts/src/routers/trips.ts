import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  ActiveTripsInput,
  ArriveStopInput,
  CancelTripInput,
  CompleteStopInput,
  FailTripInput,
  ReportPositionInput,
  ReportPositionsInput,
  ReportPositionOutput,
  RunSheet,
  SkipStopInput,
  StartUnreachableInput,
  Trip,
  TripIdInput,
} from '../trip.js';
import { EventLog } from '../console-io.js';
import { StartCodeAlert, StartCodeAlertsInput } from '../ride-safety-io.js';
import { SAFETY_DESK_ROLES } from '../safety-io.js';
import { protectedProcedure, router } from '../trpc.js';
import { CONSOLE_READ_ROLES } from './console.js';

/** Everyone who drives a job for the platform. */
export const DRIVING_ROLES: readonly RoleKind[] = ['courier', 'shopper', 'driver', 'intercity_driver', 'khat_driver'];
/** Ops roles that may watch the board and act on any trip. */
export const OPS_ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'admin'];

/** Trips procedures (plan Step 4). Implementations live in `modules/trips` behind `ctx.trips`. */
export const tripsRouter = router({
  get: protectedProcedure([...DRIVING_ROLES, ...OPS_ROLES]).input(TripIdInput).output(Trip).query(({ ctx, input }) => ctx.trips.get(ctx.actor, input)),
  mine: protectedProcedure(DRIVING_ROLES).output(z.array(Trip)).query(({ ctx }) => ctx.trips.mine(ctx.actor)),
  /** The trip's actor event log (quarantined late replays included and marked). */
  events: protectedProcedure(CONSOLE_READ_ROLES).input(TripIdInput).output(EventLog).query(({ ctx, input }) => ctx.console.tripEvents(input.tripId)),
  board: protectedProcedure(OPS_ROLES).input(ActiveTripsInput).output(z.array(Trip)).query(({ ctx, input }) => ctx.trips.board(ctx.actor, input)),
  /** The trip's driver only: stops with the children's names, read from the identity vault (logged). */
  runSheet: protectedProcedure(DRIVING_ROLES).input(TripIdInput).output(RunSheet).query(({ ctx, input }) => ctx.trips.runSheet(ctx.actor, input)),
  // No accept / decline here (M2 review follow-up): drivers answer offers through `dispatch.respond`.
  reportPosition: protectedProcedure(DRIVING_ROLES)
    .input(ReportPositionInput)
    .output(ReportPositionOutput)
    .mutation(({ ctx, input }) => ctx.trips.reportPosition(ctx.actor, input)),
  reportPositions: protectedProcedure(DRIVING_ROLES)
    .input(ReportPositionsInput)
    .output(ReportPositionOutput)
    .mutation(({ ctx, input }) => ctx.trips.reportPositions(ctx.actor, input)),
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
  /** s1: night-ride trip codes typed wrong again and again (Console safety strip, with the sweep and PIN rows). */
  startCodeAlerts: protectedProcedure(SAFETY_DESK_ROLES)
    .input(StartCodeAlertsInput)
    .output(z.array(StartCodeAlert))
    .query(({ ctx, input }) => ctx.trips.startCodeAlerts(ctx.actor, input)),
});
