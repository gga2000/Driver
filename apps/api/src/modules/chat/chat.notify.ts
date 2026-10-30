import { ChatMessageSentPayload, chatPushBody, chatPushTitle } from '@driver/contracts';
import type { EventsService } from '../events/index.js';
import type { NotifyService } from '../notify/index.js';

export const CHAT_NOTIFY_SUBSCRIBER = 'chat:notify';

/**
 * Outbox subscriber: each `chat.message_sent` becomes a push to every recipient through the notify
 * module's public API ("رسالة جديدة من الدليفري", the preview, a deep link to the thread). Delivery
 * is at-least-once; the event id is the notify dedupe key, so a redelivered event pushes once.
 */
export function registerChatNotifications(events: EventsService, notify: NotifyService): () => void {
  return events.subscribe(CHAT_NOTIFY_SUBSCRIBER, ['chat.message_sent'], async (event) => {
    const p = ChatMessageSentPayload.parse(event.payload);
    for (const to of p.recipientIds) {
      await notify.send({
        to,
        channel: 'push',
        title_ar: chatPushTitle(p.senderRole, p.ride),
        body_ar: chatPushBody(p.messageKind, p.preview),
        data: { type: 'chat', orderId: p.orderId, kind: p.kind, threadId: p.threadId, seq: String(p.seq), deepLink: deepLinkOf(p) },
      }, undefined, { eventId: event.id });
    }
  });
}

/**
 * Where the push opens. A Baghdad/Kut pair thread (step 4c) opens in the app of whoever gets it: the
 * rider's (`driver://rajaa/chat/…`) or the driver's (`driver-partner://intercity/chat/…`), naming the
 * other side when the thread is keyed by it (the rider of a request, the driver of a run).
 */
export function deepLinkOf(p: ChatMessageSentPayload): string {
  if (p.kind !== 'rider_driver' || !p.trip) return `driver://chat/${p.orderId}?kind=${p.kind}`;
  const { subject, partyId } = p.trip;
  if (p.senderRole === 'courier') return `driver://rajaa/chat/${subject}/${p.orderId}${subject === 'request' ? `?with=${partyId}` : ''}`;
  return `driver-partner://intercity/chat/${subject}/${p.orderId}${subject === 'departure' ? `?with=${partyId}` : ''}`;
}
