import { z } from 'zod';
import { CarryOverInput, CarryOverPreview, CatalogPicksInput, CatalogSearchDish, SearchUnmetInput, UNMET_SEARCH_ROLES, UnmetSearchesInput, UnmetSearchRow, CatalogSearchInput, CatalogSearchResult, CatalogToday, CatalogTodayInput, MenuInput, RestaurantCard, RestaurantMenu, RestaurantsInput, type CatalogReader } from '../catalog-io.js';
import type { Actor } from '../identity-io.js';
import { protectedProcedure, publicProcedure, router, type AppContext } from '../trpc.js';

/**
 * Who is reading: the signed-in caller when a valid token came with the request, otherwise a guest
 * seen only by the client IP (the implementation rate-limits guests, `CATALOG_PUBLIC_RATE`).
 */
function readerOf(ctx: AppContext): CatalogReader {
  const actor: Actor | null = ctx.auth ? { personId: ctx.auth.sub, sessionId: ctx.auth.sid, ...(ctx.auth.did ? { deviceId: ctx.auth.did } : {}) } : null;
  return { actor, ip: ctx.client?.ip ?? null };
}

/**
 * Customer catalog read (M3), public since guest browsing (Ali, 2026-10-04): home, the restaurant
 * list, search and menus open without an account; the phone number is asked at "كمّل الطلب".
 * Nothing here is personal (cards, menus, fee previews for a zone). Implementations live in
 * `modules/catalog` behind `ctx.catalog`.
 */
export const catalogRouter = router({
  restaurants: publicProcedure
    .input(RestaurantsInput)
    .output(z.array(RestaurantCard))
    .query(({ ctx, input }) => ctx.catalog.restaurants(readerOf(ctx), input)),
  menu: publicProcedure
    .input(MenuInput)
    .output(RestaurantMenu)
    .query(({ ctx, input }) => ctx.catalog.menu(readerOf(ctx), input)),
  /** Restaurants and dishes for a typed query (Arabic-folded); closed kitchens included, marked. */
  search: publicProcedure
    .input(CatalogSearchInput)
    .output(CatalogSearchResult)
    .query(({ ctx, input }) => ctx.catalog.search(readerOf(ctx), input)),
  /** After a rejection (joy o15): similar open kitchens, how much of the cart each makes, about what it costs. */
  carryOver: publicProcedure
    .input(CarryOverInput)
    .output(CarryOverPreview)
    .query(({ ctx, input }) => ctx.catalog.carryOver(readerOf(ctx), input)),
  /** The welcome screen's live proof (audit d-6): open kitchens, الرجعة cars today, a tuktuk fare, the garage, the delay promise. */
  today: publicProcedure
    .input(CatalogTodayInput)
    .output(CatalogToday)
    .query(({ ctx, input }) => ctx.catalog.today(readerOf(ctx), input)),
  /** Dishes from kitchens open now whose names start with one of the words (home's daypart band, search's meal words). */
  picks: publicProcedure
    .input(CatalogPicksInput)
    .output(z.array(CatalogSearchDish))
    .query(({ ctx, input }) => ctx.catalog.picks(readerOf(ctx), input)),
});

/**
 * One box for the whole town (joy h4): what a search could not find. The app sends the words when the
 * customer agrees («نگول للمطاعم؟» → «إي گولولهم»); the Console reads the most asked-for ones.
 */
export const searchRouter = router({
  unmet: publicProcedure
    .input(SearchUnmetInput)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => ctx.catalog.unmet(readerOf(ctx), input)),
  unmetList: protectedProcedure(UNMET_SEARCH_ROLES)
    .input(UnmetSearchesInput)
    .output(z.array(UnmetSearchRow))
    .query(({ ctx, input }) => ctx.catalog.unmetSearches(ctx.actor, input)),
});
