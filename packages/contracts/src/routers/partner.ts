import { z } from 'zod';
import { AnswerClimateCheckInput } from '../climate-check.js';
import { AnswerBookedJobInput, PARTNER_DRIVING_ROLES, PARTNER_ROLES, PartnerBookedJobs, PartnerDemandMap, PartnerGoOnlineInput, PartnerJob, PartnerOffer, PartnerOfferRouteInput, PartnerStatus } from '../partner-io.js';
import { OrderRoute } from '../tracking.js';
import { ConfirmTopUpInput, TopUpConfirmation, TopUpLookupInput, TopUpLookupView } from '../topup-io.js';
import { protectedProcedure, router } from '../trpc.js';
import { AnswerZoneCheckInput, ZoneCheckPrompt } from '../zones-io.js';

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
  /** «المكيّفة شغالة اليوم؟» (ride idea x1): his answer for this shift; only ride drivers are asked. */
  answerClimateCheck: protectedProcedure(['driver'])
    .input(AnswerClimateCheckInput)
    .output(PartnerStatus)
    .mutation(({ ctx, input }) => ctx.partner.answerClimateCheck(ctx.actor, input)),
  /** The open offer for this driver (pay components, ring deadline, batch), or null. */
  currentOffer: protectedProcedure(PARTNER_DRIVING_ROLES)
    .output(PartnerOffer.nullable())
    .query(({ ctx }) => ctx.partner.currentOffer(ctx.actor)),
  /** The trip he is working with its run sheet summary, or null. */
  activeJob: protectedProcedure(PARTNER_DRIVING_ROLES)
    .output(PartnerJob.nullable())
    .query(({ ctx }) => ctx.partner.activeJob(ctx.actor)),
  /** The road to the open offer's kitchen (rides and doors: none until accepted). */
  offerRoute: protectedProcedure(PARTNER_DRIVING_ROLES)
    .input(PartnerOfferRouteInput)
    .output(OrderRoute)
    .query(({ ctx, input }) => ctx.partner.offerRoute(ctx.actor, input)),
  /** The road through his job's remaining stops. */
  jobRoute: protectedProcedure(PARTNER_DRIVING_ROLES)
    .output(OrderRoute)
    .query(({ ctx }) => ctx.partner.jobRoute(ctx.actor)),
  /** Busy zones for the driver's map (refresh every minute). */
  demandMap: protectedProcedure(PARTNER_DRIVING_ROLES)
    .output(PartnerDemandMap)
    .query(({ ctx }) => ctx.partner.demandMap(ctx.actor)),
  /** «مشاوير باچر» (review #28): booked rides he confirmed, and the ones that fit him to confirm. */
  bookedJobs: protectedProcedure(PARTNER_DRIVING_ROLES)
    .output(PartnerBookedJobs)
    .query(({ ctx }) => ctx.partner.bookedJobs(ctx.actor)),
  /** Confirm or pass on an open booked ride; release or start his own. */
  answerBookedJob: protectedProcedure(PARTNER_DRIVING_ROLES)
    .input(AnswerBookedJobInput)
    .output(PartnerBookedJobs)
    .mutation(({ ctx, input }) => ctx.partner.answerBookedJob(ctx.actor, input)),
  /** "انت بمنطقة X؟" after a delivery (maps program SP3): his one open question, or null. */
  zoneCheck: protectedProcedure(PARTNER_DRIVING_ROLES)
    .output(ZoneCheckPrompt.nullable())
    .query(({ ctx }) => ctx.zoneChecks.open(ctx.actor)),
  /** His answer to that question (إي / لا / ما أعرف); only his own, only while it is open. */
  answerZoneCheck: protectedProcedure(PARTNER_DRIVING_ROLES)
    .input(AnswerZoneCheckInput)
    .output(z.void())
    .mutation(({ ctx, input }) => ctx.zoneChecks.answer(ctx.actor, input)),
  /** Courier path of the cash top-up: only for a customer whose order he is carrying now. */
  topUpLookup: protectedProcedure(['courier'])
    .input(TopUpLookupInput)
    .output(TopUpLookupView)
    .query(({ ctx, input }) => ctx.topups.lookup(ctx.actor, input, 'courier')),
  /** The courier took the cash: the wallet is credited and the cash counts as held by him (his cap). */
  confirmTopUp: protectedProcedure(['courier'])
    .input(ConfirmTopUpInput)
    .output(TopUpConfirmation)
    .mutation(({ ctx, input }) => ctx.topups.confirm(ctx.actor, input, 'courier')),
});
