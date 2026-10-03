import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  AddLandmarkPhotoInput,
  CashReceiptView,
  CompleteTaskInput,
  LandmarkPhotoView,
  MerchantOnboardingInput,
  MerchantOnboardingView,
  MyTasksInput,
  OpsTask,
  RecordCashReceiptInput,
} from '../ops-io.js';
import { protectedProcedure, router } from '../trpc.js';

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
  completeTask: protectedProcedure(FIELD_OPS_ROLES)
    .input(CompleteTaskInput)
    .output(OpsTask)
    .mutation(({ ctx, input }) => ctx.ops.completeTask(ctx.actor, input)),
});
