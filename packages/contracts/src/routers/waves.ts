import { SetWaveSlotsInput, WavesInput, WavesView, ZoneWaveView, AccessView } from '../waves-io.js';
import { protectedProcedure, router } from '../trpc.js';
import { CONSOLE_READ_ROLES } from './console.js';
import { CONTROL_ROLES } from './control-room.js';

/** `access.*` — the customer's place in line (customer waves, W5). */
export const accessRouter = router({
  status: protectedProcedure()
    .output(AccessView)
    .query(({ ctx }) => ctx.access.status(ctx.actor)),
});

/** `ops.waves.*` — open places per zone (Console; admin / dispatcher to change, like the throttle). */
export const opsWavesRouter = router({
  view: protectedProcedure(CONSOLE_READ_ROLES)
    .input(WavesInput)
    .output(WavesView)
    .query(({ ctx, input }) => ctx.access.waves(input)),
  setSlots: protectedProcedure(CONTROL_ROLES)
    .input(SetWaveSlotsInput)
    .output(ZoneWaveView)
    .mutation(({ ctx, input }) => ctx.access.setSlots(ctx.actor, input)),
});
