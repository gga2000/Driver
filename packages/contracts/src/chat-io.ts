import { z } from 'zod';
import { t, type Locale, type MessageKey } from '@driver/i18n';
import { LatLng } from './common.js';
import type { Actor } from './identity-io.js';

/**
 * In-order chat and masked calls (notifications & support spec §2: "in-app chat inside the order
 * screen, outbound masked calls only"; customer app spec §4: "message with quick replies, masked
 * call"). One thread per order and pair of parties:
 *
 *  - `customer_courier`  — the customer and the courier / driver carrying the order or ride;
 *  - `merchant_courier`  — the kitchen and the courier picking the order up;
 *  - `customer_merchant` — the customer and the kitchen, for questions about the order.
 *
 * Support (support, dispatcher, admin) may read and join any thread. A thread opens at accept (the
 * courier's accept for the courier threads, the kitchen's for `customer_merchant`) and closes 30
 * minutes after the order or ride is done (read-only from then). People appear by role and first
 * name only; the kitchen by its store name. Phone numbers typed into a message are masked by the
 * server before the message is stored.
 */

export const ChatThreadKind = z.enum(['customer_courier', 'merchant_courier', 'customer_merchant']);
export type ChatThreadKind = z.infer<typeof ChatThreadKind>;

/** Who wrote a message (or who a participant is) inside a thread. */
export const ChatRole = z.enum(['customer', 'courier', 'merchant', 'support']);
export type ChatRole = z.infer<typeof ChatRole>;

export const ChatMessageKind = z.enum(['text', 'quick_reply', 'photo', 'location']);
export type ChatMessageKind = z.infer<typeof ChatMessageKind>;

/** `not_open`: before accept · `open` · `closed`: 30 min after completion (read-only). */
export const ChatThreadStatus = z.enum(['not_open', 'open', 'closed']);
export type ChatThreadStatus = z.infer<typeof ChatThreadStatus>;

/** The two parties of each thread kind (support joins any of them). */
export const CHAT_THREAD_PARTIES: Readonly<Record<ChatThreadKind, readonly [ChatRole, ChatRole]>> = {
  customer_courier: ['customer', 'courier'],
  merchant_courier: ['merchant', 'courier'],
  customer_merchant: ['customer', 'merchant'],
};

export const CHAT_TEXT_MAX = 500;
/** A thread stays readable — and writable — this long after the order or ride is done. */
export const CHAT_CLOSE_AFTER_MIN = 30;
/** Clients poll the open thread this often until the push/subscription channel ships. */
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
  customer_have_note: { role: 'customer', kinds: ['customer_merchant'] },
  merchant_delay_5: { role: 'merchant', kinds: ['merchant_courier', 'customer_merchant'] },
  merchant_ready: { role: 'merchant', kinds: ['merchant_courier'] },
  merchant_item_out: { role: 'merchant', kinds: ['customer_merchant'] },
  merchant_left_with_courier: { role: 'merchant', kinds: ['customer_merchant'] },
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

/** Push body: the message preview, or "دزلك صورة" / "دزلك لوكيشن". */
export function chatPushBody(messageKind: ChatMessageKind, preview: string | null, locale: Locale = 'ar-IQ'): string {
  if (preview) return preview;
  return t(messageKind === 'photo' ? 'push.chat_message.photo' : 'push.chat_message.location', {}, locale);
}

// ───────────────────────── views ─────────────────────────

export const ChatMessage = z.object({
  id: z.string(),
  /** 1, 2, 3 … per thread: the read receipts and incremental polls key on it. */
  seq: z.number().int().positive(),
  senderRole: ChatRole,
  /** Written by the reader. */
  mine: z.boolean(),
  kind: ChatMessageKind,
  /** Text as stored (phone numbers masked); a quick reply's Arabic text; null for photo / location. */
  text: z.string().nullable(),
  quickReplyKey: QuickReplyKey.nullable(),
  /** Signed, short-lived read URL of a photo message. */
  photoUrl: z.string().nullable(),
  location: LatLng.nullable(),
  /** The server hid a phone number in this message (the app explains: calls go through the app). */
  masked: z.boolean(),
  createdAt: z.coerce.date(),
  /** Mine and seen by the other party (read receipt). Always false for others' messages. */
  read: z.boolean(),
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
  /** When it closes (completion + 30 min); null while the order is still running. */
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
  })
  .refine((v) => [v.text, v.quickReplyKey, v.photoUploadId, v.location].filter((x) => x !== undefined).length === 1, {
    message: 'exactly one of text, quickReplyKey, photoUploadId, location',
  });
export type ChatSendInput = z.infer<typeof ChatSendInput>;

export const ChatMarkReadInput = z.object({ orderId: z.string().min(1), kind: ChatThreadKind, seq: z.number().int().min(0) });
export type ChatMarkReadInput = z.infer<typeof ChatMarkReadInput>;

export const ChatMarkReadOutput = z.object({ myReadSeq: z.number().int().min(0), unread: z.number().int().min(0) });
export type ChatMarkReadOutput = z.infer<typeof ChatMarkReadOutput>;

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
  /** Short preview: the (masked) text or the quick reply, cut to 80 characters; null for photo / location. */
  preview: z.string().nullable(),
});
export type ChatMessageSentPayload = z.infer<typeof ChatMessageSentPayload>;

// ───────────────────────── port ─────────────────────────

/** Implemented by the API's `chat` module. Every call checks the actor is a party (or support). */
export interface ChatPort {
  threads(actor: Actor, input: ChatThreadsInput): Promise<ChatThreadSummary[]>;
  thread(actor: Actor, input: ChatThreadInput): Promise<ChatThreadView>;
  send(actor: Actor, input: ChatSendInput): Promise<ChatMessage>;
  markRead(actor: Actor, input: ChatMarkReadInput): Promise<ChatMarkReadOutput>;
  requestCall(actor: Actor, input: ChatRequestCallInput): Promise<CallSession>;
}
