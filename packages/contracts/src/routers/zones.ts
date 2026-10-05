import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';
import { PlaceZoneInput, ZONE_EDIT_ROLES, ZONE_READ_ROLES, ZonePlacementView, ZonesInput } from '../zones-io.js';

/** `ops.zones.*` — the zone outlines (maps program SP3). Saving an outline does not move any fee. */
export const opsZonesRouter = router({
  list: protectedProcedure(ZONE_READ_ROLES)
    .input(ZonesInput)
    .output(z.array(ZonePlacementView))
    .query(({ ctx, input }) => ctx.zones.list(input.cityId)),
  place: protectedProcedure(ZONE_EDIT_ROLES)
    .input(PlaceZoneInput)
    .output(ZonePlacementView)
    .mutation(({ ctx, input }) => ctx.zones.place(ctx.actor, input)),
});
