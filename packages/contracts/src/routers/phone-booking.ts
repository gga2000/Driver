import { z } from 'zod';
import { CancellationFee } from '../order.js';
import {
  BookByPhoneInput,
  PHONE_BOOKING_ROLES,
  PhoneBookingCaller,
  PhoneBookingCallerInput,
  PhoneBookingOrderInput,
  PhoneBookingQuote,
  PhoneBookingQuoteInput,
  PhoneBookingRow,
  PhoneBookingsTodayInput,
} from '../phone-booking-io.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * `phoneBookings.*` — Console › حجز بالتلفون (taxi/tuktuk step 4): a caller without the app gets an
 * ordinary cash ride on their number, quoted by the server and audited under the staff member who
 * booked it. Support, dispatchers and admins only.
 */
export const phoneBookingsRouter = router({
  caller: protectedProcedure(PHONE_BOOKING_ROLES)
    .input(PhoneBookingCallerInput)
    .output(PhoneBookingCaller)
    .query(({ ctx, input }) => ctx.phoneBookings.caller(ctx.actor, input)),
  quote: protectedProcedure(PHONE_BOOKING_ROLES)
    .input(PhoneBookingQuoteInput)
    .output(PhoneBookingQuote)
    .query(({ ctx, input }) => ctx.phoneBookings.quote(ctx.actor, input)),
  book: protectedProcedure(PHONE_BOOKING_ROLES)
    .input(BookByPhoneInput)
    .output(PhoneBookingRow)
    .mutation(({ ctx, input }) => ctx.phoneBookings.book(ctx.actor, input)),
  today: protectedProcedure(PHONE_BOOKING_ROLES)
    .input(PhoneBookingsTodayInput)
    .output(z.array(PhoneBookingRow))
    .query(({ ctx, input }) => ctx.phoneBookings.today(ctx.actor, input)),
  cancelPreview: protectedProcedure(PHONE_BOOKING_ROLES)
    .input(PhoneBookingOrderInput)
    .output(CancellationFee)
    .query(({ ctx, input }) => ctx.phoneBookings.cancelPreview(ctx.actor, input)),
  cancel: protectedProcedure(PHONE_BOOKING_ROLES)
    .input(PhoneBookingOrderInput)
    .output(PhoneBookingRow)
    .mutation(({ ctx, input }) => ctx.phoneBookings.cancel(ctx.actor, input)),
});
