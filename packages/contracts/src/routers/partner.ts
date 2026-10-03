import { z } from 'zod';
import { PARTNER_DRIVING_ROLES, PARTNER_ROLES, PartnerGoOnlineInput, PartnerJob, PartnerOffer, PartnerStatus } from '../partner-io.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Driver Partner reads and presence (partner & merchant apps spec). Everything goes through
 * `ctx.partner`, implemented by the API's `partner` module. `status` is open to every partner role
 * (fleet owners and field ops see their hub); presence, offers and jobs need a driving role.
 */
export const partnerRouter = router({
  status: protectedProcedure(PARTNER_ROLES)
    .output(PartnerStatus)
    .query(({ ctx }) => ctx.partner.status(ctx.actor)),
  goOnline: protectedProcedure(PARTNER_DRIVING_ROLES)
    .input(PartnerGoOnlineInput)
    .output(PartnerStatus)
    .mutation(({ ctx, input }) => ctx.partner.goOnline(ctx.actor, input)),
  goOffline: protectedProcedure(PARTNER_DRIVING_ROLES)
    .input(z.object({}).optional())
    .output(PartnerStatus)
    .mutation(({ ctx }) => ctx.partner.goOffline(ctx.actor)),
  /** The open offer for this driver (pay components, ring deadline, batch), or null. */
  currentOffer: protectedProcedure(PARTNER_DRIVING_ROLES)
    .output(PartnerOffer.nullable())
    .query(({ ctx }) => ctx.partner.currentOffer(ctx.actor)),
  /** The trip he is working with its run sheet summary, or null. */
  activeJob: protectedProcedure(PARTNER_DRIVING_ROLES)
    .output(PartnerJob.nullable())
    .query(({ ctx }) => ctx.partner.activeJob(ctx.actor)),
});
