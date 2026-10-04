'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CannedResponse, ChatThreadKind, TicketCase, TicketEntry } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { formatClock, formatDayClock, formatIqd, formatMoney } from '@/lib/format';
import { modLabel } from '@/lib/hotkeys';
import { queryRetry } from '@/lib/live';
import { normalize } from '@/lib/command';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { errorText } from '@/lib/network';
import { OrderRef, PersonName } from '../named';
import {
  Avatar,
  Button,
  Chip,
  cx,
  EmptyState,
  IconAlert,
  IconArrowUp,
  IconBulb,
  IconCheckCircle,
  IconFlag,
  IconLock,
  IconNote,
  IconPaperclip,
  IconRefund,
  IconSend,
  IconButton,
  Kbd,
  QueryError,
  Tabs,
  Tooltip,
  useToast,
  type IconProps,
} from '../ui';
import { ChannelIcon, kindTone, SlaPill, statusTone } from './sla';

export interface ComposerHandle {
  focus: (mode: 'reply' | 'note') => void;
}

/** What a picked canned reply suggests doing next (the desk opens the matching action, pre-filled). */
export type CannedIntent = Pick<CannedResponse, 'key' | 'action' | 'amountIqd' | 'title_ar'>;

/**
 * The middle pane: who wrote and about what, the thread (customer on the start side, our replies
 * on the end side, internal notes as amber sticky notes, actions as quiet event lines), the order's
 * own chats as read-only tabs, and the composer.
 */
export function Conversation({
  data,
  now,
  composerRef,
  onCanned,
  headerExtra,
}: {
  data: TicketCase;
  now: Date;
  composerRef: React.Ref<ComposerHandle>;
  onCanned: (c: CannedIntent) => void;
  headerExtra?: ReactNode;
}) {
  const tk = data.ticket;
  const closed = tk.status === 'resolved';
  const [tab, setTab] = useState<'ticket' | ChatThreadKind>('ticket');
  useEffect(() => setTab('ticket'), [tk.id]);
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tk.id, data.entries.length, tab]);
  const resolution = closed
    ? [...data.entries].reverse().find((e) => e.kind === 'resolve')?.text
    : undefined;

  return (
    <section
      aria-label={t('console.sup_conversation')}
      className="flex h-full min-h-0 min-w-0 flex-col bg-canvas"
    >
      <header className="border-b border-line bg-surface px-6 pb-0 pt-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold leading-7">{tk.subject}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-dense text-muted">
              <Chip tone={kindTone(tk.kind)} size="sm">
                {tk.kind_ar}
              </Chip>
              {tk.status !== 'open' ? (
                <Chip tone={statusTone(tk.status)} size="sm">
                  {tk.status_ar}
                </Chip>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <ChannelIcon channel={tk.channel} size={14} />
                {t(`console.sup_channel_${tk.channel}` as MessageKey)}
              </span>
              <span aria-hidden>·</span>
              <span className="num">{formatDayClock(tk.openedAt)}</span>
              {tk.orderId ? (
                <>
                  <span aria-hidden>·</span>
                  <OrderRef id={tk.orderId} copy={false} />
                </>
              ) : null}
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                {tk.assigneeId ? (
                  <>
                    {t('console.sup_assignee')} <PersonName id={tk.assigneeId} copy={false} />
                  </>
                ) : (
                  t('console.sup_unassigned')
                )}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerExtra}
            <SlaPill row={tk} now={now} />
          </div>
        </div>
        {data.order && data.chatKinds.length > 0 ? (
          <Tabs
            className="mt-3 border-b-0"
            label={t('console.sup_chats')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'ticket' as const, label: t('console.sup_tab_ticket') },
              ...data.chatKinds.map((k) => ({
                value: k,
                label: t(`console.sup_chat_${k}` as MessageKey),
              })),
            ]}
          />
        ) : (
          <div className="h-3" />
        )}
      </header>

      {tab === 'ticket' ? (
        <>
          <div ref={threadRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
            {/* Messages sit on the composer, like a chat: space collects above, not below. */}
            <div aria-hidden className="flex-1" />
            {data.customerDisputes30d > 3 ? (
              <p
                role="alert"
                className="mx-auto mb-5 flex max-w-2xl items-center gap-2 rounded-lg border border-bad/30 bg-bad-tint px-4 py-2.5 text-sm text-text"
              >
                <IconAlert size={18} className="shrink-0 text-bad" />
                {t('console.sup_manual_review', { n: data.customerDisputes30d })}
              </p>
            ) : null}
            <Thread
              entries={data.entries}
              customerName={tk.customerName}
              customerId={tk.customerId}
            />
          </div>
          {closed ? (
            <div className="flex items-center gap-2 border-t border-line bg-ok-tint px-6 py-3 text-sm text-text">
              <IconCheckCircle size={18} className="shrink-0 text-ok" />
              {resolution
                ? t('console.sup_closed_banner', { resolution })
                : t('console.sup_closed_short')}
            </div>
          ) : (
            <Composer
              ref={composerRef}
              ticketId={tk.id}
              canned={data.canned}
              suggestion={data.suggestion}
              onCanned={onCanned}
            />
          )}
        </>
      ) : data.order ? (
        <ChatThread orderId={data.order.id} kind={tab} />
      ) : null}
    </section>
  );
}

// ───────────────────────── thread ─────────────────────────

const EVENT_ICON: Partial<Record<TicketEntry['kind'], ComponentType<IconProps>>> = {
  refund: IconRefund,
  fault: IconFlag,
  escalate: IconArrowUp,
  resolve: IconCheckCircle,
  reopen: IconAlert,
  assign: IconSend,
};

export function Thread({
  entries,
  customerName,
  customerId,
}: {
  entries: TicketEntry[];
  customerName: string | null;
  customerId: string | null;
}) {
  return (
    <ol className="mx-auto flex max-w-3xl flex-col gap-4">
      {entries.map((e) => {
        if (e.kind === 'opened') {
          const byStaff = customerId !== null && e.actorId !== customerId && e.actorName;
          return (
            <li key={e.id} className="flex items-end gap-2.5">
              <Avatar name={customerName} id={customerId ?? e.actorId} />
              <div className="max-w-[78%]">
                <p className="mb-1 text-xs text-muted">
                  <span className="font-semibold text-text">
                    {customerName ?? t('console.sup_customer')}
                  </span>
                  <span className="num"> · {formatClock(e.at)}</span>
                  {byStaff ? <span> · {e.actorName}</span> : null}
                </p>
                <div className="whitespace-pre-wrap rounded-xl rounded-es-[4px] border border-line bg-surface px-4 py-2.5 text-[15px] leading-7 text-text shadow-card">
                  {e.text}
                </div>
              </div>
            </li>
          );
        }
        if (e.kind === 'reply') {
          return (
            <li key={e.id} className="flex flex-row-reverse items-end gap-2.5">
              <Avatar name={e.actorName} id={e.actorId} />
              <div className="max-w-[78%]">
                <p className="mb-1 text-end text-xs text-muted">
                  <span className="font-semibold text-text">
                    {e.actorName ?? t('console.someone')}
                  </span>
                  <span className="num"> · {formatClock(e.at)}</span>
                </p>
                <div className="whitespace-pre-wrap rounded-xl rounded-ee-[4px] bg-accent-tint px-4 py-2.5 text-[15px] leading-7 text-text">
                  {e.text}
                </div>
              </div>
            </li>
          );
        }
        if (e.kind === 'note') {
          return (
            <li key={e.id} className="flex flex-row-reverse items-end gap-2.5">
              <Avatar name={e.actorName} id={e.actorId} />
              <div className="max-w-[78%] rounded-xl border border-dashed border-note-line bg-note px-4 py-2.5">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-warn">
                  <IconLock size={13} />
                  {t('console.sup_internal_label')}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-text">{e.text}</p>
                <p className="mt-1 text-xs text-muted">
                  {e.actorName ?? t('console.someone')}{' '}
                  <span className="num">· {formatClock(e.at)}</span>
                </p>
              </div>
            </li>
          );
        }
        const Icon = EVENT_ICON[e.kind] ?? IconNote;
        const tone =
          e.kind === 'refund' || e.kind === 'resolve'
            ? 'text-ok'
            : e.kind === 'escalate' || e.kind === 'reopen'
              ? 'text-warn'
              : 'text-muted';
        return (
          <li key={e.id} className="flex items-center gap-3 py-0.5 text-dense text-muted">
            <span aria-hidden className="h-px flex-1 bg-line" />
            <span className="inline-flex max-w-[80%] items-center gap-2">
              <span
                className={cx(
                  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-surface shadow-card',
                  tone,
                )}
              >
                <Icon size={14} />
              </span>
              <span className="min-w-0">
                <span className="font-semibold text-text">
                  {e.actorName ?? t('console.someone')}
                </span>{' '}
                · {t(`console.sup_entry_${e.kind}` as MessageKey)}
                {e.amountIqd ? (
                  <span className="num font-semibold text-text"> {formatMoney(e.amountIqd)}</span>
                ) : null}
                {e.text ? (
                  <span className="block truncate text-xs" title={e.text}>
                    {e.text}
                  </span>
                ) : null}
              </span>
              <span className="num shrink-0 text-xs text-faint">{formatClock(e.at)}</span>
            </span>
            <span aria-hidden className="h-px flex-1 bg-line" />
          </li>
        );
      })}
    </ol>
  );
}

// ───────────────────────── order chats (read only) ─────────────────────────

function ChatThread({ orderId, kind }: { orderId: string; kind: ChatThreadKind }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const thread = useQuery(
    trpc.chat.thread.queryOptions(
      { orderId, kind },
      { enabled: signedIn, refetchInterval: 10_000, retry: queryRetry },
    ),
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <p className="mx-auto mb-4 flex max-w-3xl items-center gap-2 text-xs text-muted">
        <IconLock size={13} />
        {t('console.sup_chats_hint')}
      </p>
      {thread.error ? <QueryError error={thread.error} /> : null}
      {thread.data && thread.data.messages.length === 0 ? (
        <EmptyState bare title={t('console.sup_chat_empty')} />
      ) : null}
      <ol className="mx-auto flex max-w-3xl flex-col gap-3">
        {thread.data?.messages.map((m) => {
          const start =
            m.senderRole === 'customer' ||
            (kind === 'merchant_courier' && m.senderRole === 'merchant');
          const tone =
            m.senderRole === 'customer'
              ? 'bg-surface border border-line'
              : m.senderRole === 'merchant'
                ? 'bg-info-tint'
                : m.senderRole === 'courier'
                  ? 'bg-surface-3'
                  : 'bg-accent-tint';
          return (
            <li key={m.id} className={cx('flex', start ? 'justify-start' : 'justify-end')}>
              <div className={cx('max-w-[78%] rounded-xl px-4 py-2', tone)}>
                <p className="mb-0.5 text-xs text-muted">
                  <span className="font-semibold text-text">
                    {t(`console.sup_role_${m.senderRole}` as MessageKey)}
                  </span>
                  <span className="num"> · {formatClock(m.createdAt)}</span>
                  {m.masked ? (
                    <span className="text-warn"> · {t('console.sup_masked')}</span>
                  ) : null}
                </p>
                <p className="text-sm leading-6">
                  {m.text ??
                    (m.photoUrl
                      ? t('console.sup_photo')
                      : m.location
                        ? t('console.sup_location')
                        : '—')}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ───────────────────────── composer ─────────────────────────

const Composer = forwardRef<
  ComposerHandle,
  {
    ticketId: string;
    canned: CannedResponse[];
    suggestion: TicketCase['suggestion'];
    onCanned: (c: CannedIntent) => void;
  }
>(function Composer({ ticketId, canned, suggestion, onCanned }, ref) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [draft, setDraft] = useState('');
  const [cannedKey, setCannedKey] = useState<string | undefined>(undefined);
  const [picker, setPicker] = useState(false);
  useEffect(() => {
    setDraft('');
    setCannedKey(undefined);
    setMode('reply');
    setPicker(false);
  }, [ticketId]);
  useImperativeHandle(ref, () => ({
    focus: (m) => {
      setMode(m);
      window.requestAnimationFrame(() => areaRef.current?.focus());
    },
  }));
  const reply = useMutation(
    trpc.support.reply.mutationOptions({
      onSuccess: (data, vars) => {
        qc.setQueryData(trpc.support.get.queryKey({ ticketId }), data);
        void qc.invalidateQueries({ queryKey: trpc.support.list.pathKey() });
        setDraft('');
        setCannedKey(undefined);
        toast({
          title: vars.internal ? t('console.sup_noted') : t('console.sup_sent'),
          tone: 'ok',
        });
      },
    }),
  );
  const send = () => {
    if (!draft.trim() || reply.isPending) return;
    reply.mutate({
      ticketId,
      text: draft.trim(),
      internal: mode === 'note',
      ...(cannedKey && mode === 'reply' ? { cannedKey } : {}),
    });
  };
  const pick = (c: CannedResponse) => {
    setDraft(c.text_ar);
    setCannedKey(c.key);
    setMode('reply');
    setPicker(false);
    onCanned(c);
    window.requestAnimationFrame(() => {
      const el = areaRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  };
  const suggested = suggestion ? canned.find((c) => c.key === suggestion.cannedKey) : undefined;
  const note = mode === 'note';
  return (
    <div className="border-t border-line bg-surface px-6 pb-4 pt-3">
      <div className="mx-auto max-w-3xl">
        <div
          className="mb-2 flex items-center gap-1"
          role="tablist"
          aria-label={t('console.sup_reply')}
        >
          {(['reply', 'note'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-dense font-medium transition-colors',
                mode === m
                  ? m === 'note'
                    ? 'bg-note text-warn'
                    : 'bg-surface-3 text-text'
                  : 'text-muted hover:text-text',
              )}
            >
              {m === 'note' ? <IconLock size={14} /> : <IconSend size={14} />}
              {t(m === 'note' ? 'console.sup_mode_note' : 'console.sup_mode_reply')}
              <Kbd className="ms-1">{m === 'note' ? 'N' : 'R'}</Kbd>
            </button>
          ))}
          {suggested && !cannedKey ? (
            <button
              type="button"
              onClick={() => pick(suggested)}
              title={suggestion?.reason_ar}
              className="ms-auto inline-flex h-8 max-w-[55%] items-center gap-1.5 rounded-pill border border-accent/50 bg-accent-wash px-3 text-dense text-accent-text hover:bg-accent-tint"
            >
              <IconBulb size={15} className="shrink-0" />
              <span className="truncate">
                {t('console.sup_suggested')}:{' '}
                <span className="font-semibold">{suggested.title_ar}</span>
              </span>
            </button>
          ) : null}
        </div>

        <div
          className={cx(
            'relative rounded-lg border shadow-card transition-colors focus-within:border-accent-text',
            note ? 'border-note-line bg-note' : 'border-line-strong/70 bg-surface',
          )}
        >
          {picker ? (
            <CannedPicker
              canned={canned}
              suggestedKey={suggestion?.cannedKey ?? null}
              onPick={pick}
              onClose={() => (setPicker(false), areaRef.current?.focus())}
            />
          ) : null}
          <label htmlFor={`composer-${ticketId}`} className="sr-only">
            {t('console.sup_reply')}
          </label>
          <textarea
            id={`composer-${ticketId}`}
            ref={areaRef}
            data-composer
            rows={3}
            maxLength={2000}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (!e.target.value) setCannedKey(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === '/' && draft === '' && mode === 'reply') {
                e.preventDefault();
                setPicker(true);
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              } else if (e.key === 'Escape') {
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            placeholder={
              note ? t('console.sup_note_placeholder') : t('console.sup_composer_placeholder')
            }
            className="block min-h-[84px] w-full resize-none rounded-lg bg-transparent px-4 py-3 text-[15px] leading-7 text-text placeholder:text-faint focus-visible:outline-none"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            {!note ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPicker((p) => !p)}
                aria-expanded={picker}
                kbd="/"
              >
                {t('console.sup_canned_btn')}
              </Button>
            ) : null}
            <Tooltip content={t('console.sup_attach_soon')}>
              <IconButton
                label={t('console.sup_attach')}
                size="sm"
                aria-disabled="true"
                className="cursor-not-allowed opacity-60"
                onClick={(e) => e.preventDefault()}
              >
                <IconPaperclip size={17} />
              </IconButton>
            </Tooltip>
            <span
              dir="ltr"
              className="ms-auto hidden items-center gap-1 text-xs text-faint sm:inline-flex"
            >
              <Kbd>{modLabel()}</Kbd>
              <Kbd>↵</Kbd>
            </span>
            <Button
              variant="primary"
              size="sm"
              loading={reply.isPending}
              disabled={!draft.trim()}
              onClick={send}
              icon={<IconSend size={15} />}
            >
              {note ? t('console.sup_add_note') : t('console.sup_send')}
            </Button>
          </div>
        </div>
        {reply.error ? <p className="mt-2 text-sm text-bad">{errorText(reply.error)}</p> : null}
      </div>
    </div>
  );
});

const ACTION_KEY: Record<CannedResponse['action'], MessageKey | null> = {
  none: null,
  refund: 'console.sup_canned_action_refund',
  fault_courier: 'console.sup_canned_action_fault_courier',
  fault_merchant: 'console.sup_canned_action_fault_merchant',
  escalate: 'console.sup_canned_action_escalate',
  resolve: 'console.sup_canned_action_resolve',
};

/** "/" picker: searchable, the suggested answer first (K-12), arrows + Enter, Escape closes. */
function CannedPicker({
  canned,
  suggestedKey,
  onPick,
  onClose,
}: {
  canned: CannedResponse[];
  suggestedKey: string | null;
  onPick: (c: CannedResponse) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const list = useMemo(() => {
    const ordered = [...canned].sort(
      (a, b) => Number(b.key === suggestedKey) - Number(a.key === suggestedKey),
    );
    const nq = normalize(q);
    return nq
      ? ordered.filter((c) => normalize(`${c.title_ar} ${c.text_ar}`).includes(nq))
      : ordered;
  }, [canned, suggestedKey, q]);
  useEffect(() => setActive(0), [q]);
  return (
    <div className="absolute inset-x-0 bottom-full z-30 mb-2 animate-pop-in overflow-hidden rounded-lg border border-line bg-raised shadow-pop">
      <div className="border-b border-line p-2">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('console.sup_canned_search')}
          aria-label={t('console.sup_canned_search')}
          role="combobox"
          aria-expanded="true"
          aria-controls="canned-list"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(list.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (list[active]) onPick(list[active]!);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
          className="h-9 w-full rounded-md bg-surface-2 px-3 text-sm placeholder:text-faint focus-visible:outline-none"
        />
      </div>
      <ul
        id="canned-list"
        role="listbox"
        aria-label={t('console.sup_canned_btn')}
        className="max-h-72 overflow-y-auto p-1"
      >
        {list.length === 0 ? (
          <li className="px-3 py-3 text-dense text-muted">{t('console.sup_canned_empty')}</li>
        ) : null}
        {list.map((c, i) => {
          const action = ACTION_KEY[c.action];
          return (
            <li
              key={c.key}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(c);
              }}
              className={cx(
                'relative cursor-pointer rounded-md px-3 py-2',
                i === active ? 'bg-surface-2' : '',
              )}
            >
              {i === active ? (
                <span
                  aria-hidden
                  className="absolute inset-y-2 start-0 w-[3px] rounded-pill bg-accent"
                />
              ) : null}
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{c.title_ar}</span>
                {c.key === suggestedKey ? (
                  <Chip tone="ready" size="sm">
                    {t('console.sup_suggested')}
                  </Chip>
                ) : null}
                {action ? (
                  <span className="ms-auto text-xs text-muted">
                    {c.action === 'refund' && c.amountIqd
                      ? t('console.sup_canned_refund', { amount: formatIqd(c.amountIqd) })
                      : t(action)}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-dense text-muted">{c.text_ar}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
