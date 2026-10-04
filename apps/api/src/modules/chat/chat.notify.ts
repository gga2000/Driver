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
        data: { type: 'chat', orderId: p.orderId, kind: p.kind, threadId: p.threadId, seq: String(p.seq), deepLink: `driver://chat/${p.orderId}?kind=${p.kind}` },
      }, undefined, { eventId: event.id });
    }
  });
}
