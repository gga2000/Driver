import type { RoleKind } from '../auth.js';
import {
  ConsoleNames,
  ConsoleNamesInput,
  DriversListInput,
  DriversPage,
  MerchantList,
  MerchantsListInput,
  OutboxView,
  RightNow,
  RightNowInput,
  SimulatorStartInput,
  SimulatorStatus,
} from '../console-io.js';
import { protectedProcedure, router } from '../trpc.js';

/** Back-office roles that read the Console's cross-module views. */
export const CONSOLE_READ_ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'finance', 'admin'];
/** Who may start or stop the simulator. */
export const SIMULATOR_ROLES: readonly RoleKind[] = ['admin', 'dispatcher'];

/** `console.rightNow`: the dispatch board's right-now bar; `console.names`: people, places and dishes by name. */
export const consoleRouter = router({
  rightNow: protectedProcedure(CONSOLE_READ_ROLES)
    .input(RightNowInput)
    .output(RightNow)
    .query(({ ctx, input }) => ctx.console.rightNow(input.cityId)),
  /** K-01: batched display names for a page; every vault read is logged against the staff member. */
  names: protectedProcedure(CONSOLE_READ_ROLES)
    .input(ConsoleNamesInput)
    .output(ConsoleNames)
    .query(({ ctx, input }) => ctx.console.names(input, ctx.actor.personId)),
});

/** `drivers.list`: everyone with a driving role, joined with presence and scorecard tier. */
export const driversRouter = router({
  list: protectedProcedure(CONSOLE_READ_ROLES)
    .input(DriversListInput)
    .output(DriversPage)
    .query(({ ctx, input }) => ctx.console.driversList(input)),
});

/** `merchants.list`: the picker on the finance/drivers pages, with live cash balances. */
export const merchantsRouter = router({
  list: protectedProcedure(CONSOLE_READ_ROLES)
    .input(MerchantsListInput)
    .output(MerchantList)
    .query(({ ctx, input }) => ctx.console.merchants(input.cityId)),
});

/** `system.*`: outbox health and simulator controls (stubbed until the simulator is rebuilt). */
export const systemRouter = router({
  outbox: protectedProcedure(CONSOLE_READ_ROLES)
    .output(OutboxView)
    .query(({ ctx }) => ctx.console.outbox()),
  simulator: router({
    status: protectedProcedure(CONSOLE_READ_ROLES)
      .output(SimulatorStatus)
      .query(({ ctx }) => ctx.console.simulatorStatus()),
    start: protectedProcedure(SIMULATOR_ROLES)
      .input(SimulatorStartInput)
      .output(SimulatorStatus)
      .mutation(({ ctx, input }) => ctx.console.simulatorStart(input)),
    stop: protectedProcedure(SIMULATOR_ROLES)
      .output(SimulatorStatus)
      .mutation(({ ctx }) => ctx.console.simulatorStop()),
  }),
});
