import { ClaimInviteInput, ClaimInviteOutput, InvitePreview, InvitePreviewInput, InviteView } from '../referral-io.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

/**
 * `referral.*` — invite as a gift (joy g2). `mine` and `claim` need a session; `preview` is public so
 * the landing page (`/i/<code>`) can greet a friend who has no account yet.
 */
export const referralRouter = router({
  mine: protectedProcedure().output(InviteView).query(({ ctx }) => ctx.referrals.mine(ctx.actor)),
  preview: publicProcedure.input(InvitePreviewInput).output(InvitePreview).query(({ ctx, input }) => ctx.referrals.preview(input)),
  claim: protectedProcedure().input(ClaimInviteInput).output(ClaimInviteOutput).mutation(({ ctx, input }) => ctx.referrals.claim(ctx.actor, input)),
});
