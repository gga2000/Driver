import { z } from 'zod';
import {
  AvoidDriverInput,
  AvoidedDriverView,
  ConfirmOccurrenceInput,
  DinnerChance,
  DinnerTime,
  DinnerTimeInput,
  FavouriteDriverView,
  FavouriteInput,
  OccurrenceInput,
  OccurrenceView,
  RecentDriverView,
  RegularTripIdInput,
  RegularTripView,
  SaveRegularTripInput,
  UnavoidInput,
  UnfavouriteInput,
} from '../ride-habits-io.js';
import { BookedRideInput, BookedRideStatus } from '../booked-rides.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * `rideHabits.*` (joy J7d): favourite drivers (l9), regular trips that ask before they book (r5) and
 * dinner timed to the ride home (r6). Every call is the signed-in person's own.
 */
export const rideHabitsRouter = router({
  favourites: protectedProcedure().output(z.array(FavouriteDriverView)).query(({ ctx }) => ctx.rideHabits.favourites(ctx.actor)),
  favourite: protectedProcedure().input(FavouriteInput).output(z.array(FavouriteDriverView)).mutation(({ ctx, input }) => ctx.rideHabits.favourite(ctx.actor, input)),
  unfavourite: protectedProcedure().input(UnfavouriteInput).output(z.array(FavouriteDriverView)).mutation(({ ctx, input }) => ctx.rideHabits.unfavourite(ctx.actor, input)),
  /** s5 «ما أريده مرة ثانية»: the driver of one of my rides never gets my rides again. */
  avoid: protectedProcedure().input(AvoidDriverInput).output(z.array(AvoidedDriverView)).mutation(({ ctx, input }) => ctx.rideHabits.avoid(ctx.actor, input)),
  avoided: protectedProcedure().output(z.array(AvoidedDriverView)).query(({ ctx }) => ctx.rideHabits.avoided(ctx.actor)),
  unavoid: protectedProcedure().input(UnavoidInput).output(z.array(AvoidedDriverView)).mutation(({ ctx, input }) => ctx.rideHabits.unavoid(ctx.actor, input)),
  recentGood: protectedProcedure().output(RecentDriverView.nullable()).query(({ ctx }) => ctx.rideHabits.recentGood(ctx.actor)),
  regular: router({
    list: protectedProcedure().output(z.array(RegularTripView)).query(({ ctx }) => ctx.rideHabits.regularList(ctx.actor)),
    save: protectedProcedure().input(SaveRegularTripInput).output(RegularTripView).mutation(({ ctx, input }) => ctx.rideHabits.regularSave(ctx.actor, input)),
    remove: protectedProcedure().input(RegularTripIdInput).output(z.object({ ok: z.literal(true) })).mutation(({ ctx, input }) => ctx.rideHabits.regularRemove(ctx.actor, input)),
    occurrence: protectedProcedure().input(OccurrenceInput).output(OccurrenceView).query(({ ctx, input }) => ctx.rideHabits.occurrence(ctx.actor, input)),
    confirm: protectedProcedure().input(ConfirmOccurrenceInput).output(OccurrenceView).mutation(({ ctx, input }) => ctx.rideHabits.confirm(ctx.actor, input)),
    skip: protectedProcedure().input(OccurrenceInput).output(OccurrenceView).mutation(({ ctx, input }) => ctx.rideHabits.skip(ctx.actor, input)),
  }),
  /** Review #28: whether a driver confirmed his ride booked for later («سايقك محجوز: حسين»), or when we tell him. */
  bookedRide: protectedProcedure().input(BookedRideInput).output(BookedRideStatus).query(({ ctx, input }) => ctx.rideHabits.bookedRide(ctx.actor, input)),
  dinnerChance: protectedProcedure().output(DinnerChance.nullable()).query(({ ctx }) => ctx.rideHabits.dinnerChance(ctx.actor)),
  dinnerTime: protectedProcedure().input(DinnerTimeInput).output(DinnerTime).query(({ ctx, input }) => ctx.rideHabits.dinnerTime(ctx.actor, input)),
});
