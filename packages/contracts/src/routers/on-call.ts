import { z } from 'zod';
import {
  AlertLadder,
  AlertLadderInput,
  ConsolePresentInput,
  ConsoleWatch,
  ON_CALL_EDIT_ROLES,
  ON_CALL_READ_ROLES,
  OnCallAddInput,
  OnCallEndInput,
  OnCallListInput,
  OnCallNow,
  OnCallNowInput,
  OnCallShiftRow,
  OnCallStaff,
} from '../on-call-io.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * `onCall.*` — Console › المناوبة: who is reached when an alert reaches nobody, and each alert's
 * ladder (who was rung, when, and whether it is still unanswered). Every staff desk reads it; only
 * admins change it, and every change is audited.
 */
export const onCallRouter = router({
  list: protectedProcedure(ON_CALL_READ_ROLES)
    .input(OnCallListInput)
    .output(z.array(OnCallShiftRow))
    .query(({ ctx, input }) => ctx.onCall.list(ctx.actor, input)),
  now: protectedProcedure(ON_CALL_READ_ROLES)
    .input(OnCallNowInput)
    .output(z.array(OnCallNow))
    .query(({ ctx, input }) => ctx.onCall.now(ctx.actor, input)),
  add: protectedProcedure(ON_CALL_EDIT_ROLES)
    .input(OnCallAddInput)
    .output(OnCallShiftRow)
    .mutation(({ ctx, input }) => ctx.onCall.add(ctx.actor, input)),
  end: protectedProcedure(ON_CALL_EDIT_ROLES)
    .input(OnCallEndInput)
    .output(OnCallShiftRow)
    .mutation(({ ctx, input }) => ctx.onCall.end(ctx.actor, input)),
  ladder: protectedProcedure(ON_CALL_READ_ROLES)
    .input(AlertLadderInput)
    .output(AlertLadder.nullable())
    .query(({ ctx, input }) => ctx.onCall.ladder(ctx.actor, input)),
  staff: protectedProcedure(ON_CALL_EDIT_ROLES)
    .output(z.array(OnCallStaff))
    .query(({ ctx }) => ctx.onCall.staff(ctx.actor)),
  /** Every open staff screen, every 30 s: "I'm here", and how its live updates are doing. */
  present: protectedProcedure(ON_CALL_READ_ROLES)
    .input(ConsolePresentInput)
    .output(ConsoleWatch)
    .mutation(({ ctx, input }) => ctx.onCall.present(ctx.actor, input)),
});
