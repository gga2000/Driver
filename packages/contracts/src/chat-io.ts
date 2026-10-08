import { z } from 'zod';
import { t, type Locale, type MessageKey } from '@driver/i18n';
import { PhotoUploadTicket } from './account-io.js';
import { LatLng } from './common.js';
import type { Actor } from './identity-io.js';

/**
 * In-order chat and masked calls (notifications & support spec §2: "in-app chat inside the order
 * screen, outbound masked calls only"; customer app spec §4: "message with quick replies, masked
 * call"). One thread per order and pair of parties:
 *
 *  - `customer_courier`  — the customer and the courier / driver carrying the order or ride;
 *  - `merchant_courier`  — the kitchen and the courier picking the order up;
 *  - `customer_merchant` — the customer and the kitchen, for questions about the order;
 *  - `customer_support`  — the customer and our support desk about this order («كلّم الدعم»). Open
 *    from placement until `CHAT_SUPPORT_CLOSE_AFTER_H` after the order is done; the desk answers it
 *    from the Console case (it opens a support ticket by itself, docs/api/support-chat.md).
 *  - `rider_driver`      — Baghdad/Kut (private car round 2 step 4c): a rider and the driver of a seat
 *    run or of a private-car offer, one thread per pair, with the agreed-price cards. Its key is the
 *    run or request id plus the other side (`chat.trip.*`, trip-chat-io.ts, docs/api/trip-chat.md).
 *
 * Support (support, dispatcher, admin) may read and join any thread. A thread opens at accept (the
 * courier's accept for the courier threads, the kitchen's for `customer_merchant`) and closes 30
 * minutes after the order or ride is done (read-only from then). People appear by role and first
 * name only; the kitchen by its store name. Phone numbers typed into a message are masked by the
 * server before the message is stored.
 */

export const ChatThreadKind = z.enum(['customer_courier', 'merchant_courier', 'customer_merchant', 'customer_support', 'rider_driver']);
export type ChatThreadKind = z.infer<typeof ChatThreadKind>;

/** Who wrote a message (or who a participant is) inside a thread. */
export const ChatRole = z.enum(['customer', 'courier', 'merchant', 'support']);
export type ChatRole = z.infer<typeof ChatRole>;

/**
 * `system`: a line the server writes into the thread (s7 «الراكب يدور على غرض نساه»); nobody types one.
 * `card`: an agreed-price card in a `rider_driver` thread (step 4c), written by the server when a price is
 * asked or named; its live state comes with the message (`ChatMessage.card`).
 */
export const ChatMessageKind = z.enum(['text', 'quick_reply', 'photo', 'location', 'voice', 'system', 'card']);
export type ChatMessageKind = z.infer<typeof ChatMessageKind>;

/** `not_open`: before accept · `open` · `closed`: 30 min after completion (read-only). */
export const ChatThreadStatus = z.enum(['not_open', 'open', 'closed']);
export type ChatThreadStatus = z.infer<typeof ChatThreadStatus>;

/** The two parties of each thread kind (support joins any of them). */
export const CHAT_THREAD_PARTIES: Readonly<Record<ChatThreadKind, readonly [ChatRole, ChatRole]>> = {
  customer_courier: ['customer', 'courier'],
  merchant_courier: ['merchant', 'courier'],
  customer_merchant: ['customer', 'merchant'],
  customer_support: ['customer', 'support'],
  rider_driver: ['customer', 'courier'],
};

export const CHAT_TEXT_MAX = 500;
/** A thread stays readable — and writable — this long after the order or ride is done. */
export const CHAT_CLOSE_AFTER_MIN = 30;
/** The support chat stays writable this long after the order is done (the same-day answer rule needs room). */
export const CHAT_SUPPORT_CLOSE_AFTER_H = 24;
/**
 * s7 «نسيت غرض»: within this many hours of a completed ride the customer may reopen the chat with the
 * driver, and it stays open until this many hours after the ride ended (`chat.lostItem`).
 */
export const CHAT_LOST_ITEM_H = 24;
/** A customer opens at most this many new support chats (one per order) per 24 h; messages keep the normal send limit. */
export const CHAT_SUPPORT_OPENS_PER_DAY = 5;
/**
 * Voice notes (ride ideas n7/n8): hold the mic to record, release to send, slide to cancel. A note is at
 * most `maxSec` long and `maxBytes` big (mono AAC / Opus at ~48 kb/s is about 360 KB a minute). The file
 * is gone with the chat: the server deletes it once the thread closes and the bubble says so.
 */
export const VOICE_RULES = { maxSec: 60, maxBytes: 1_000_000 } as const;
/**
 * What a recorder writes: m4a (iOS and Android, Safari) is `audio/mp4`, a raw ADTS stream `audio/aac`,
 * Chrome's MediaRecorder `audio/webm` (Opus), Firefox's `audio/ogg` (Opus). The server checks the
 * file's first bytes against the declared type.
 */
export const VoiceContentType = z.enum(['audio/mp4', 'audio/aac', 'audio/webm', 'audio/ogg']);
export type VoiceContentType = z.infer<typeof VoiceContentType>;

/**
 * Where voice notes are offered: the customer and his courier / driver, and the customer and our
 * support desk (n7/n8). The kitchen's threads stay text and photos (the merchant app has no player).
 */
export const VOICE_THREAD_KINDS: readonly ChatThreadKind[] = ['customer_courier', 'customer_support', 'rider_driver'];
export function voiceAllowedIn(kind: ChatThreadKind): boolean {
  return VOICE_THREAD_KINDS.includes(kind);
}

/** Old poll interval of the open thread; the apps now get messages over `live.chat` (kept for older clients). */
export const CHAT_POLL_MS = 3000;

// ───────────────────────── quick replies ─────────────────────────

interface QuickReplyDef {
  role: ChatRole;
  kinds: readonly ChatThreadKind[];
  /** `only`: rides (taxi, tuktuk) · `never`: deliveries only · absent: both. */
  ride?: 'only' | 'never';
}

/**
 * One-tap messages per role, Iraqi Arabic in `@driver/i18n` under `chat.qr.<key>` (both locales).
 * The server stores the key and renders the Arabic text into the message, so a reader on any
 * locale, the console and the push notification all see the same words.
 */
export const QUICK_REPLIES = {
  courier_at_door: { role: 'courier', kinds: ['customer_courier'], ride: 'never' },
  courier_cant_find: { role: 'courier', kinds: ['customer_courier'] },
  courier_on_the_way: { role: 'courier', kinds: ['customer_courier'], ride: 'never' },
  courier_outside: { role: 'courier', kinds: ['customer_courier'], ride: 'only' },
  courier_two_min: { role: 'courier', kinds: ['customer_courier'] },
  courier_at_restaurant: { role: 'courier', kinds: ['merchant_courier'] },
  courier_how_long: { role: 'courier', kinds: ['merchant_courier'] },
  courier_five_min: { role: 'courier', kinds: ['merchant_courier'] },
  customer_other_gate: { role: 'customer', kinds: ['customer_courier'] },
  customer_leave_at_door: { role: 'customer', kinds: ['customer_courier'], ride: 'never' },
  customer_coming_out: { role: 'customer', kinds: ['customer_courier'] },
  customer_ring_bell: { role: 'customer', kinds: ['customer_courier'], ride: 'never' },
  customer_wait_minute: { role: 'customer', kinds: ['customer_courier'] },
  customer_how_long: { role: 'customer', kinds: ['customer_merchant'] },
  customer_support_late: { role: 'customer', kinds: ['customer_support'] },
  customer_support_wrong: { role: 'customer', kinds: ['customer_support'], ride: 'never' },
  customer_support_courier: { role: 'customer', kinds: ['customer_support'], ride: 'never' },
  customer_support_driver: { role: 'customer', kinds: ['customer_support'], ride: 'only' },
  customer_support_money: { role: 'customer', kinds: ['customer_support'] },
  customer_have_note: { role: 'customer', kinds: ['customer_merchant'] },
  merchant_delay_5: { role: 'merchant', kinds: ['merchant_courier', 'customer_merchant'] },
  merchant_ready: { role: 'merchant', kinds: ['merchant_courier'] },
  merchant_item_out: { role: 'merchant', kinds: ['customer_merchant'] },
  merchant_left_with_courier: { role: 'merchant', kinds: ['customer_merchant'] },
  // Baghdad/Kut (step 4c): the rider and the driver of his run or private car.
  rider_trip_where: { role: 'customer', kinds: ['rider_driver'] },
  rider_trip_bags: { role: 'customer', kinds: ['rider_driver'] },
  rider_trip_coming: { role: 'customer', kinds: ['rider_driver'] },
  driver_trip_on_time: { role: 'courier', kinds: ['rider_driver'] },
  driver_trip_at_garage: { role: 'courier', kinds: ['rider_driver'] },
  driver_trip_bags_ok: { role: 'courier', kinds: ['rider_driver'] },
} as const satisfies Record<string, QuickReplyDef>;

export type QuickReplyKey = keyof typeof QUICK_REPLIES;
export const QuickReplyKey = z.enum(Object.keys(QUICK_REPLIES) as [QuickReplyKey, ...QuickReplyKey[]]);

/** The quick replies `role` may send in a thread of `kind` (rides get the driver's set). */
export function quickRepliesFor(role: ChatRole, kind: ChatThreadKind, ride: boolean): QuickReplyKey[] {
  return (Object.keys(QUICK_REPLIES) as QuickReplyKey[]).filter((k) => {
    const d: QuickReplyDef = QUICK_REPLIES[k];
    if (d.role !== role || !d.kinds.includes(kind)) return false;
    if (d.ride === 'only' && !ride) return false;
    if (d.ride === 'never' && ride) return false;
    return true;
  });
}

/** The words of a quick reply (`chat.qr.<key>`). */
export function quickReplyText(key: QuickReplyKey, locale: Locale = 'ar-IQ'): string {
  return t(`chat.qr.${key}` as MessageKey, {}, locale);
}

/** Push title for a new message: "رسالة جديدة من الدليفري / السايق / المطعم / الزبون / الدعم". */
export function chatPushTitle(senderRole: ChatRole, ride: boolean, locale: Locale = 'ar-IQ'): string {
  const who = senderRole === 'courier' ? (ride ? 'driver' : 'courier') : senderRole;
  return t(`push.chat_message.title_${who}` as MessageKey, {}, locale);
}

/** Push body: the message preview, or "دزلك صورة" / "دزلك لوكيشن" / "رسالة صوتية". */
export function chatPushBody(messageKind: ChatMessageKind, preview: string | null, locale: Locale = 'ar-IQ'): string {
  if (preview) return preview;
  if (messageKind === 'voice') return t('push.chat_message.voice', {}, locale);
  // Step 4c: an agreed-price card (a price asked or named) on a Baghdad/Kut trip.
  if (messageKind === 'card') return t('push.chat_message.card' as MessageKey, {}, locale);
  return t(messageKind === 'photo' ? 'push.chat_message.photo' : 'push.chat_message.location', {}, locale);
}

// ───────────────────────── views ─────────────────────────

/**
 * Step 4c: what an agreed-price card is about. `pin_pickup` and `door_drop` are a seat run's agreements
 * (`routes.agreements.*`); `cash_reservation` is a private-car offer's «احجز وادفع كاش» ask (step 4b).
 */
export const TripCardKind = z.enum(['pin_pickup', 'door_drop', 'cash_reservation']);
export type TripCardKind = z.infer<typeof TripCardKind>;

/**
 * Where the thing the card is about stands now, read when the thread is read:
 * `asked` (waiting for the driver's price or answer) · `proposed` (a price waiting for the rider) ·
 * `accepted` · `declined` · `expired` · `withdrawn` · `used` (locked on a booking) ·
 * `replaced` (a newer card about the same thing: this one is history).
 */
export const TripCardState = z.enum(['asked', 'proposed', 'accepted', 'declined', 'expired', 'withdrawn', 'used', 'replaced']);
export type TripCardState = z.infer<typeof TripCardState>;

export const TripChatCard = z.object({
  kind: TripCardKind,
  /** The agreement (`ag_…`) or the private-car offer the card is about. */
  refId: z.string(),
  /** What the message was: the rider's ask, or a price the driver named. */
  stage: z.enum(['ask', 'price']),
  /** The amount this card named (0 = «ببلاش»); null on an ask. A cash card: the no-show amount. */
  amountIqd: z.number().int().min(0).nullable(),
  state: TripCardState,
  /** The rider's note on the place («قرب السيطرة»); null when none. */
  note: z.string().nullable(),
  /** A pin pickup: how far the pin is from the garage the run leaves from (km, one decimal); else null. */
  distanceKm: z.number().nullable(),
  /** An unanswered price lapses then (30 min, a7). */
  expiresAt: z.coerce.date().nullable(),
});
export type TripChatCard = z.infer<typeof TripChatCard>;

export const ChatMessage = z.object({
  id: z.string(),
  /** 1, 2, 3 … per thread: the read receipts and incremental polls key on it. */
  seq: z.number().int().positive(),
  senderRole: ChatRole,
  /** Written by the reader. */
  mine: z.boolean(),
  kind: ChatMessageKind,
  /** Text as stored (phone numbers masked); a quick reply's Arabic text; null for photo / location / voice. */
  text: z.string().nullable(),
  quickReplyKey: QuickReplyKey.nullable(),
  /** Signed, short-lived read URL of a photo message. */
  photoUrl: z.string().nullable(),
  location: LatLng.nullable(),
  /**
   * Signed, short-lived read URL of a voice note; null on other kinds and on a voice note whose file
   * went with the closed chat (the bubble says «انتهت الرسالة الصوتية»).
   */
  audioUrl: z.string().nullable(),
  /** A voice note's length in whole seconds (1–`VOICE_RULES.maxSec`); null on other kinds. */
  durationSec: z.number().int().positive().nullable(),
  /** The server hid a phone number in this message (the app explains: calls go through the app). */
  masked: z.boolean(),
  createdAt: z.coerce.date(),
  /** Mine and seen by the other party (read receipt). Always false for others' messages. */
  read: z.boolean(),
  /** A `card` message's card (step 4c); absent or null on every other kind. */
  card: TripChatCard.nullable().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatParticipant = z.object({
  role: ChatRole,
  /** First name for people (vault read, logged); the store name for the kitchen; null when unknown. */
  name: z.string().nullable(),
  you: z.boolean(),
});
export type ChatParticipant = z.infer<typeof ChatParticipant>;

export const ChatThreadView = z.object({
  threadId: z.string().nullable(),
  orderId: z.string(),
  kind: ChatThreadKind,
  status: ChatThreadStatus,
  /** When it closes (completion + 30 min; the support chat completion + 24 h); null while the order is still running. */
  closesAt: z.coerce.date().nullable(),
  myRole: ChatRole,
  /** The order is a ride (taxi / tuktuk): the app says "السايق" and offers the driver's replies. */
  ride: z.boolean(),
  participants: z.array(ChatParticipant),
  /** Oldest first. With `afterSeq` only the newer ones. */
  messages: z.array(ChatMessage),
  /** Highest seq in the thread (0 when empty). */
  lastSeq: z.number().int().min(0),
  /** Highest seq the reader has read. */
  myReadSeq: z.number().int().min(0),
  unread: z.number().int().min(0),
  quickReplies: z.array(QuickReplyKey),
  /** Whether the reader may ask for a masked call in this thread right now. */
  canCall: z.boolean(),
  serverNow: z.coerce.date(),
});
export type ChatThreadView = z.infer<typeof ChatThreadView>;

export const ChatThreadSummary = z.object({
  kind: ChatThreadKind,
  status: ChatThreadStatus,
  myRole: ChatRole,
  /** The other party of the pair (for the button label). */
  counterpart: ChatRole,
  unread: z.number().int().min(0),
  lastMessageAt: z.coerce.date().nullable(),
  canCall: z.boolean(),
});
export type ChatThreadSummary = z.infer<typeof ChatThreadSummary>;

// ───────────────────────── inputs ─────────────────────────

export const ChatThreadsInput = z.object({ orderId: z.string().min(1) });
export type ChatThreadsInput = z.infer<typeof ChatThreadsInput>;

export const ChatThreadInput = z.object({
  orderId: z.string().min(1),
  kind: ChatThreadKind,
  /** Incremental poll: only messages after this seq (the rest of the view is always whole). */
  afterSeq: z.number().int().min(0).optional(),
});
export type ChatThreadInput = z.infer<typeof ChatThreadInput>;

export const ChatSendInput = z
  .object({
    orderId: z.string().min(1),
    kind: ChatThreadKind,
    /** Client-generated id: a retried send returns the first message and writes nothing. */
    clientId: z.string().min(6).max(64),
    text: z.string().trim().min(1).max(CHAT_TEXT_MAX).optional(),
    quickReplyKey: QuickReplyKey.optional(),
    /** A finished `places.photoUpload` of the sender. */
    photoUploadId: z.string().min(1).optional(),
    location: LatLng.optional(),
    /** A finished `chat.voiceUpload` of the sender, with `durationSec`. */
    voiceUploadId: z.string().min(1).optional(),
    /** The voice note's length as the recorder measured it, rounded up to whole seconds. */
    durationSec: z.number().int().min(1).max(VOICE_RULES.maxSec).optional(),
  })
  .refine((v) => [v.text, v.quickReplyKey, v.photoUploadId, v.location, v.voiceUploadId].filter((x) => x !== undefined).length === 1, {
    message: 'exactly one of text, quickReplyKey, photoUploadId, location, voiceUploadId',
  })
  .refine((v) => (v.voiceUploadId !== undefined) === (v.durationSec !== undefined), { message: 'durationSec goes with voiceUploadId (and only with it)' });
export type ChatSendInput = z.infer<typeof ChatSendInput>;

/**
 * A signed upload for a voice note in this thread (the same ticket as `places.photoUpload`): the caller
 * must be able to write in the thread now. PUT the recording, then `chat.send` with `voiceUploadId`.
 */
export const ChatVoiceUploadInput = z.object({
  orderId: z.string().min(1),
  kind: ChatThreadKind,
  contentType: VoiceContentType,
  sizeBytes: z.number().int().positive().max(VOICE_RULES.maxBytes),
});
export type ChatVoiceUploadInput = z.infer<typeof ChatVoiceUploadInput>;
export const VoiceUploadTicket = PhotoUploadTicket;
export type VoiceUploadTicket = PhotoUploadTicket;

export const ChatMarkReadInput = z.object({ orderId: z.string().min(1), kind: ChatThreadKind, seq: z.number().int().min(0) });
export type ChatMarkReadInput = z.infer<typeof ChatMarkReadInput>;

export const ChatMarkReadOutput = z.object({ myReadSeq: z.number().int().min(0), unread: z.number().int().min(0) });
export type ChatMarkReadOutput = z.infer<typeof ChatMarkReadOutput>;

/** s7 «نسيت غرض»: the customer reopens the chat with the driver of a completed ride. */
export const ChatLostItemInput = z.object({ orderId: z.string().min(1) });
export type ChatLostItemInput = z.infer<typeof ChatLostItemInput>;

export const ChatLostItemResult = z.object({
  /** The `customer_courier` thread, open again. */
  threadId: z.string(),
  /** It closes again at the ride's end + `CHAT_LOST_ITEM_H`. */
  openUntil: z.coerce.date(),
});
export type ChatLostItemResult = z.infer<typeof ChatLostItemResult>;

/** A reopened «نسيت غرض» chat on the driver's side (the partner app lists them until they close). */
export const ChatLostItemThread = z.object({
  orderId: z.string(),
  threadId: z.string(),
  openUntil: z.coerce.date(),
  /** When the customer asked. */
  askedAt: z.coerce.date(),
  unread: z.number().int().min(0),
});
export type ChatLostItemThread = z.infer<typeof ChatLostItemThread>;

export const ChatRequestCallInput = z.object({ orderId: z.string().min(1), kind: ChatThreadKind });
export type ChatRequestCallInput = z.infer<typeof ChatRequestCallInput>;

/**
 * A masked call. `proxy`: dial the platform number, which bridges to the other party (production,
 * telephony provider). `dev_direct`: development builds only — the other party's own number, so
 * the flow can be tried without a provider (every such read is a logged vault access).
 */
export const CallSession = z.object({
  callId: z.string(),
  mode: z.enum(['proxy', 'dev_direct']),
  /** What the phone dials (a `tel:` target). */
  dial: z.string(),
  counterpart: ChatRole,
  expiresAt: z.coerce.date(),
});
export type CallSession = z.infer<typeof CallSession>;

// ───────────────────────── events ─────────────────────────

/**
 * `chat.message_sent` (outbox → the chat module's notify subscriber pushes
 * "رسالة جديدة من الدليفري" to the other party). Carries no names or numbers.
 */
export const ChatMessageSentPayload = z.object({
  threadId: z.string(),
  orderId: z.string(),
  kind: ChatThreadKind,
  messageId: z.string(),
  seq: z.number().int().positive(),
  senderRole: ChatRole,
  messageKind: ChatMessageKind,
  /** A ride: the courier is "السايق" in the push title. */
  ride: z.boolean(),
  /** People to notify (the other party; the kitchen's on-shift staff). */
  recipientIds: z.array(z.string()),
  /** Short preview: the (masked) text or the quick reply, cut to 80 characters; null for photo / location / voice. */
  preview: z.string().nullable(),
  /**
   * A `rider_driver` thread (step 4c): the run or request (`orderId` is its id) and the other side of the
   * pair (the rider on a run, the driver on a request); null on order threads.
   */
  trip: z.object({ subject: z.enum(['departure', 'request']), partyId: z.string() }).nullable().default(null),
});
export type ChatMessageSentPayload = z.infer<typeof ChatMessageSentPayload>;

// ───────────────────────── port ─────────────────────────

/** Implemented by the API's `chat` module. Every call checks the actor is a party (or support). */
export interface ChatPort {
  threads(actor: Actor, input: ChatThreadsInput): Promise<ChatThreadSummary[]>;
  thread(actor: Actor, input: ChatThreadInput): Promise<ChatThreadView>;
  send(actor: Actor, input: ChatSendInput): Promise<ChatMessage>;
  voiceUpload(actor: Actor, input: ChatVoiceUploadInput): Promise<VoiceUploadTicket>;
  // (the desk's own reads and replies on `customer_support` go through `support.*`, see support-io)
  markRead(actor: Actor, input: ChatMarkReadInput): Promise<ChatMarkReadOutput>;
  requestCall(actor: Actor, input: ChatRequestCallInput): Promise<CallSession>;
  /** s7: reopens the chat with the driver of a completed ride (the orderer or the rider, within `CHAT_LOST_ITEM_H`). */
  lostItem(actor: Actor, input: ChatLostItemInput): Promise<ChatLostItemResult>;
  /** s7: the driver's reopened «نسيت غرض» chats that are still open, newest first. */
  lostItems(actor: Actor): Promise<ChatLostItemThread[]>;
}
