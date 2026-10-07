import { z } from 'zod';
import { CallSession, ChatLostItemInput, ChatLostItemResult, ChatLostItemThread, ChatMarkReadInput, ChatMarkReadOutput, ChatMessage, ChatRequestCallInput, ChatSendInput, ChatThreadInput, ChatThreadsInput, ChatThreadSummary, ChatThreadView } from '../chat-io.js';
import { protectedProcedure, router } from '../trpc.js';
import { DRIVING_ROLES } from './trips.js';

/**
 * In-order chat and masked calls (`modules/chat` behind `ctx.chat`). Any signed-in person may call;
 * the service checks on every call that the actor is a party of the thread (or support).
 */
export const chatRouter = router({
  /** The threads of an order the caller is in, with unread counts (badges on the call/chat buttons). */
  threads: protectedProcedure()
    .input(ChatThreadsInput)
    .output(z.array(ChatThreadSummary))
    .query(({ ctx, input }) => ctx.chat.threads(ctx.actor, input)),
  thread: protectedProcedure()
    .input(ChatThreadInput)
    .output(ChatThreadView)
    .query(({ ctx, input }) => ctx.chat.thread(ctx.actor, input)),
  send: protectedProcedure()
    .input(ChatSendInput)
    .output(ChatMessage)
    .mutation(({ ctx, input }) => ctx.chat.send(ctx.actor, input)),
  markRead: protectedProcedure()
    .input(ChatMarkReadInput)
    .output(ChatMarkReadOutput)
    .mutation(({ ctx, input }) => ctx.chat.markRead(ctx.actor, input)),
  /** A masked call to the other party: a platform number in production, never a raw number. */
  requestCall: protectedProcedure()
    .input(ChatRequestCallInput)
    .output(CallSession)
    .mutation(({ ctx, input }) => ctx.chat.requestCall(ctx.actor, input)),
  /** s7 «نسيت غرض»: reopens the chat with the driver of a ride completed in the last 24 h. */
  lostItem: protectedProcedure()
    .input(ChatLostItemInput)
    .output(ChatLostItemResult)
    .mutation(({ ctx, input }) => ctx.chat.lostItem(ctx.actor, input)),
  /** s7: the driver's open «نسيت غرض» chats (partner app). */
  lostItems: protectedProcedure(DRIVING_ROLES)
    .output(z.array(ChatLostItemThread))
    .query(({ ctx }) => ctx.chat.lostItems(ctx.actor)),
});
