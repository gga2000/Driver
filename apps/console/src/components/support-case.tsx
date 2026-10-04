'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CannedResponse, ChatThreadKind, FaultParty, TicketCase, TicketEntry } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useId, useMemo, useState } from 'react';
import { refundChips, slaClock } from '@/lib/control-room';
import { formatClock, formatDayClock, formatIqd, formatMoney, shortId } from '@/lib/format';
import { orderStateLabel, orderTypeLabel, paymentLabel } from '@/lib/labels';
import { queryRetry } from '@/lib/live';
import { eventTimeline } from '@/lib/orders';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { errorText } from '@/lib/network';
import { EventTimeline } from './event-timeline';
import { Card, Chip, dangerBtn, EmptyState, ghostBtn, inputCls, LiveBadge, Mono, NeedLogin, PageHeader, primaryBtn, QueryError, Row, useSecondsSince } from './ui';

const POLL_MS = 10_000;
const FAULTS: readonly Exclude<FaultParty, 'customer'>[] = ['platform', 'courier', 'merchant'];

export function SupportCasePage({ ticketId }: { ticketId: string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const q = useQuery(trpc.support.get.queryOptions({ ticketId }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));
  if (!signedIn) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title={t('console.sup_case')} />
        <NeedLogin />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1600px]">
      <p className="mb-2 text-sm">
        <Link href="/support" className="text-accent underline">
          {t('console.sup_back')}
        </Link>
      </p>
      {q.error && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && <SupportCase data={q.data} updatedAt={q.dataUpdatedAt} fetching={q.isFetching} />}
    </div>
  );
}

export function SupportCase({ data, updatedAt, fetching }: { data: TicketCase; updatedAt?: number; fetching?: boolean }) {
  const tk = data.ticket;
  const tick = useSecondsSince(updatedAt ?? 0);
  void tick; // re-render every second so the SLA clock counts down between polls
  const sla = slaClock(tk, new Date());
  const closed = tk.status === 'resolved';
  const [draft, setDraft] = useState('');
  const timeline = useMemo(() => eventTimeline(data.timeline), [data.timeline]);
  return (
    <>
      <PageHeader title={tk.subject} subtitle={t('console.sup_case_sub', { id: shortId(tk.id), opened: formatDayClock(tk.openedAt) })}>
        <Chip tone={tk.kind === 'incident' ? 'bad' : tk.kind === 'dispute' ? 'warn' : 'neutral'}>{tk.kind_ar}</Chip>
        <Chip tone={tk.status === 'escalated' ? 'warn' : closed ? 'done' : 'neutral'}>{tk.status_ar}</Chip>
        <Chip tone={sla.tone}>{sla.text}</Chip>
        <LiveBadge seconds={POLL_MS / 1000} updatedAt={updatedAt} fetching={fetching} />
      </PageHeader>

      {data.customerDisputes30d > 3 && (
        <p role="alert" className="mb-4 rounded-lg border border-danger-500 bg-danger-500/10 px-3 py-2 text-sm">
          {t('console.sup_manual_review', { n: data.customerDisputes30d })}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={t('console.sup_conversation')}>
            <Conversation entries={data.entries} />
            {!closed && <Composer ticketId={tk.id} canned={data.canned} suggestion={data.suggestion} draft={draft} setDraft={setDraft} />}
          </Card>
          {data.order && data.chatKinds.length > 0 && <ChatThreads orderId={data.order.id} kinds={data.chatKinds} />}
          <Card title={t('console.sup_timeline')}>{timeline.length ? <EventTimeline entries={timeline} /> : <p className="text-sm text-faint">{t('console.sup_no_timeline')}</p>}</Card>
        </div>

        <div className="space-y-4">
          <OrderCard data={data} />
          {!closed && <RefundCard data={data} />}
          {!closed && <ActionsCard data={data} />}
          <Card title={t('console.sup_ledger')}>
            {data.ledger.length === 0 ? (
              <p className="text-sm text-faint">{t('console.sup_no_ledger')}</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.ledger.map((l) => (
                  <li key={l.id} className={`flex items-baseline justify-between gap-3 border-b border-line/50 pb-1 ${l.memo?.startsWith('support:') ? 'text-accent' : ''}`}>
                    <span className="min-w-0">
                      {l.label_ar}
                      <span className="block truncate text-[11px] text-faint" dir="ltr">
                        {l.fromAccount.split(':')[0]} → {l.toAccount.split(':')[0]}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{formatIqd(l.amountIqd)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Conversation({ entries }: { entries: TicketEntry[] }) {
  return (
    <ol className="space-y-3">
      {entries.map((e) => {
        const staff = e.kind !== 'opened';
        const special = e.kind === 'refund' || e.kind === 'fault' || e.kind === 'escalate' || e.kind === 'resolve';
        return (
          <li key={e.id} className={`flex ${staff ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl border px-3 py-2 text-sm ${
                e.kind === 'note' ? 'border-dashed border-line bg-transparent text-muted' : special ? 'border-primary-500/60 bg-primary-500/10' : staff ? 'border-line bg-surface-2' : 'border-info-500/50 bg-info-500/10'
              }`}
            >
              <p className="mb-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-semibold">{t(`console.sup_entry_${e.kind}` as MessageKey)}</span>
                <span>{e.actorName ?? t('console.someone')}</span>
                <span className="tabular-nums">{formatClock(e.at)}</span>
              </p>
              <p className="whitespace-pre-wrap">{e.text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Composer({ ticketId, canned, suggestion, draft, setDraft }: { ticketId: string; canned: CannedResponse[]; suggestion: TicketCase['suggestion']; draft: string; setDraft: (s: string) => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const id = useId();
  const [internal, setInternal] = useState(false);
  const [cannedKey, setCannedKey] = useState<string | undefined>(undefined);
  const reply = useMutation(
    trpc.support.reply.mutationOptions({
      onSuccess: (data) => {
        qc.setQueryData(trpc.support.get.queryKey({ ticketId }), data);
        setDraft('');
        setCannedKey(undefined);
      },
    }),
  );
  return (
    <div className="mt-4 border-t border-line pt-4">
      {suggestion && (
        <p className="mb-2 text-xs text-accent">
          {t('console.sup_suggested')}: {suggestion.reason_ar}
        </p>
      )}
      <div className="mb-2 flex flex-wrap gap-1">
        {canned.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`${ghostBtn} px-2 py-1 text-xs ${suggestion?.cannedKey === c.key ? 'border-accent text-accent' : ''}`}
            aria-pressed={cannedKey === c.key}
            onClick={() => {
              setDraft(c.text_ar);
              setCannedKey(c.key);
            }}
          >
            {c.title_ar}
          </button>
        ))}
      </div>
      <label htmlFor={id} className="sr-only">
        {t('console.sup_reply')}
      </label>
      <textarea id={id} rows={3} maxLength={2000} className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('console.sup_reply_placeholder')} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
          {t('console.sup_internal')}
        </label>
        <button type="button" className={primaryBtn} disabled={!draft.trim() || reply.isPending} onClick={() => reply.mutate({ ticketId, text: draft.trim(), internal, ...(cannedKey ? { cannedKey } : {}) })}>
          {reply.isPending ? t('status.loading') : internal ? t('console.sup_add_note') : t('console.sup_send')}
        </button>
      </div>
      {reply.error && <p className="mt-1 text-sm text-bad">{errorText(reply.error)}</p>}
    </div>
  );
}

function OrderCard({ data }: { data: TicketCase }) {
  const o = data.order;
  if (!o) {
    return (
      <Card title={t('console.sup_order')}>
        <p className="text-sm text-faint">{t('console.sup_no_order')}</p>
      </Card>
    );
  }
  return (
    <Card
      title={t('console.sup_order')}
      actions={
        <Link href={`/orders/${encodeURIComponent(o.id)}`} className="text-sm text-accent underline">
          <Mono>{shortId(o.id)}</Mono>
        </Link>
      }
    >
      <dl>
        <Row k={t('console.sup_order_state')} v={<Chip>{orderStateLabel(o.state)}</Chip>} />
        <Row k={t('console.sup_order_type')} v={orderTypeLabel(o.type)} />
        {o.merchantName && <Row k={t('console.sup_order_merchant')} v={o.merchantName} />}
        <Row k={t('console.sup_order_total')} v={<span className="tabular-nums">{formatMoney(o.totalIqd)}</span>} />
        <Row k={t('console.sup_order_payment')} v={paymentLabel(o.paymentMethod)} />
        <Row k={t('console.sup_order_placed')} v={formatDayClock(o.placedAt)} />
        {o.deliveredAt && <Row k={t('console.sup_order_delivered')} v={formatDayClock(o.deliveredAt)} />}
        <Row k={t('console.sup_order_courier')} v={o.courierId ? <Mono>{shortId(o.courierId)}</Mono> : '—'} />
      </dl>
      {o.lines.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {o.lines.map((l, i) => (
            <li key={`${l.name}-${i}`} className="flex justify-between gap-2">
              <span>
                {l.qty} × {l.name}
              </span>
              <span className="tabular-nums text-muted">{formatIqd(l.totalIqd)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RefundCard({ data }: { data: TicketCase }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ids = { amount: useId(), fault: useId() };
  const lim = data.limits;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'wallet' | 'points'>('wallet');
  const [fault, setFault] = useState<Exclude<FaultParty, 'customer'>>('platform');
  const [key, setKey] = useState(() => `rf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const refund = useMutation(
    trpc.support.refund.mutationOptions({
      onSuccess: (res) => {
        qc.setQueryData(trpc.support.get.queryKey({ ticketId: data.ticket.id }), res);
        setAmount('');
        setKey(`rf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      },
    }),
  );
  const n = Number(amount);
  const valid = Number.isInteger(n) && n >= 250 && n % 250 === 0 && n <= lim.availableIqd;
  const pct = (used: number, cap: number) => (cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0);
  return (
    <Card title={t('console.sup_refund')}>
      <dl className="mb-3 space-y-2 text-xs">
        {lim.agentDailyCapIqd > 0 && (
          <LimitBar label={t('console.sup_limit_agent')} used={lim.agentUsedTodayIqd} cap={lim.agentDailyCapIqd} pct={pct(lim.agentUsedTodayIqd, lim.agentDailyCapIqd)} />
        )}
        <LimitBar label={t('console.sup_limit_customer')} used={lim.customerUsedMonthIqd} cap={lim.customerMonthlyCapIqd} pct={pct(lim.customerUsedMonthIqd, lim.customerMonthlyCapIqd)} />
        <p className="text-muted">{t('console.sup_available', { amount: formatIqd(lim.availableIqd) })}</p>
      </dl>
      <div className="mb-2 flex flex-wrap gap-1">
        {refundChips(lim.availableIqd).map((v) => (
          <button key={v} type="button" className={`${ghostBtn} px-2 py-1 text-xs tabular-nums`} aria-pressed={n === v} onClick={() => setAmount(String(v))}>
            {formatIqd(v)}
          </button>
        ))}
      </div>
      <label htmlFor={ids.amount} className="mb-1 block text-sm text-muted">
        {t('console.sup_amount')}
      </label>
      <input id={ids.amount} dir="ltr" inputMode="numeric" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} aria-invalid={amount !== '' && !valid} />
      {n > lim.cashAboveIqd && <p className="mt-1 text-xs text-accent">{t('console.sup_cash_hint')}</p>}
      <div className="mt-2 flex flex-wrap gap-1">
        {(['wallet', 'points'] as const).map((m) => (
          <button key={m} type="button" className={ghostBtn} aria-pressed={method === m} onClick={() => setMethod(m)}>
            {t(`console.sup_method_${m}` as MessageKey)}
          </button>
        ))}
      </div>
      <label htmlFor={ids.fault} className="mb-1 mt-2 block text-sm text-muted">
        {t('console.sup_funded_by')}
      </label>
      <select id={ids.fault} className={inputCls} value={fault} onChange={(e) => setFault(e.target.value as typeof fault)} disabled={method === 'points'}>
        {FAULTS.map((f) => (
          <option key={f} value={f}>
            {t(`console.sup_fault_${f}` as MessageKey)}
          </option>
        ))}
      </select>
      <button type="button" className={`${primaryBtn} mt-3 w-full`} disabled={!valid || refund.isPending} onClick={() => refund.mutate({ ticketId: data.ticket.id, amountIqd: n, method, faultParty: method === 'points' ? 'platform' : fault, idempotencyKey: key })}>
        {refund.isPending ? t('status.loading') : t('console.sup_refund_send', { amount: valid ? formatIqd(n) : '—' })}
      </button>
      {refund.error && <p className="mt-2 text-sm text-bad">{errorText(refund.error)}</p>}
      {data.ticket.refundedIqd > 0 && <p className="mt-2 text-xs text-ok">{t('console.sup_refunded_total', { amount: formatIqd(data.ticket.refundedIqd) })}</p>}
    </Card>
  );
}

function LimitBar({ label, used, cap, pct }: { label: string; used: number; cap: number; pct: number }) {
  return (
    <div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted">{label}</dt>
        <dd className="tabular-nums">
          {formatIqd(used)} / {formatIqd(cap)}
        </dd>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-surface-2">
        <div className={`h-full ${pct >= 100 ? 'bg-bad' : pct >= 80 ? 'bg-accent' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ActionsCard({ data }: { data: TicketCase }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ids = { note: useId() };
  const [note, setNote] = useState('');
  const set = (res: TicketCase) => {
    qc.setQueryData(trpc.support.get.queryKey({ ticketId: data.ticket.id }), res);
    setNote('');
  };
  const fault = useMutation(trpc.support.attributeFault.mutationOptions({ onSuccess: set }));
  const escalate = useMutation(trpc.support.escalate.mutationOptions({ onSuccess: set }));
  const resolve = useMutation(trpc.support.resolve.mutationOptions({ onSuccess: set }));
  const ok = note.trim().length >= 3;
  const err = fault.error ?? escalate.error ?? resolve.error;
  return (
    <Card title={t('console.sup_actions')}>
      <label htmlFor={ids.note} className="mb-1 block text-sm text-muted">
        {t('console.sup_action_note')}
      </label>
      <textarea id={ids.note} rows={2} maxLength={500} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('console.sup_action_placeholder')} />
      <p className="mt-2 text-xs text-muted">
        {t('console.sup_fault_now')}: <strong>{t(`console.sup_fault_${data.ticket.faultParty}` as MessageKey)}</strong>
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {(['courier', 'merchant', 'platform'] as const).map((f) => (
          <button key={f} type="button" className={`${ghostBtn} px-2 py-1 text-xs`} disabled={!ok || fault.isPending} onClick={() => fault.mutate({ ticketId: data.ticket.id, faultParty: f, note: note.trim() })}>
            {t('console.sup_fault_set', { party: t(`console.sup_fault_${f}` as MessageKey) })}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className={dangerBtn} disabled={!ok || escalate.isPending || data.ticket.status === 'escalated'} onClick={() => escalate.mutate({ ticketId: data.ticket.id, reason: note.trim() })}>
          {t('console.sup_escalate')}
        </button>
        <button type="button" className={primaryBtn} disabled={!ok || resolve.isPending} onClick={() => resolve.mutate({ ticketId: data.ticket.id, resolution: note.trim() })}>
          {t('console.sup_resolve')}
        </button>
      </div>
      <p className="mt-2 text-xs text-faint">{t('console.sup_resolve_hint')}</p>
      {err && <p className="mt-2 text-sm text-bad">{err.message}</p>}
    </Card>
  );
}

function ChatThreads({ orderId, kinds }: { orderId: string; kinds: ChatThreadKind[] }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const [kind, setKind] = useState<ChatThreadKind>(kinds[0]!);
  const thread = useQuery(trpc.chat.thread.queryOptions({ orderId, kind }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));
  return (
    <Card
      title={t('console.sup_chats')}
      actions={
        <div className="flex flex-wrap gap-1">
          {kinds.map((k) => (
            <button key={k} type="button" className={`${ghostBtn} px-2 py-1 text-xs`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(`console.sup_chat_${k}` as MessageKey)}
            </button>
          ))}
        </div>
      }
    >
      <p className="mb-2 text-xs text-faint">{t('console.sup_chats_hint')}</p>
      {thread.error && <QueryError error={thread.error} />}
      {thread.data && thread.data.messages.length === 0 && <EmptyState title={t('console.sup_chat_empty')} />}
      {thread.data && thread.data.messages.length > 0 && (
        <ol className="max-h-80 space-y-2 overflow-y-auto">
          {thread.data.messages.map((m) => (
            <li key={m.id} className="rounded-lg border border-line bg-surface-2/50 px-3 py-1.5 text-sm">
              <p className="text-xs text-muted">
                {t(`console.sup_role_${m.senderRole}` as MessageKey)} · {formatClock(m.createdAt)}
                {m.masked && <span className="text-accent"> · {t('console.sup_masked')}</span>}
              </p>
              <p>{m.text ?? (m.photoUrl ? t('console.sup_photo') : m.location ? t('console.sup_location') : '—')}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
