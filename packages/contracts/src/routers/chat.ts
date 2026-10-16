import { z } from 'zod';
import { CallSession, ChatLostItemInput, ChatLostItemResult, ChatLostItemThread, ChatMarkReadInput, ChatMarkReadOutput, ChatMessage, ChatRequestCallInput, ChatSendInput, ChatThreadInput, ChatThreadsInput, ChatThreadSummary, ChatThreadView, ChatVoiceUploadInput, VoiceUploadTicket } from '../chat-io.js';
import { TripChatMarkReadInput, TripChatSendInput, TripChatSummary, TripChatThreadInput, TripChatThreadsInput, TripChatView, TripChatVoiceUploadInput } from '../trip-chat-io.js';
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
  /** A signed upload for a voice note (≤ 60 s, ≤ 1 MB): PUT the recording, then `send` with `voiceUploadId`. */
  voiceUpload: protectedProcedure()
    .input(ChatVoiceUploadInput)
    .output(VoiceUploadTicket)
    .mutation(({ ctx, input }) => ctx.chat.voiceUpload(ctx.actor, input)),
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
  /**
   * Baghdad/Kut (step 4c): a rider and the driver of a seat run or a private-car offer, one thread per
   * pair, with the agreed-price cards and the «اللي اتفقنا عليه» strip (docs/api/trip-chat.md).
   */
  trip: router({
    thread: protectedProcedure()
      .input(TripChatThreadInput)
      .output(TripChatView)
      .query(({ ctx, input }) => ctx.tripChat.thread(ctx.actor, input)),
    /** The caller's threads on one run or request (the driver's riders; the rider's drivers). */
    threads: protectedProcedure()
      .input(TripChatThreadsInput)
      .output(z.array(TripChatSummary))
      .query(({ ctx, input }) => ctx.tripChat.threads(ctx.actor, input)),
    send: protectedProcedure()
      .input(TripChatSendInput)
      .output(ChatMessage)
      .mutation(({ ctx, input }) => ctx.tripChat.send(ctx.actor, input)),
    voiceUpload: protectedProcedure()
      .input(TripChatVoiceUploadInput)
      .output(VoiceUploadTicket)
      .mutation(({ ctx, input }) => ctx.tripChat.voiceUpload(ctx.actor, input)),
    markRead: protectedProcedure()
      .input(TripChatMarkReadInput)
      .output(ChatMarkReadOutput)
      .mutation(({ ctx, input }) => ctx.tripChat.markRead(ctx.actor, input)),
  }),
});
