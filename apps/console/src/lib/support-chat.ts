import type { ChatMessage, ChatThreadView, TicketEntry } from '@driver/contracts';

/**
 * A chat case («كلّم الدعم», ticket channel `chat`): the customer's support chat and the case's own
 * history read as one conversation, oldest first. The chat carries the words both ways; the case adds
 * what only the desk sees (internal notes, refunds, fault, escalation, resolve, reopen). The case's
 * `opened` line repeats the first message and a `reply` sent into the chat repeats its message, so
 * those two are left out.
 */
export type ChatCaseItem =
  | { type: 'message'; key: string; at: Date; message: ChatMessage }
  | { type: 'entry'; key: string; at: Date; entry: TicketEntry };

export function chatCaseItems(entries: readonly TicketEntry[], messages: readonly ChatMessage[]): ChatCaseItem[] {
  const items: ChatCaseItem[] = [
    ...messages.map((m) => ({ type: 'message' as const, key: `m-${m.id}`, at: new Date(m.createdAt), message: m })),
    ...entries
      .filter((e) => e.kind !== 'opened' && !(e.kind === 'reply' && typeof e.meta['chatMessageId'] === 'string'))
      .map((e) => ({ type: 'entry' as const, key: `e-${e.id}`, at: new Date(e.at), entry: e })),
  ];
  // Stable: at the same instant a message comes before the desk's line about it.
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => a.it.at.getTime() - b.it.at.getTime() || (a.it.type === b.it.type ? a.i - b.i : a.it.type === 'message' ? -1 : 1))
    .map(({ it }) => it);
}

/** The seq to mark read when the desk opens the case, or null when nothing new came from the customer. */
export function chatSeqToMark(chat: Pick<ChatThreadView, 'lastSeq' | 'myReadSeq'> | null | undefined): number | null {
  if (!chat) return null;
  return chat.lastSeq > chat.myReadSeq ? chat.lastSeq : null;
}

/** The chat takes at most this many characters per message (`CHAT_TEXT_MAX`); the composer stops there on a chat case. */
export const CHAT_CASE_TEXT_MAX = 500;
