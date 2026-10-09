import { z } from 'zod';
import { CHAT_TEXT_MAX, ChatThreadStatus, ChatThreadView, QuickReplyKey, VOICE_RULES, VoiceContentType, type ChatMarkReadOutput, type ChatMessage, type VoiceUploadTicket } from './chat-io.js';
import { LatLng } from './common.js';
import type { Actor } from './identity-io.js';

/**
 * Baghdad/Kut chat (private car round 2 step 4c; Ali's item 11 and design way 2, 2026-10-08): a rider
 * and the driver of a seat run or of a private-car offer talk in one thread per pair, and the prices
 * they agree (`routes.agreements.*`, the private car's «احجز وادفع كاش») show in it as cards, with a
 * pinned «اللي اتفقنا عليه» strip. Chat only shows them; the rules stay with the agreements.
 *
 * A thread is named by its subject and the other side:
 *  - `departure`: a seat run (`dep_…`). The rider names it by the run alone; the driver adds `with`, the rider.
 *  - `request`: a private-car request (`rq_…`). The rider adds `with`, the driver who offered; the driver
 *    names it by the request alone.
 * docs/api/trip-chat.md has who may open which thread and when it closes.
 */

export const TripChatSubject = z.enum(['departure', 'request']);
export type TripChatSubject = z.infer<typeof TripChatSubject>;

const Ref = {
  subject: TripChatSubject,
  /** The run or request id. */
  id: z.string().min(1),
  /** The other side: the rider (the driver of a run asking) or the driver (the rider of a request asking). */
  with: z.string().min(1).optional(),
};

export const TripChatRef = z.object(Ref);
export type TripChatRef = z.infer<typeof TripChatRef>;

export const TripChatThreadInput = z.object({ ...Ref, afterSeq: z.number().int().min(0).optional() });
export type TripChatThreadInput = z.infer<typeof TripChatThreadInput>;

export const TripChatSendInput = z
  .object({
    ...Ref,
    clientId: z.string().min(6).max(64),
    text: z.string().trim().min(1).max(CHAT_TEXT_MAX).optional(),
    quickReplyKey: QuickReplyKey.optional(),
    photoUploadId: z.string().min(1).optional(),
    location: LatLng.optional(),
    voiceUploadId: z.string().min(1).optional(),
    durationSec: z.number().int().min(1).max(VOICE_RULES.maxSec).optional(),
  })
  .refine((v) => [v.text, v.quickReplyKey, v.photoUploadId, v.location, v.voiceUploadId].filter((x) => x !== undefined).length === 1, {
    message: 'exactly one of text, quickReplyKey, photoUploadId, location, voiceUploadId',
  })
  .refine((v) => (v.voiceUploadId !== undefined) === (v.durationSec !== undefined), { message: 'durationSec goes with voiceUploadId (and only with it)' });
export type TripChatSendInput = z.infer<typeof TripChatSendInput>;

export const TripChatVoiceUploadInput = z.object({
  ...Ref,
  contentType: VoiceContentType,
  sizeBytes: z.number().int().positive().max(VOICE_RULES.maxBytes),
});
export type TripChatVoiceUploadInput = z.infer<typeof TripChatVoiceUploadInput>;

export const TripChatMarkReadInput = z.object({ ...Ref, seq: z.number().int().min(0) });
export type TripChatMarkReadInput = z.infer<typeof TripChatMarkReadInput>;

/** The threads of one run or request the caller is in (the driver's riders, the rider's drivers). */
export const TripChatThreadsInput = z.object({ subject: TripChatSubject, id: z.string().min(1) });
export type TripChatThreadsInput = z.infer<typeof TripChatThreadsInput>;

/** One line of the pinned «اللي اتفقنا عليه» strip: a live price between the two. */
export const TripDealItem = z.object({
  kind: z.enum(['pin_pickup', 'door_drop', 'cash_reservation']),
  refId: z.string(),
  /** `asked`: waiting for the driver · `proposed`: waiting for the rider · `agreed`: accepted (or locked on the booking). */
  state: z.enum(['asked', 'proposed', 'agreed']),
  /** The price (0 = «ببلاش»); a cash line: the no-show amount; null while only asked. */
  amountIqd: z.number().int().min(0).nullable(),
  /** Locked on the booking. */
  locked: z.boolean(),
});
export type TripDealItem = z.infer<typeof TripDealItem>;

/** What the header says about the trip: «علي · لبغداد» / «الطلعة باچر 7:00 · ما حجزت بعد». */
export const TripChatTrip = z.object({
  subject: TripChatSubject,
  id: z.string(),
  fromCityId: z.string().nullable(),
  toCityId: z.string().nullable(),
  /** The place the far end names: the city for a run, the drop's label for a private car. */
  toLabel: z.string().nullable(),
  when: z.coerce.date(),
  /** The rider has a seat on the run (or the private car is his, picked). */
  booked: z.boolean(),
});
export type TripChatTrip = z.infer<typeof TripChatTrip>;

export const TripChatView = ChatThreadView.extend({
  subject: TripChatSubject,
  /** The other side's id the thread is keyed by (the rider on a run, the driver on a request). */
  partyId: z.string(),
  trip: TripChatTrip,
  deal: z.array(TripDealItem),
});
export type TripChatView = z.infer<typeof TripChatView>;

export const TripChatSummary = z.object({
  subject: TripChatSubject,
  id: z.string(),
  /** The other side's person id (the `with` to open it). */
  withId: z.string(),
  /** The other side's first name (vault read, logged); null when unknown. */
  withName: z.string().nullable(),
  status: ChatThreadStatus,
  unread: z.number().int().min(0),
  lastMessageAt: z.coerce.date().nullable(),
  /** Prices waiting on the caller (an ask to price, a price to answer). */
  waitingOnYou: z.number().int().min(0),
});
export type TripChatSummary = z.infer<typeof TripChatSummary>;

/** Implemented by the API's `chat` module (`TripChatService`): every call checks the caller is one of the pair. */
export interface TripChatPort {
  thread(actor: Actor, input: TripChatThreadInput): Promise<TripChatView>;
  threads(actor: Actor, input: TripChatThreadsInput): Promise<TripChatSummary[]>;
  send(actor: Actor, input: TripChatSendInput): Promise<ChatMessage>;
  voiceUpload(actor: Actor, input: TripChatVoiceUploadInput): Promise<VoiceUploadTicket>;
  markRead(actor: Actor, input: TripChatMarkReadInput): Promise<ChatMarkReadOutput>;
  /** The pair's live channel party, after the same access check as `thread` (no names, no messages). */
  liveParty(actor: Actor, input: TripChatRef): Promise<string>;
}
