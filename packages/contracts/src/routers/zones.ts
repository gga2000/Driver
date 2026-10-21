import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';
import { ClearZoneCheckFlagInput, CreateZoneInput, PlaceZoneInput, RemoveZoneInput, RenameZoneInput, SetZoneTierInput, ZONE_EDIT_ROLES, ZONE_TIER_ROLES, ZoneTierFare, ZONE_READ_ROLES, ZonePlacementView, ZonesInput } from '../zones-io.js';

/** `ops.zones.*` — the zone outlines (maps program SP3). Saving an outline does not move any fee; `setTier` does. */
export const opsZonesRouter = router({
  list: protectedProcedure(ZONE_READ_ROLES)
    .input(ZonesInput)
    .output(z.array(ZonePlacementView))
    .query(({ ctx, input }) => ctx.zones.list(input.cityId)),
  /** Every app map, no sign-in: the outlines and names only, never who drew them or drivers' answers. */
  map: publicProcedure
    .input(ZonesInput)
    .output(z.array(ZonePlacementView))
    .query(async ({ ctx, input }) => (await ctx.zones.list(input.cityId)).map((zone) => ({ ...zone, placedBy: null, checks: undefined }))),
  place: protectedProcedure(ZONE_EDIT_ROLES)
    .input(PlaceZoneInput)
    .output(ZonePlacementView)
    .mutation(({ ctx, input }) => ctx.zones.place(ctx.actor, input)),
  create: protectedProcedure(ZONE_EDIT_ROLES).input(CreateZoneInput).output(ZonePlacementView)
    .mutation(({ ctx, input }) => ctx.zones.create!(ctx.actor, input)),
  rename: protectedProcedure(ZONE_EDIT_ROLES).input(RenameZoneInput).output(ZonePlacementView)
    .mutation(({ ctx, input }) => ctx.zones.rename!(ctx.actor, input)),
  remove: protectedProcedure(ZONE_EDIT_ROLES).input(RemoveZoneInput).output(z.void())
    .mutation(({ ctx, input }) => ctx.zones.remove!(ctx.actor, input)),
  /** Moves an area to another group; its fees follow the group (delivery, taxi, tuktuk). */
  setTier: protectedProcedure(ZONE_TIER_ROLES).input(SetZoneTierInput).output(ZonePlacementView)
    .mutation(({ ctx, input }) => ctx.zones.setTier!(ctx.actor, input)),
  tierFares: protectedProcedure(ZONE_READ_ROLES).input(ZonesInput).output(z.array(ZoneTierFare))
    .query(({ ctx, input }) => ctx.zones.tierFares!(input.cityId)),
  /** «تم الفحص»: the people who draw outlines are the ones who judge a driver's "لا" about one. */
  clearCheckFlag: protectedProcedure(ZONE_EDIT_ROLES).input(ClearZoneCheckFlagInput).output(ZonePlacementView)
    .mutation(({ ctx, input }) => ctx.zones.clearCheckFlag(ctx.actor, input)),
});
