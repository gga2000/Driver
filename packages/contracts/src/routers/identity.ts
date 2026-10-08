import { z } from 'zod';
import { DeletionCheckView, DeletionConfirmInput, DeletionConfirmOutput, DeletionStartOutput } from '../account-deletion-io.js';
import { RoleGrant, TokenPair } from '../auth.js';
import { DriverError } from '../errors.js';
import {
  ChangePhoneConfirmInput,
  ChangePhoneStartInput,
  ChangePhoneStartOutput,
  ConsentGuardianLinkInput,
  DevLastOtpInput,
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
  linkGuardian: protectedProcedure().input(LinkGuardianInput).output(GuardianLinkView).mutation(({ ctx, input }) => ctx.identity.linkGuardian(ctx.actor, input)),
  consentGuardianLink: protectedProcedure().input(ConsentGuardianLinkInput).output(GuardianLinkView).mutation(({ ctx, input }) => ctx.identity.consentGuardianLink(ctx.actor, input)),
  revokeGuardianLink: protectedProcedure().input(RevokeGuardianLinkInput).output(GuardianLinkView).mutation(({ ctx, input }) => ctx.identity.revokeGuardianLink(ctx.actor, input)),
  changePhone: router({
    start: protectedProcedure().input(ChangePhoneStartInput).output(ChangePhoneStartOutput).mutation(({ ctx, input }) => ctx.identity.changePhoneStart(ctx.actor, input)),
    confirm: protectedProcedure().input(ChangePhoneConfirmInput).output(MeView).mutation(({ ctx, input }) => ctx.identity.changePhoneConfirm(ctx.actor, input)),
  }),
  /**
   * W7: a customer deletes his own account (docs/api/account-deletion.md). `start` sends a code to his
   * own number; `confirm` checks it, re-checks the blockers and deletes in one transaction.
   */
  deleteAccount: router({
    check: protectedProcedure().output(DeletionCheckView).query(({ ctx }) => ctx.identity.deletionCheck(ctx.actor)),
    start: protectedProcedure().output(DeletionStartOutput).mutation(({ ctx }) => ctx.identity.deletionStart(ctx.actor)),
    confirm: protectedProcedure().input(DeletionConfirmInput).output(DeletionConfirmOutput).mutation(({ ctx, input }) => ctx.identity.deletionConfirm(ctx.actor, input)),
    /** Dev-only: the last code sent to the caller's own number (the demo fills it). Refused when NODE_ENV=production. */
    devCode: protectedProcedure()
      .output(DevLastOtpOutput)
      .query(({ ctx }) => {
        if (ctx.env.nodeEnv === 'production') throw new DriverError('dev_only');
        return ctx.identity.deletionDevCode(ctx.actor);
      }),
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
});
