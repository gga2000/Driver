import { describe, expect, it } from 'vitest';
import { CHAT_TEXT_MAX, type ChatMessage, type TicketEntry } from '@driver/contracts';
import { CHAT_CASE_TEXT_MAX, chatCaseItems, chatSeqToMark } from './support-chat';

const at = (min: number) => new Date(Date.UTC(2026, 9, 7, 9, min));
const msg = (seq: number, senderRole: ChatMessage['senderRole'], text: string, min: number): ChatMessage => ({
  id: `m${seq}`,
  seq,
  senderRole,
  mine: senderRole === 'support',
  kind: 'text',
  text,
  quickReplyKey: null,
  photoUrl: null,
  audioUrl: null,
  durationSec: null,
  location: null,
  masked: false,
  createdAt: at(min),
  read: false,
});
const entry = (id: string, kind: TicketEntry['kind'], min: number, meta: Record<string, unknown> = {}): TicketEntry => ({ id, at: at(min), actorId: 'ops', actorName: 'زينب', kind, text: id, amountIqd: null, meta });

describe('a chat case reads as one conversation', () => {
  it('interleaves the chat with the desk’s own lines, without repeating the opening or the chat replies', () => {
    const items = chatCaseItems(
      [entry('opened', 'opened', 0), entry('note', 'note', 2), entry('reply', 'reply', 3, { chatMessageId: 'm2' }), entry('refund', 'refund', 4), entry('old-reply', 'reply', 5)],
      [msg(1, 'customer', 'الطلب تأخر', 0), msg(2, 'support', 'آسفين', 3), msg(3, 'customer', 'شكراً', 6)],
    );
    expect(items.map((i) => i.key)).toEqual(['m-m1', 'e-note', 'm-m2', 'e-refund', 'e-old-reply', 'm-m3']);
  });

  it('marks read only when the customer wrote something new', () => {
    expect(chatSeqToMark({ lastSeq: 3, myReadSeq: 2 })).toBe(3);
    expect(chatSeqToMark({ lastSeq: 3, myReadSeq: 3 })).toBeNull();
    expect(chatSeqToMark(null)).toBeNull();
  });

  it('the composer limit is the chat’s', () => {
    expect(CHAT_CASE_TEXT_MAX).toBe(CHAT_TEXT_MAX);
  });
});
