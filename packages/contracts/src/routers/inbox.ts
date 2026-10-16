import { z } from 'zod';
import {
  INBOX_READ_ROLES,
  INBOX_WORK_ROLES,
  InboxAssignInput,
  InboxCounts,
  InboxCountsInput,
  InboxDoneInput,
  InboxListInput,
  InboxNoteInput,
  InboxRow,
  InboxSnoozeInput,
  InboxTakeInput,
} from '../inbox-io.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * `inbox.*` — Console › اليوم: one row per problem (opened and closed by the server from events),
 * taken, handed over, snoozed or closed with an outcome by the desk. Every change is audited.
 */
export const inboxRouter = router({
  list: protectedProcedure(INBOX_READ_ROLES)
    .input(InboxListInput)
    .output(z.array(InboxRow))
    .query(({ ctx, input }) => ctx.inbox.list(ctx.actor, input)),
  counts: protectedProcedure(INBOX_READ_ROLES)
    .input(InboxCountsInput)
    .output(InboxCounts)
    .query(({ ctx, input }) => ctx.inbox.counts(ctx.actor, input)),
  take: protectedProcedure(INBOX_WORK_ROLES)
    .input(InboxTakeInput)
    .output(InboxRow)
    .mutation(({ ctx, input }) => ctx.inbox.take(ctx.actor, input)),
  assign: protectedProcedure(INBOX_WORK_ROLES)
    .input(InboxAssignInput)
    .output(InboxRow)
    .mutation(({ ctx, input }) => ctx.inbox.assign(ctx.actor, input)),
  snooze: protectedProcedure(INBOX_WORK_ROLES)
    .input(InboxSnoozeInput)
    .output(InboxRow)
    .mutation(({ ctx, input }) => ctx.inbox.snooze(ctx.actor, input)),
  done: protectedProcedure(INBOX_WORK_ROLES)
    .input(InboxDoneInput)
    .output(InboxRow)
    .mutation(({ ctx, input }) => ctx.inbox.done(ctx.actor, input)),
  note: protectedProcedure(INBOX_WORK_ROLES)
    .input(InboxNoteInput)
    .output(InboxRow)
    .mutation(({ ctx, input }) => ctx.inbox.note(ctx.actor, input)),
});
