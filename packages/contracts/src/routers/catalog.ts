import { z } from 'zod';
import { MenuInput, RestaurantCard, RestaurantMenu, RestaurantsInput } from '../catalog-io.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Customer catalog read (M3): any signed-in person. Implementations live in `modules/catalog`
 * behind `ctx.catalog`.
 */
export const catalogRouter = router({
  restaurants: protectedProcedure()
    .input(RestaurantsInput)
    .output(z.array(RestaurantCard))
    .query(({ ctx, input }) => ctx.catalog.restaurants(ctx.actor, input)),
  menu: protectedProcedure()
    .input(MenuInput)
    .output(RestaurantMenu)
    .query(({ ctx, input }) => ctx.catalog.menu(ctx.actor, input)),
});
