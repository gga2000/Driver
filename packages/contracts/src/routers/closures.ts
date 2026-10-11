import { z } from 'zod';
import { CLOSURE_EDIT_ROLES, CLOSURE_READ_ROLES, CloseStreetInput, ClosuresInput, ClosureView, OpenStreetInput, SnapClosureInput, SnappedClosure } from '../closures-io.js';
import { protectedProcedure, router } from '../trpc.js';

/** `ops.closures.*` — N20 «شارع مسدود»: streets closed for today, drawn on the Console map. */
export const opsClosuresRouter = router({
  /** Today's closures in the city: the closed ones first, then the ones opened or ended today. */
  list: protectedProcedure(CLOSURE_READ_ROLES)
    .input(ClosuresInput)
    .output(z.array(ClosureView))
    .query(({ ctx, input }) => ctx.closures.list(input)),
  /** The street between two taps, to draw before ops confirm. Changes nothing. */
  snap: protectedProcedure(CLOSURE_EDIT_ROLES)
    .input(SnapClosureInput)
    .output(SnappedClosure)
    .query(({ ctx, input }) => ctx.closures.snap(input)),
  /** Close it: every route goes around it until midnight (or the hour ops picked). */
  close: protectedProcedure(CLOSURE_EDIT_ROLES)
    .input(CloseStreetInput)
    .output(ClosureView)
    .mutation(({ ctx, input }) => ctx.closures.close(ctx.actor, input)),
  /** Open it before its time. */
  open: protectedProcedure(CLOSURE_EDIT_ROLES)
    .input(OpenStreetInput)
    .output(ClosureView)
    .mutation(({ ctx, input }) => ctx.closures.open(ctx.actor, input)),
});
