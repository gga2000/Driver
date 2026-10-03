import { z } from 'zod';
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
  RequestOtpInput,
  RequestOtpOutput,
  RevokeGuardianLinkInput,
  RevokeRoleInput,
  VerifyOtpInput,
  VerifyOtpOutput,
} from '../identity-io.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

const Ok = z.object({ ok: z.literal(true) });

/** Identity procedures (plan Step 2). Every mutation goes through `ctx.identity`, the API's port. */
export const identityRouter = router({
  requestOtp: publicProcedure.input(RequestOtpInput).output(RequestOtpOutput).mutation(({ ctx, input }) => ctx.identity.requestOtp(input)),
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
  /** Dev-only: the last OTP the fake provider sent to a phone. Refused when NODE_ENV=production. */
  devLastOtp: publicProcedure
    .input(DevLastOtpInput)
    .output(DevLastOtpOutput)
    .query(({ ctx, input }) => {
      if (ctx.env.nodeEnv === 'production') throw new DriverError('dev_only');
      return ctx.identity.devLastOtp(input.phone);
    }),
});
