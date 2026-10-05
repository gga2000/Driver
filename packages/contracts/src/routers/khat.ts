import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import { CallSession } from '../chat-io.js';
import {
  AbsenceView,
  AcceptSubstituteInput,
  AcceptSubstituteOutput,
  CallGuardianInput,
  ConfirmEmptyCarInput,
  KhatRunTrip,
  KhatTapInput,
  ReportAbsenceInput,
  SubstituteOffer,
  SubstituteOffersInput,
  TodayRunInput,
  TodayRunView,
} from '../khat-io.js';
import { protectedProcedure, router } from '../trpc.js';

export const KHAT_DRIVER_ROLES: readonly RoleKind[] = ['khat_driver'];

/**
 * `khat.*` — خطوط driver side (edge-case §5): today's run with children by first name (vault reads
 * logged), per-child tap-in/tap-out (the guardian's "arrived" push fires on the tap-out at school),
 * absence reports and substitute offers.
 */
export const khatRouter = router({
  todayRun: protectedProcedure(KHAT_DRIVER_ROLES)
    .input(TodayRunInput)
    .output(TodayRunView)
    .query(({ ctx, input }) => ctx.khat.todayRun(ctx.actor, input)),
  tapIn: protectedProcedure(KHAT_DRIVER_ROLES)
    .input(KhatTapInput)
    .output(KhatRunTrip)
    .mutation(({ ctx, input }) => ctx.khat.tapIn(ctx.actor, input)),
  tapOut: protectedProcedure(KHAT_DRIVER_ROLES)
    .input(KhatTapInput)
    .output(KhatRunTrip)
    .mutation(({ ctx, input }) => ctx.khat.tapOut(ctx.actor, input)),
  reportAbsence: protectedProcedure(KHAT_DRIVER_ROLES)
    .input(ReportAbsenceInput)
    .output(AbsenceView)
    .mutation(({ ctx, input }) => ctx.khat.reportAbsence(ctx.actor, input)),
  substituteOffers: protectedProcedure(KHAT_DRIVER_ROLES)
    .input(SubstituteOffersInput)
    .output(z.array(SubstituteOffer))
    .query(({ ctx, input }) => ctx.khat.substituteOffers(ctx.actor, input)),
  acceptSubstitute: protectedProcedure(KHAT_DRIVER_ROLES)
    .input(AcceptSubstituteInput)
    .output(AcceptSubstituteOutput)
    .mutation(({ ctx, input }) => ctx.khat.acceptSubstitute(ctx.actor, input)),
  /** End-of-run sweep (partner S-6): "تأكدت، السيارة فاضية", logged for ops. Idempotent. */
  confirmEmptyCar: protectedProcedure(KHAT_DRIVER_ROLES)
    .input(ConfirmEmptyCarInput)
    .output(KhatRunTrip)
    .mutation(({ ctx, input }) => ctx.khat.confirmEmptyCar(ctx.actor, input)),
  /** The guardian call on each child row: a masked call, never the guardian's number. */
  callGuardian: protectedProcedure(KHAT_DRIVER_ROLES)
    .input(CallGuardianInput)
    .output(CallSession)
    .mutation(({ ctx, input }) => ctx.khat.callGuardian(ctx.actor, input)),
});
