import type { RoleKind } from '../auth.js';
import {
  ConsoleNames,
  ConsoleNamesInput,
  CustomerHistory,
  CustomerHistoryInput,
  DriversListInput,
  DriversPage,
  MerchantList,
  MerchantsListInput,
  MONEY_ALARM_ROLES,
  MoneyAlarm,
  OUTBOX_REQUEUE_ROLES,
  OutboxRequeueInput,
  OutboxRequeueResult,
  OutboxView,
  RightNow,
  RightNowInput,
  SimulatorStartInput,
  SimulatorStatus,
  SmsDayView,
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
  /** s5: the support card's last orders and this month's credits of one customer. */
  customerHistory: protectedProcedure(CONSOLE_READ_ROLES)
    .input(CustomerHistoryInput)
    .output(CustomerHistory)
    .query(({ ctx, input }) => ctx.console.customerHistory(input)),
});

/** `drivers.list`: everyone with a driving role, joined with presence and scorecard tier. */
export const driversRouter = router({
  list: protectedProcedure(CONSOLE_READ_ROLES)
    .input(DriversListInput)
    .output(DriversPage)
    .query(({ ctx, input }) => ctx.console.driversList(input, ctx.actor.personId)),
});

/** `merchants.list`: the picker on the finance/drivers pages, with live cash balances. */
export const merchantsRouter = router({
  list: protectedProcedure(CONSOLE_READ_ROLES)
    .input(MerchantsListInput)
    .output(MerchantList)
    .query(({ ctx, input }) => ctx.console.merchants(input.cityId)),
});

/** `system.*`: outbox health (and the admin's requeue of failed rows), the money alarm, the day's SMS count and simulator controls. */
export const systemRouter = router({
  outbox: protectedProcedure(CONSOLE_READ_ROLES)
    .output(OutboxView)
    .query(({ ctx }) => ctx.console.outbox()),
  requeueOutbox: protectedProcedure(OUTBOX_REQUEUE_ROLES)
    .input(OutboxRequeueInput)
    .output(OutboxRequeueResult)
    .mutation(({ ctx, input }) => ctx.console.requeueOutbox(input, ctx.actor.personId)),
  moneyAlarm: protectedProcedure(MONEY_ALARM_ROLES)
    .output(MoneyAlarm)
    .query(({ ctx }) => ctx.console.moneyAlarm()),
  smsDay: protectedProcedure(CONSOLE_READ_ROLES)
    .output(SmsDayView)
    .query(({ ctx }) => ctx.console.smsDay()),
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
