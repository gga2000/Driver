import { DriverProfile, DriverProfileInput } from '../dispatch-io.js';
import { CreateShareLinkInput, RevokeShareLinkInput, SharedTrip, SharedTripInput, ShareLink } from '../share-io.js';
import { OrderRoute } from '../tracking.js';
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
  /** Public: the road from the shared car to where it is heading (maps program SP5c). */
  sharedRoute: publicProcedure
    .input(SharedTripInput)
    .output(OrderRoute)
    .query(({ ctx, input }) => ctx.trackingShare.sharedRoute(input)),
  /**
   * Ride step 3 (n5): a driver's profile on tap — one offered my searching ride, or the one assigned to
   * it (plate only then). The order's orderer or rider only (ride habits composes it).
   */
  driverProfile: protectedProcedure()
    .input(DriverProfileInput)
    .output(DriverProfile)
    .query(({ ctx, input }) => ctx.rideHabits.driverProfile(ctx.actor, input)),
});
