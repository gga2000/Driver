import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import { CallSession } from '../chat-io.js';
import { SAFETY_DESK_ROLES, SafetyCallSession } from '../safety-io.js';
import {
  AbsenceView,
  AcceptSubstituteInput,
  AcceptSubstituteOutput,
  CallGuardianInput,
  ConfirmEmptyCarInput,
  GuardianChild,
  KhatRunTrip,
  KhatSweepAlert,
  KhatSweepAlertsInput,
  KhatSweepCallInput,
  KhatSweepCloseInput,
  KhatTapInput,
  RemoveChildPhotoInput,
  ReportAbsenceInput,
  SetChildPhotoInput,
  SubstituteOffer,
  SubstituteOffersInput,
  TodayRunInput,
  TodayRunView,
} from '../khat-io.js';
import { protectedProcedure, router } from '../trpc.js';

export const KHAT_DRIVER_ROLES: readonly RoleKind[] = ['khat_driver'];
/** Who sees and answers sweep alerts: the same back-office rota as SOS. */
const DESK: readonly RoleKind[] = SAFETY_DESK_ROLES;

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
  /**
   * The guardian's side (customer app, Ali 2026-10-06): his own children and the photo he may add of
   * each. Any signed-in person, his own children only (`forbidden` otherwise). The photo reaches only
   * the driver of the child's run.
   */
  guardian: router({
    children: protectedProcedure()
      .output(z.array(GuardianChild))
      .query(({ ctx }) => ctx.khat.guardianChildren(ctx.actor)),
    setPhoto: protectedProcedure()
      .input(SetChildPhotoInput)
      .output(GuardianChild)
      .mutation(({ ctx, input }) => ctx.khat.setChildPhoto(ctx.actor, input)),
    removePhoto: protectedProcedure()
      .input(RemoveChildPhotoInput)
      .output(GuardianChild)
      .mutation(({ ctx, input }) => ctx.khat.removeChildPhoto(ctx.actor, input)),
  }),
  /**
   * Runs that ended without the sweep within `KHAT_RULES.sweepAlertAfterMin` (Console safety strip):
   * the driver, the run, the last drop time; late confirms show for a while, then go.
   */
  sweepAlerts: protectedProcedure(DESK)
    .input(KhatSweepAlertsInput)
    .output(z.array(KhatSweepAlert))
    .query(({ ctx, input }) => ctx.khat.sweepAlerts(ctx.actor, input)),
  /** The strip's call button: a masked call from the dispatcher to the run's driver. Audited. */
  callSweepDriver: protectedProcedure(DESK)
    .input(KhatSweepCallInput)
    .output(SafetyCallSession)
    .mutation(({ ctx, input }) => ctx.khat.callSweepDriver(ctx.actor, input)),
  /**
   * "سكّر التنبيه" (Ali, 2026-10-06): a dispatcher closes an open alert with a reason (and a note for
   * "غيرها"); it leaves the strip, the record keeps who, when and why. Audited; idempotent.
   */
  closeSweepAlert: protectedProcedure(DESK)
    .input(KhatSweepCloseInput)
    .output(KhatSweepAlert)
    .mutation(({ ctx, input }) => ctx.khat.closeSweepAlert(ctx.actor, input)),
});
