'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChatMessage, ChatThreadView, TicketEntry } from '@driver/contracts';
import { createLiveConnection, isLiveAuthError } from '@driver/contracts/live-client';
import { t } from '@driver/i18n';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { formatClock } from '@/lib/format';
import { useSignedIn } from '@/lib/session';
import { chatCaseItems, chatSeqToMark } from '@/lib/support-chat';
import { liveTokensOf, useTRPC, useTRPCClient } from '@/lib/trpc';
import { Avatar, cx, IconCheck, IconChat } from '../ui';

/**
 * A chat case («كلّم الدعم» inside an order): the customer's support chat and the case's own lines
 * (notes, refunds, actions) as one conversation — customer on the start side, our team on the end
 * side, «شافها» under what he has read. Pure view; `useChatCaseLive` keeps it fresh.
 */
export function ChatCaseThread({
  entries,
  chat,
  customerName,
  customerId,
  renderEntry,
}: {
  entries: TicketEntry[];
  chat: Pick<ChatThreadView, 'messages' | 'status'>;
  customerName: string | null;
  customerId: string | null;
  /** The case's own lines (an `<li>` each), drawn as the ticket thread draws them. */
  renderEntry: (e: TicketEntry) => ReactNode;
}) {
  const items = chatCaseItems(entries, chat.messages);
  return (
    <ol className="mx-auto flex max-w-3xl flex-col gap-4" data-testid="chat-case-thread">
      {items.map((it) =>
        it.type === 'message' ? (
          <ChatBubble
            key={it.key}
            m={it.message}
            customerName={customerName}
            customerId={customerId}
          />
        ) : (
          <Fragment key={it.key}>{renderEntry(it.entry)}</Fragment>
        ),
      )}
    </ol>
  );
}

function ChatBubble({
  m,
  customerName,
  customerId,
}: {
  m: ChatMessage;
  customerName: string | null;
  customerId: string | null;
}) {
  const customer = m.senderRole === 'customer';
  const body =
    m.text ?? (m.photoUrl ? t('console.sup_photo') : m.location ? t('console.sup_location') : '—');
  return (
    <li
      className={cx('flex items-end gap-2.5', customer ? '' : 'flex-row-reverse')}
      data-testid={`chat-case-msg-${m.seq}`}
    >
      {customer ? (
        <Avatar name={customerName} id={customerId ?? 'customer'} />
      ) : (
        <span
          aria-hidden
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-accent-tint text-accent-text"
        >
          <IconChat size={16} />
        </span>
      )}
      <div className="max-w-[78%]">
        <p className={cx('mb-1 text-xs text-muted', customer ? '' : 'text-end')}>
          <span className="font-semibold text-text">
            {customer ? (customerName ?? t('console.sup_customer')) : t('console.sup_role_support')}
          </span>
          <span className="num"> · {formatClock(m.createdAt)}</span>
          {m.masked ? <span className="text-warn"> · {t('console.sup_masked')}</span> : null}
        </p>
        <div
          className={cx(
            'whitespace-pre-wrap px-4 py-2.5 text-[15px] leading-7 text-text',
            customer
              ? 'rounded-xl rounded-es-[4px] border border-line bg-surface shadow-card'
              : 'rounded-xl rounded-ee-[4px] bg-accent-tint',
          )}
        >
          {body}
          {m.photoUrl ? (
            <a
              href={m.photoUrl}
              target="_blank"
              rel="noreferrer"
              className="ms-2 text-sm font-medium text-accent-text underline-offset-2 hover:underline"
            >
              {t('console.sup_chat_photo_open')}
            </a>
          ) : null}
        </div>
        {!customer && m.read ? (
          <p className="mt-1 flex items-center justify-end gap-1 text-xs text-muted">
            <IconCheck size={13} className="text-ok" />
            {t('console.sup_chat_seen')}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Keeps a chat case live: the order's `live.chat` stream (`customer_support`) re-reads the case on
 * every message (the case query keeps its 10-s poll as the safety net, and for desk roles the stream
 * refuses), and tells the chat what the desk has read.
 */
export function useChatCaseLive(
  ticketId: string,
  orderId: string | null,
  chat: Pick<ChatThreadView, 'lastSeq' | 'myReadSeq'> | null | undefined,
) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  useEffect(() => {
    if (!signedIn || !orderId) return;
    const refresh = () =>
      void qc.invalidateQueries({ queryKey: trpc.support.get.queryKey({ ticketId }) });
    const conn = createLiveConnection({
      open: (h) => client.live.chat.subscribe({ orderId, kind: 'customer_support' }, h),
      onEvent: (e) => {
        if (e.type === 'chat') refresh();
      },
      onResync: refresh,
      isAuthError: isLiveAuthError,
      onAuthError: () => liveTokensOf(client)?.clear(),
    });
    conn.start();
    return () => conn.stop();
  }, [signedIn, orderId, ticketId, trpc, client, qc]);

  const read = useMutation(trpc.support.chatRead.mutationOptions());
  const marked = useRef(0);
  const seq = chatSeqToMark(chat);
  useEffect(() => {
    if (seq === null || seq <= marked.current || read.isPending) return;
    marked.current = seq;
    read.mutate({ ticketId, seq });
  }, [seq, ticketId, read]);
}
