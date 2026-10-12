import { z } from 'zod';
import { CourierParcelInput, CourierParcelPinInput, CourierParcelRefusal, CourierParcelView, ParcelDoorPage, ParcelDoorPageInput, ParcelIdInput, ParcelQuote, ParcelQuoteInput, ParcelView, SendParcelInput, SetParcelDoorInput } from '../parcels-io.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

/**
 * `parcels.*` طرود (Ali, 2026-10-12): the sender's quote, send, their parcels and one parcel's page;
 * `door.*` is the page the receiver opens from the text, public by its token (no account needed).
 * Implementations live in `modules/parcels`.
 */
export const parcelsRouter = router({
  quote: protectedProcedure().input(ParcelQuoteInput).output(ParcelQuote).query(({ ctx, input }) => ctx.parcels.quote(ctx.actor, input)),
  send: protectedProcedure().input(SendParcelInput).output(ParcelView).mutation(({ ctx, input }) => ctx.parcels.send(ctx.actor, input)),
  get: protectedProcedure().input(ParcelIdInput).output(ParcelView).query(({ ctx, input }) => ctx.parcels.get(ctx.actor, input)),
  mine: protectedProcedure().output(z.array(ParcelView)).query(({ ctx }) => ctx.parcels.mine(ctx.actor)),
  cancel: protectedProcedure().input(ParcelIdInput).output(ParcelView).mutation(({ ctx, input }) => ctx.parcels.cancel(ctx.actor, input)),
  newDoorLink: protectedProcedure().input(ParcelIdInput).output(ParcelView).mutation(({ ctx, input }) => ctx.parcels.newDoorLink(ctx.actor, input)),
  /** The courier's side: only the courier carrying that order (checked in the module). */
  courier: router({
    job: protectedProcedure().input(CourierParcelInput).output(CourierParcelView).query(({ ctx, input }) => ctx.parcels.courierJob(ctx.actor, input)),
    checkPin: protectedProcedure().input(CourierParcelPinInput).output(CourierParcelView).mutation(({ ctx, input }) => ctx.parcels.checkPin(ctx.actor, input)),
    refusalPreview: protectedProcedure().input(CourierParcelInput).output(CourierParcelRefusal).query(({ ctx, input }) => ctx.parcels.refusalPreview(ctx.actor, input)),
    refuse: protectedProcedure().input(CourierParcelInput).output(CourierParcelView).mutation(({ ctx, input }) => ctx.parcels.refuse(ctx.actor, input)),
  }),
  door: router({
    get: publicProcedure.input(ParcelDoorPageInput).output(ParcelDoorPage).query(({ ctx, input }) => ctx.parcels.doorPage(input)),
    set: publicProcedure.input(SetParcelDoorInput).output(ParcelDoorPage).mutation(({ ctx, input }) => ctx.parcels.setDoor(input)),
  }),
});
