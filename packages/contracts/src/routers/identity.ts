import { z } from 'zod';
import { AccountCloseInput, AccountCloseView, CloseAccountInput, CloseAccountOutput, RequestDeletionInput, RequestDeletionOutput } from '../account-close-io.js';
import { RoleGrant, TokenPair } from '../auth.js';
import { DriverError } from '../errors.js';
import {
  ChangePhoneConfirmInput,
  ChangePhoneStartInput,
  ChangePhoneStartOutput,
  ConsentGuardianLinkInput,
  DevLastOtpInput,
  EndAllSessionsInput,
  EndAllSessionsOutput,
  StagingTestCodeInput,
  StagingTestCodeOutput,
  DevLastOtpOutput,
  GrantRoleInput,
  GuardianLinkView,
  LinkGuardianInput,
  LogoutInput,
  MeView,
  RefreshInput,
  ChildView,
  RegisterChildInput,
  RegisterChildOutput,
  RequestOtpInput,
  RequestOtpOutput,
  RevokeGuardianLinkInput,
  RevokeRoleInput,
  StaffTotpCodeInput,
  StaffTotpConfirmOutput,
  StaffTotpDemoOutput,
  StaffTotpEnrolOutput,
  StaffTotpLockView,
  StaffTotpEnrolView,
  StaffTotpResetInput,
  StaffTotpResetOutput,
  StaffTotpVerifyOutput,
  UpdateProfileInput,
  VerifyOtpInput,
  VerifyOtpOutput,
} from '../identity-io.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

const Ok = z.object({ ok: z.literal(true) });

/** Identity procedures (plan Step 2). Every mutation goes through `ctx.identity`, the API's port. */
export const identityRouter = router({
  /** Rate-limited per client IP and per device (M2 review follow-up): `rate_limited` with `retryAfterSec`. */
  requestOtp: publicProcedure.input(RequestOtpInput).output(RequestOtpOutput).mutation(({ ctx, input }) => ctx.identity.requestOtp(input, { ip: ctx.client?.ip ?? null })),
  verifyOtp: publicProcedure.input(VerifyOtpInput).output(VerifyOtpOutput).mutation(({ ctx, input }) => ctx.identity.verifyOtp(input)),
  refresh: publicProcedure.input(RefreshInput).output(TokenPair).mutation(({ ctx, input }) => ctx.identity.refresh(input.refreshToken, input.device)),
  logout: protectedProcedure()
    .input(LogoutInput)
    .output(Ok)
    .mutation(async ({ ctx, input }) => {
      await ctx.identity.logout(ctx.actor, input.refreshToken);
      return { ok: true as const };
    }),
  me: protectedProcedure().output(MeView).query(({ ctx }) => ctx.identity.me(ctx.actor)),
  /** Name and emergency contact → the vault only (customer spec §10). */
  updateProfile: protectedProcedure().input(UpdateProfileInput).output(MeView).mutation(({ ctx, input }) => ctx.identity.updateProfile(ctx.actor, input)),
  grantRole: protectedProcedure(['admin']).input(GrantRoleInput).output(RoleGrant).mutation(({ ctx, input }) => ctx.identity.grantRole(ctx.actor, input)),
  revokeRole: protectedProcedure(['admin'])
    .input(RevokeRoleInput)
    .output(Ok)
    .mutation(async ({ ctx, input }) => {
      await ctx.identity.revokeRole(ctx.actor, input);
      return { ok: true as const };
    }),
  /**
   * «طلّعه من كل الأجهزة» (Console «الموظفين»): every session of the person ends on every device. The
   * audit row lives with the Console's trail, so `ctx.controls` runs it (identity cannot write there).
   */
  endAllSessions: protectedProcedure(['admin']).input(EndAllSessionsInput).output(EndAllSessionsOutput).mutation(({ ctx, input }) => ctx.controls.endAllSessions(ctx.actor, input)),
  /**
   * Admin and finance sign-in's second step (docs/api/staff-totp.md). Signed in by SMS code only, those
   * roles are refused (`totp_required`) until `verify` (or the first `confirm`) passes on this session.
   */
  authenticator: router({
    /** First time: a new secret for the authenticator app (QR + text); refused once one is confirmed. */
    enrol: protectedProcedure().output(StaffTotpEnrolOutput).mutation(({ ctx }) => ctx.identity.staffTotpEnrol(ctx.actor)),
    /** The first code from the app confirms it; the 8 recovery codes come back once, never again. */
    confirm: protectedProcedure().input(StaffTotpCodeInput).output(StaffTotpConfirmOutput).mutation(({ ctx, input }) => ctx.identity.staffTotpConfirm(ctx.actor, input.code)),
    /** A code from the app, or one recovery code; 5 wrong in a row lock the step for 15 minutes. */
    verify: protectedProcedure().input(StaffTotpCodeInput).output(StaffTotpVerifyOutput).mutation(({ ctx, input }) => ctx.identity.staffTotpVerify(ctx.actor, input.code)),
    /** Demo mode only (STAFF_TOTP_DEMO, never on a deployed server): the code to fill in, like the dev SMS code. */
    demoCode: protectedProcedure()
      .output(StaffTotpDemoOutput)
      .query(({ ctx }) => {
        if (ctx.env.nodeEnv === 'production') throw new DriverError('dev_only');
        return ctx.identity.staffTotpDemoCode(ctx.actor);
      }),
    /** Staff whose step is locked right now (the Console safety strip). */
    locks: protectedProcedure(['admin']).output(z.array(StaffTotpLockView)).query(({ ctx }) => ctx.identity.staffTotpLocks(ctx.actor)),
    /** Other staff who set up an authenticator in the last day, first time or after a reset (the same strip). */
    enrolments: protectedProcedure(['admin']).output(z.array(StaffTotpEnrolView)).query(({ ctx }) => ctx.identity.staffTotpEnrolments(ctx.actor)),
    /** Another staff member's authenticator, cleared and audited; needs the admin's own fresh code. */
    reset: protectedProcedure(['admin']).input(StaffTotpResetInput).output(StaffTotpResetOutput).mutation(({ ctx, input }) => ctx.controls.resetStaffTotp(ctx.actor, input)),
  }),
  linkGuardian: protectedProcedure().input(LinkGuardianInput).output(GuardianLinkView).mutation(({ ctx, input }) => ctx.identity.linkGuardian(ctx.actor, input)),
  consentGuardianLink: protectedProcedure().input(ConsentGuardianLinkInput).output(GuardianLinkView).mutation(({ ctx, input }) => ctx.identity.consentGuardianLink(ctx.actor, input)),
  revokeGuardianLink: protectedProcedure().input(RevokeGuardianLinkInput).output(GuardianLinkView).mutation(({ ctx, input }) => ctx.identity.revokeGuardianLink(ctx.actor, input)),
  changePhone: router({
    start: protectedProcedure().input(ChangePhoneStartInput).output(ChangePhoneStartOutput).mutation(({ ctx, input }) => ctx.identity.changePhoneStart(ctx.actor, input)),
    confirm: protectedProcedure().input(ChangePhoneConfirmInput).output(MeView).mutation(({ ctx, input }) => ctx.identity.changePhoneConfirm(ctx.actor, input)),
  }),
  /** «احذف حسابي» (partner and merchant apps): opens a support case of kind `deletion`; asking again returns the open one. */
  requestDeletion: protectedProcedure().input(RequestDeletionInput).output(RequestDeletionOutput).mutation(({ ctx, input }) => ctx.support.requestDeletion(ctx.actor, input)),
  /**
   * Console, admin only (docs/api/account-close.md): what stands in the way of closing a partner's or
   * merchant's account, and the close itself — refused while he holds cash, has a job open or money is
   * unsettled; erases his identity and his document, selfie and photo files, keeps the ledger and trips.
   */
  closeAccount: router({
    check: protectedProcedure(['admin']).input(AccountCloseInput).output(AccountCloseView).query(({ ctx, input }) => ctx.accountClose.check(ctx.actor, input)),
    close: protectedProcedure(['admin']).input(CloseAccountInput).output(CloseAccountOutput).mutation(({ ctx, input }) => ctx.accountClose.close(ctx.actor, input)),
  }),
  /** خطوط: a guardian registers a child (name into the vault, opaque childRef back). */
  registerChild: protectedProcedure().input(RegisterChildInput).output(RegisterChildOutput).mutation(({ ctx, input }) => ctx.identity.registerChild(ctx.actor, input)),
  /** The guardian's own children, names read from the vault (logged). */
  myChildren: protectedProcedure().output(z.array(ChildView)).query(({ ctx }) => ctx.identity.myChildren(ctx.actor)),
  /** Dev-only: the last OTP the fake provider sent to a phone. Refused when NODE_ENV=production. */
  devLastOtp: publicProcedure
    .input(DevLastOtpInput)
    .output(DevLastOtpOutput)
    .query(({ ctx, input }) => {
      if (ctx.env.nodeEnv === 'production') throw new DriverError('dev_only');
      return ctx.identity.devLastOtp(input.phone);
    }),
  /**
   * Staging only: the fixed code of a staging test number, for the «عبّيه» button on the code screen.
   * Null on every other host, for every other number, and for a test number that holds a staff role.
   */
  stagingTestCode: publicProcedure
    .input(StagingTestCodeInput)
    .output(StagingTestCodeOutput)
    .query(({ ctx, input }) => ctx.identity.stagingTestCode(input.phone)),
});
