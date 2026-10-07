import type { RoleKind } from '../auth.js';
import {
  CheckInChallenge,
  CheckInResult,
  CheckInStatus,
  DocumentsInput,
  DocumentsView,
  DriverDocumentView,
  EarningsInput,
  EarningsView,
  GuaranteeView,
  HandoverCode,
  JobReceipt,
  JobReceiptInput,
  MainPhotoView,
  OnlineGate,
  PayQueryInput,
  PayQueryResult,
  ShiftSummary,
  ShiftSummaryInput,
  ReviewDocumentInput,
  ScorecardInput,
  ScorecardView,
  SetMainPhotoInput,
  SubmitCheckInInput,
  UploadDocumentInput,
} from '../driver-account-io.js';
import { DriverProfile } from '../dispatch-io.js';
import { CourierCompliments } from '../order-compliment.js';
import { protectedProcedure, router } from '../trpc.js';
import { DRIVING_ROLES } from './trips.js';

/** Who may read a driver's book: the driver and back office (fleet owners use `fleet.driverEarnings`). */
export const DRIVER_ACCOUNT_READERS: readonly RoleKind[] = [...DRIVING_ROLES, 'finance', 'admin', 'dispatcher', 'support', 'field_ops'];
/** Console document review (scoring §2: "ops review in Console — ID vs selfie, plate vs photo"). */
export const DOCUMENT_REVIEWERS: readonly RoleKind[] = ['field_ops', 'support', 'admin'];

/**
 * `driverAccount.*` (partner spec "Also": earnings and ledger with cap bar, scorecard with nudges,
 * documents and expiry, daily selfie check-in). Reads with `driverId` other than the caller's are
 * back office only.
 */
export const driverAccountRouter = router({
  earnings: protectedProcedure(DRIVER_ACCOUNT_READERS)
    .input(EarningsInput)
    .output(EarningsView)
    .query(({ ctx, input }) => ctx.driverAccount.earnings(ctx.actor, input)),
  scorecard: protectedProcedure(DRIVER_ACCOUNT_READERS)
    .input(ScorecardInput)
    .output(ScorecardView)
    .query(({ ctx, input }) => ctx.driverAccount.scorecard(ctx.actor, input)),
  documents: protectedProcedure(DRIVER_ACCOUNT_READERS)
    .input(DocumentsInput)
    .output(DocumentsView)
    .query(({ ctx, input }) => ctx.driverAccount.documents(ctx.actor, input)),
  /** Upload first with `places.photoUpload`, then reference the upload id here. */
  uploadDocument: protectedProcedure(DRIVING_ROLES)
    .input(UploadDocumentInput)
    .output(DriverDocumentView)
    .mutation(({ ctx, input }) => ctx.driverAccount.uploadDocument(ctx.actor, input)),
  reviewDocument: protectedProcedure(DOCUMENT_REVIEWERS)
    .input(ReviewDocumentInput)
    .output(DriverDocumentView)
    .mutation(({ ctx, input }) => ctx.driverAccount.reviewDocument(ctx.actor, input)),
  /**
   * His main photo (Ali, 2026-10-06): what customers see now (the approved one, signed URL) and his
   * latest submission's state — «تنتظر الموافقة» / «مقبولة» / «مرفوضة: {reason}».
   */
  mainPhoto: protectedProcedure(DRIVING_ROLES)
    .output(MainPhotoView)
    .query(({ ctx }) => ctx.driverAccount.mainPhoto(ctx.actor)),
  /** A new main photo (upload first with `places.photoUpload`): goes to the Console approvals queue. */
  setMainPhoto: protectedProcedure(DRIVING_ROLES)
    .input(SetMainPhotoInput)
    .output(MainPhotoView)
    .mutation(({ ctx, input }) => ctx.driverAccount.setMainPhoto(ctx.actor, input)),
  /** Random liveness gesture, valid 2 minutes. */
  checkInChallenge: protectedProcedure(DRIVING_ROLES)
    .output(CheckInChallenge)
    .mutation(({ ctx }) => ctx.driverAccount.checkInChallenge(ctx.actor)),
  submitCheckIn: protectedProcedure(DRIVING_ROLES)
    .input(SubmitCheckInInput)
    .output(CheckInResult)
    .mutation(({ ctx, input }) => ctx.driverAccount.submitCheckIn(ctx.actor, input)),
  checkInStatus: protectedProcedure(DRIVING_ROLES)
    .output(CheckInStatus)
    .query(({ ctx }) => ctx.driverAccount.checkInStatus(ctx.actor)),
  /** Today's check-in done, not locked out, no expired document. */
  onlineGate: protectedProcedure(DRIVING_ROLES)
    .output(OnlineGate)
    .query(({ ctx }) => ctx.driverAccount.onlineGate(ctx.actor)),
  /** The code he reads to field ops when handing cash in. */
  handoverCode: protectedProcedure(DRIVING_ROLES)
    .output(HandoverCode)
    .query(({ ctx }) => ctx.driverAccount.handoverCode(ctx.actor)),
  /** G-91 shift guarantee: the peak shift now and this week's, counted on the server (progress, pending, paid). */
  guarantee: protectedProcedure(DRIVING_ROLES)
    .output(GuaranteeView)
    .query(({ ctx }) => ctx.driverAccount.guarantee(ctx.actor)),
  /** End of shift (partner S-4): the shift he just ended, the day, cash to hand over, tomorrow's busy window. */
  shiftSummary: protectedProcedure(DRIVING_ROLES)
    .input(ShiftSummaryInput)
    .output(ShiftSummary)
    .query(({ ctx, input }) => ctx.driverAccount.shiftSummary(ctx.actor, input)),
  /** «كلام الزبائن» (joy l4): the kind words customers picked for him, counted, and the latest. */
  compliments: protectedProcedure(DRIVING_ROLES)
    .output(CourierCompliments)
    .query(({ ctx }) => ctx.driverAccount.compliments(ctx.actor)),
  /**
   * «هيج يشوفك الزبون» (partner redesign r4): the profile a rider opens on his ride, of the driver
   * himself (photo, rating, trips, on time, since, car, confirmed features, top compliments).
   */
  publicProfile: protectedProcedure(DRIVING_ROLES)
    .output(DriverProfile)
    .query(({ ctx }) => ctx.rideHabits.ownProfile(ctx.actor)),
  /** "Why was I paid this" (partner S-7): one of his jobs, every line with its reason. */
  jobReceipt: protectedProcedure(DRIVING_ROLES)
    .input(JobReceiptInput)
    .output(JobReceipt)
    .query(({ ctx, input }) => ctx.driverAccount.jobReceipt(ctx.actor, input)),
  /** "عندي اعتراض": opens a support ticket with the job attached (one per job). */
  payQuery: protectedProcedure(DRIVING_ROLES)
    .input(PayQueryInput)
    .output(PayQueryResult)
    .mutation(({ ctx, input }) => ctx.driverAccount.payQuery(ctx.actor, input)),
});
