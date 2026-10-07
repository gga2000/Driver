import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatThreadSummary } from '@driver/contracts';
import { chatRows, counterpartRole, lastSeqOf, newClientId, pinUrl, roleKey, telUrl, threadOf, unreadOf, type PendingMessage } from './chat';

const msg = (seq: number, at: string, mine = false): ChatMessage => ({
  id: `m${seq}`,
  seq,
  senderRole: mine ? 'customer' : 'courier',
  mine,
  kind: 'text',
  text: `رسالة ${seq}`,
  quickReplyKey: null,
  photoUrl: null,
  audioUrl: null,
  durationSec: null,
  location: null,
  masked: false,
  createdAt: new Date(at),
  read: false,
});

describe('chat logic', () => {
  it('labels the courier as السايق on rides', () => {
    expect(roleKey('courier', false)).toBe('chat.role.courier');
    expect(roleKey('courier', true)).toBe('chat.role.driver');
    expect(roleKey('merchant', true)).toBe('chat.role.merchant');
  });

  it('knows the other party of each pair', () => {
    expect(counterpartRole('customer_courier', 'customer')).toBe('courier');
    expect(counterpartRole('merchant_courier', 'courier')).toBe('merchant');
    expect(counterpartRole('customer_merchant', 'merchant')).toBe('customer');
  });

  it('puts a day divider before each day and the pending ones last', () => {
    const now = new Date('2026-10-04T12:00:00');
    const pending: PendingMessage = { clientId: 'c1', body: { text: 'هلا' }, text: 'هلا', localPhotoUri: null, voice: null, status: 'sending', createdAt: now };
    const rows = chatRows([msg(1, '2026-10-03T22:00:00'), msg(2, '2026-10-04T09:00:00'), msg(3, '2026-10-04T09:01:00', true)], [pending], now);
    expect(rows.map((r) => r.type)).toEqual(['day', 'message', 'day', 'message', 'message', 'pending']);
    expect(rows[2]).toMatchObject({ type: 'day', label: 'today' });
    expect(rows[0]!.type === 'day' && rows[0]!.label instanceof Date).toBe(true);
    expect(chatRows([], [], now)).toEqual([]);
  });

  it('reads the last seq, unread counts and threads', () => {
    expect(lastSeqOf([msg(3, '2026-10-04T09:00:00'), msg(7, '2026-10-04T09:00:00')])).toBe(7);
    expect(lastSeqOf([])).toBe(0);
    const threads: ChatThreadSummary[] = [{ kind: 'customer_courier', status: 'open', myRole: 'customer', counterpart: 'courier', unread: 2, lastMessageAt: null, canCall: true }];
    expect(unreadOf(threads, 'customer_courier')).toBe(2);
    expect(unreadOf(threads, 'customer_merchant')).toBe(0);
    expect(unreadOf(undefined, 'customer_courier')).toBe(0);
    expect(threadOf(threads, 'customer_merchant')).toBeNull();
  });

  it('builds client ids, map and tel links', () => {
    expect(newClientId(1000, () => 0.5)).toMatch(/^m-[a-z0-9]+-[a-z0-9]+$/);
    expect(newClientId(1000, () => 0.1)).not.toBe(newClientId(1000, () => 0.2));
    expect(pinUrl({ lat: 32.9, lng: 45.07 })).toBe('https://www.google.com/maps/search/?api=1&query=32.900000,45.070000');
    expect(telUrl('+964 780 000 0000')).toBe('tel:+9647800000000');
  });
});
