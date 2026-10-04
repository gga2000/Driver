import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  AckDeliveryInput,
  DeliveryLogRow,
  NotifyLogInput,
  NotifyPreferences,
  RegisterDeviceInput,
  RegisterDeviceOutput,
  SetNotifyPreferencesInput,
  UnregisterDeviceInput,
} from '../notify-io.js';
import { protectedProcedure, router } from '../trpc.js';

/** Who may read the delivery log (support desk, dispatch, admin). */
export const NOTIFY_LOG_ROLES: readonly RoleKind[] = ['support', 'dispatcher', 'admin'];

/**
 * Push tokens, notification preferences and the delivery log (`modules/notify` behind `ctx.notify`).
 * A token is tied to the caller's session and removed when that session signs out.
 */
export const notifyRouter = router({
  registerDevice: protectedProcedure()
    .input(RegisterDeviceInput)
    .output(RegisterDeviceOutput)
    .mutation(({ ctx, input }) => ctx.notify.registerDevice(ctx.actor, input)),
  unregisterDevice: protectedProcedure()
    .input(UnregisterDeviceInput)
    .output(RegisterDeviceOutput)
    .mutation(({ ctx, input }) => ctx.notify.unregisterDevice(ctx.actor, input)),
  preferences: protectedProcedure()
    .output(NotifyPreferences)
    .query(({ ctx }) => ctx.notify.preferences(ctx.actor)),
  setPreferences: protectedProcedure()
    .input(SetNotifyPreferencesInput)
    .output(NotifyPreferences)
    .mutation(({ ctx, input }) => ctx.notify.setPreferences(ctx.actor, input)),
  /** The app received (foreground) or opened a push: confirms delivery so no SMS twin goes out. */
  ack: protectedProcedure()
    .input(AckDeliveryInput)
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ ctx, input }) => ctx.notify.ack(ctx.actor, input)),
  /** Support: what was sent to a person or about an order, on which channel, and what happened. */
  log: protectedProcedure(NOTIFY_LOG_ROLES)
    .input(NotifyLogInput)
    .output(z.array(DeliveryLogRow))
    .query(({ ctx, input }) => ctx.notify.log(ctx.actor, input)),
});
