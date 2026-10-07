import {
  ArmGarageTaxiInput,
  BookToGarageInput,
  GarageArmView,
  GarageTaxiInput,
  GarageTaxiLink,
  GarageTaxiOrderInput,
  ToGarageInput,
  ToGaragePlan,
} from '../garage-taxi-io.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * `garageTaxi.*` (taxi ideas x2, x3, x4 + n10): a taxi timed to the rider's الرجعة car, the late notice
 * when that taxi runs late, and the taxi armed to wait at the Aziziyah garage on the way back. Every
 * call is the signed-in rider's own seat or ride.
 */
export const garageTaxiRouter = router({
  toGarage: protectedProcedure().input(ToGarageInput).output(ToGaragePlan).query(({ ctx, input }) => ctx.garageTaxi.toGarage(ctx.actor, input)),
  bookToGarage: protectedProcedure().input(BookToGarageInput).output(ToGaragePlan).mutation(({ ctx, input }) => ctx.garageTaxi.bookToGarage(ctx.actor, input)),
  forOrder: protectedProcedure().input(GarageTaxiOrderInput).output(GarageTaxiLink.nullable()).query(({ ctx, input }) => ctx.garageTaxi.forOrder(ctx.actor, input)),
  arrival: protectedProcedure().input(GarageTaxiInput).output(GarageArmView).query(({ ctx, input }) => ctx.garageTaxi.arrival(ctx.actor, input)),
  arm: protectedProcedure().input(ArmGarageTaxiInput).output(GarageArmView).mutation(({ ctx, input }) => ctx.garageTaxi.arm(ctx.actor, input)),
  disarm: protectedProcedure().input(GarageTaxiInput).output(GarageArmView).mutation(({ ctx, input }) => ctx.garageTaxi.disarm(ctx.actor, input)),
});
