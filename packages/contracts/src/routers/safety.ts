import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  SAFETY_DESK_ROLES,
  SafetyCallInput,
  SafetyCallSession,
  SafetyIncidentCase,
  SafetyIncidentIdInput,
  SafetyIncidentSummary,
  SafetyListInput,
  SafetyNoteInput,
  SafetyResolveInput,
  SosCategoryInput,
  SosIncidentIdInput,
  SosPositionInput,
  SosRaiseInput,
  SosShared,
  SosSharedInput,
  SosStatusInput,
  SosView,
} from '../safety-io.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

const DESK: readonly RoleKind[] = SAFETY_DESK_ROLES;

/**
 * `safety.*` — SOS (scoring & safety §3). The person side needs only a session: whether the caller
 * is a party of an active trip is checked by the API on every call (a customer of the ride, the
 * driver of the job, a rider or the driver of the الرجعة departure, the poster or the picked driver
 * of a private ride). The Console side is for dispatchers, support and admins.
 */
export const safetyRouter = router({
  /** Held 3 s: opens the incident (or returns the one this press already opened). */
  sos: protectedProcedure().input(SosRaiseInput).output(SosView).mutation(({ ctx, input }) => ctx.safety.sos(ctx.actor, input)),
  /** "كنسل — تنبيه بالغلط" inside the 10-s window; logged, never erased. */
  cancel: protectedProcedure().input(SosIncidentIdInput).output(SosView).mutation(({ ctx, input }) => ctx.safety.cancel(ctx.actor, input)),
  /** The caller's incident (by id, or the latest open one). */
  status: protectedProcedure().input(SosStatusInput).output(SosView.nullable()).query(({ ctx, input }) => ctx.safety.status(ctx.actor, input)),
  /** A fix every few seconds while the incident is open. */
  position: protectedProcedure().input(SosPositionInput).output(SosView).mutation(({ ctx, input }) => ctx.safety.position(ctx.actor, input)),
  category: protectedProcedure().input(SosCategoryInput).output(SosView).mutation(({ ctx, input }) => ctx.safety.setCategory(ctx.actor, input)),
  /** The emergency contact's live-location page (public; the signed token is the credential). */
  shared: publicProcedure.input(SosSharedInput).output(SosShared).query(({ ctx, input }) => ctx.safety.shared(input)),

  // ── Console ──
  list: protectedProcedure(DESK)
    .input(SafetyListInput)
    .output(z.array(SafetyIncidentSummary))
    .query(({ ctx, input }) => ctx.safety.list(ctx.actor, input)),
  get: protectedProcedure(DESK).input(SafetyIncidentIdInput).output(SafetyIncidentCase).query(({ ctx, input }) => ctx.safety.get(ctx.actor, input)),
  acknowledge: protectedProcedure(DESK).input(SafetyIncidentIdInput).output(SafetyIncidentCase).mutation(({ ctx, input }) => ctx.safety.acknowledge(ctx.actor, input)),
  note: protectedProcedure(DESK).input(SafetyNoteInput).output(SafetyIncidentCase).mutation(({ ctx, input }) => ctx.safety.note(ctx.actor, input)),
  resolve: protectedProcedure(DESK).input(SafetyResolveInput).output(SafetyIncidentCase).mutation(({ ctx, input }) => ctx.safety.resolve(ctx.actor, input)),
  /** A masked call to the person, the other party or the emergency contact. */
  requestCall: protectedProcedure(DESK).input(SafetyCallInput).output(SafetyCallSession).mutation(({ ctx, input }) => ctx.safety.call(ctx.actor, input)),
});
