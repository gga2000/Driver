import { CHAT_SUPPORT_OPENS_PER_DAY, type ChatMessage, type ChatRole, type ChatThreadKind, type RoleKind } from '@driver/contracts';
import type { ChatMessageRecord } from './chat.repository.js';

// Shared by the order chat (`ChatService`) and the Baghdad/Kut chat (`TripChatService`).

export interface ChatIdentityPort {
  hasRole(personId: string, kind: RoleKind, orgId?: string): Promise<boolean>;
  /** First names only; every read of another person is a logged vault access. */
  firstNamesFor(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string | null>>;
  orgRoleHolders(orgId: string, kinds: readonly RoleKind[]): Promise<Array<{ personId: string; kind: RoleKind; frozen: boolean }>>;
}

export const CHAT_IDENTITY = Symbol('CHAT_IDENTITY');

/** Limits: sends per person per minute; masked calls per person per 10 minutes. */
export const CHAT_RULES = { sendsPerMinute: 20, callsPer10Min: 5, pageSize: 200, supportOpensPerDay: CHAT_SUPPORT_OPENS_PER_DAY } as const;

/** A stored message as `readerRole` sees it (shared with the Baghdad/Kut chat, which adds its cards). */
export function messageViewOf(m: ChatMessageRecord, readerRole: ChatRole, otherReadSeq: number, readUrl: (ref: string) => string, card: ChatMessage['card']): ChatMessage {
  const mine = m.senderRole === readerRole;
  return {
    id: m.id,
    seq: m.seq,
    senderRole: m.senderRole,
    mine,
    kind: m.kind,
    text: m.body,
    quickReplyKey: (m.quickReplyKey as ChatMessage['quickReplyKey']) ?? null,
    photoUrl: m.photoRef ? readUrl(m.photoRef) : null,
    audioUrl: m.voiceRef ? readUrl(m.voiceRef) : null,
    durationSec: m.kind === 'voice' ? m.durationSec : null,
    location: m.lat !== null && m.lng !== null ? { lat: m.lat, lng: m.lng } : null,
    masked: m.masked,
    createdAt: m.createdAt,
    read: mine && otherReadSeq >= m.seq,
    card,
  };
}

/** Read receipts belong to the party: the customer side, the kitchen and (on a support chat) the desk are one reader each. */
export function readerKey(role: ChatRole, personId: string, kind?: ChatThreadKind): string {
  if (role === 'customer' || role === 'merchant') return role;
  if (role === 'support' && kind === 'customer_support') return 'support';
  return `${role}:${personId}`;
}
