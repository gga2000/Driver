import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  AddLandmarkPhotoInput,
  CashHoldersInput,
  CashReceiptView,
  CompleteTaskInput,
  LandmarkPhotoView,
  LandmarksInput,
  MerchantOnboardingInput,
  MerchantOnboardingView,
  MyTasksInput,
  OpsCashHolder,
  OpsLandmark,
  OpsTask,
  RecordCashReceiptInput,
} from '../ops-io.js';
import { ConfirmTopUpInput, TopUpConfirmation, TopUpLookupInput, TopUpLookupView } from '../topup-io.js';
import { protectedProcedure, router } from '../trpc.js';
import { opsControlsRouter } from './control-room.js';
import { opsZonesRouter } from './zones.js';

export const FIELD_OPS_ROLES: readonly RoleKind[] = ['field_ops', 'admin'];

/** `ops.*` — Ops mode in the Partner app for field staff. */
export const opsRouter = router({
  addLandmarkPhoto: protectedProcedure(FIELD_OPS_ROLES)
    .input(AddLandmarkPhotoInput)
    .output(LandmarkPhotoView)
    .mutation(({ ctx, input }) => ctx.ops.addLandmarkPhoto(ctx.actor, input)),
  /** Courier → ops cash hand-over, confirmed by the courier's daily code; posts `driver_settlement`. */
  recordCashReceipt: protectedProcedure(FIELD_OPS_ROLES)
    .input(RecordCashReceiptInput)
    .output(CashReceiptView)
    .mutation(({ ctx, input }) => ctx.ops.recordCashReceipt(ctx.actor, input)),
  merchantOnboarding: protectedProcedure(FIELD_OPS_ROLES)
    .input(MerchantOnboardingInput)
    .output(MerchantOnboardingView)
    .mutation(({ ctx, input }) => ctx.ops.merchantOnboarding(ctx.actor, input)),
  myTasks: protectedProcedure(FIELD_OPS_ROLES)
    .input(MyTasksInput)
    .output(z.array(OpsTask))
    .query(({ ctx, input }) => ctx.ops.myTasks(ctx.actor, input)),
  /** Couriers holding customers' cash, most owed first (the cash-receipt courier picker). */
  cashHolders: protectedProcedure(FIELD_OPS_ROLES)
    .input(CashHoldersInput)
    .output(z.array(OpsCashHolder))
    .query(({ ctx, input }) => ctx.ops.cashHolders(ctx.actor, input)),
  /** Landmark places to photograph, optionally in one zone. */
  landmarks: protectedProcedure(FIELD_OPS_ROLES)
    .input(LandmarksInput)
    .output(z.array(OpsLandmark))
    .query(({ ctx, input }) => ctx.ops.landmarks(ctx.actor, input)),
  completeTask: protectedProcedure(FIELD_OPS_ROLES)
    .input(CompleteTaskInput)
    .output(OpsTask)
    .mutation(({ ctx, input }) => ctx.ops.completeTask(ctx.actor, input)),
  /** A customer's wallet top-up code: amount, state and who it is for, before taking the cash. */
  topUpLookup: protectedProcedure(FIELD_OPS_ROLES)
    .input(TopUpLookupInput)
    .output(TopUpLookupView)
    .query(({ ctx, input }) => ctx.topups.lookup(ctx.actor, input, 'ops_agent')),
  /** Cash counted: credits the customer's wallet once (single-use code, 24 h); the company holds the cash. */
  confirmTopUp: protectedProcedure(FIELD_OPS_ROLES)
    .input(ConfirmTopUpInput)
    .output(TopUpConfirmation)
    .mutation(({ ctx, input }) => ctx.topups.confirm(ctx.actor, input, 'ops_agent')),
  /** Launch control room: kill switches and the zone throttle (Console; admin / dispatcher to change). */
  controls: opsControlsRouter,
  /** Zone outlines drawn on a real map (Console › المناطق; admin / field ops to change). */
  zones: opsZonesRouter,
});
