import { CreateShareLinkInput, RevokeShareLinkInput, SharedTrip, SharedTripInput, ShareLink } from '../share-io.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

/**
 * Share-trip links (`modules/tracking` behind `ctx.trackingShare`). The customer's own live order
 * view stays on `orders.track` / `orders.courierPosition`.
 */
export const trackingRouter = router({
  createShareLink: protectedProcedure()
    .input(CreateShareLinkInput)
    .output(ShareLink)
    .mutation(({ ctx, input }) => ctx.trackingShare.createShareLink(ctx.actor, input)),
  revokeShareLink: protectedProcedure()
    .input(RevokeShareLinkInput)
    .output(ShareLink)
    .mutation(({ ctx, input }) => ctx.trackingShare.revokeShareLink(ctx.actor, input)),
  /** Public (no sign-in): the share page reads coarse trip data with the token alone. */
  shared: publicProcedure
    .input(SharedTripInput)
    .output(SharedTrip)
    .query(({ ctx, input }) => ctx.trackingShare.shared(input)),
});
