import type { ChatMessage, ChatRole, ChatThreadKind, ChatThreadSummary, LatLng, QuickReplyKey } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/**
 * Pure chat-screen logic (no React Native imports, unit-tested): labels, the optimistic list,
 * receipts and the day dividers. The screen polls `chat.thread` every `CHAT_POLL_MS` (3 s) until a
 * push / subscription channel ships.
 */

export type SendBody = { text: string } | { quickReplyKey: QuickReplyKey } | { photoUploadId: string } | { location: LatLng };

/** A message on its way: shown at the bottom until the server has it (then the poll replaces it). */
export interface PendingMessage {
  clientId: string;
  body: SendBody;
  /** What to draw while it travels (the quick reply's words, the local photo, the pin). */
  text: string | null;
  localPhotoUri: string | null;
  status: 'sending' | 'failed';
  createdAt: Date;
}

export type ChatRow =
  | { type: 'day'; key: string; label: 'today' | Date }
  | { type: 'message'; key: string; message: ChatMessage }
  | { type: 'pending'; key: string; pending: PendingMessage };

/** "الدليفري" for deliveries, "السايق" for rides. */
export function roleKey(role: ChatRole, ride: boolean): MessageKey {
  if (role === 'courier') return ride ? 'chat.role.driver' : 'chat.role.courier';
  return `chat.role.${role}` as MessageKey;
}

/** The other party of a thread kind as seen by `me`. */
export function counterpartRole(kind: ChatThreadKind, me: ChatRole): ChatRole {
  const pair: Record<ChatThreadKind, [ChatRole, ChatRole]> = {
    customer_courier: ['customer', 'courier'],
    merchant_courier: ['merchant', 'courier'],
    customer_merchant: ['customer', 'merchant'],
  };
  const [a, b] = pair[kind];
  return me === a ? b : a;
}

/** Unique per send; a retry reuses it so the server stores the message once. */
export function newClientId(now: number = Date.now(), rand: () => number = Math.random): string {
  return `m-${now.toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Messages oldest first with a day divider before each new day, then the pending ones. */
export function chatRows(messages: readonly ChatMessage[], pending: readonly PendingMessage[], now: Date): ChatRow[] {
  const rows: ChatRow[] = [];
  let lastDay: string | null = null;
  const today = dayKey(now);
  const pushDay = (d: Date) => {
    const k = dayKey(d);
    if (k === lastDay) return;
    lastDay = k;
    rows.push({ type: 'day', key: `day-${k}`, label: k === today ? 'today' : d });
  };
  for (const m of messages) {
    pushDay(m.createdAt);
    rows.push({ type: 'message', key: m.id, message: m });
  }
  for (const p of pending) {
    pushDay(p.createdAt);
    rows.push({ type: 'pending', key: p.clientId, pending: p });
  }
  return rows;
}

/** Highest seq on screen (what `chat.markRead` is told). */
export function lastSeqOf(messages: readonly ChatMessage[]): number {
  return messages.reduce((m, x) => Math.max(m, x.seq), 0);
}

/** Unread count of one thread kind, 0 when the caller is not in it. */
export function unreadOf(threads: readonly ChatThreadSummary[] | undefined, kind: ChatThreadKind): number {
  return threads?.find((t) => t.kind === kind)?.unread ?? 0;
}

/** Whether a thread of `kind` exists for the caller and is open (the button is live). */
export function threadOf(threads: readonly ChatThreadSummary[] | undefined, kind: ChatThreadKind): ChatThreadSummary | null {
  return threads?.find((t) => t.kind === kind) ?? null;
}

/** Google Maps for a shared pin (opens the maps app on a phone). */
export function pinUrl(pin: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`;
}

/** `tel:` target for a call session's number. */
export function telUrl(dial: string): string {
  return `tel:${dial.replace(/[^\d+]/g, '')}`;
}
