'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { SupportList, TicketChannel, TicketKind } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { slaClock } from '@/lib/control-room';
import { formatDayClock, formatIqd, shortId } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Card, Chip, EmptyState, ghostBtn, inputCls, LiveBadge, Mono, NeedLogin, PageHeader, primaryBtn, QueryError, Stat, useSecondsSince } from './ui';

type StatusFilter = 'active' | 'escalated' | 'resolved' | 'all';
const FILTERS: readonly StatusFilter[] = ['active', 'escalated', 'resolved', 'all'];
const KINDS: readonly TicketKind[] = ['dispute', 'complaint', 'incident', 'question'];
const CHANNELS: readonly TicketChannel[] = ['phone', 'whatsapp', 'in_app'];
const POLL_MS = 10_000;

export function SupportPage() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const [status, setStatus] = useState<StatusFilter>('active');
  const [opening, setOpening] = useState(false);
  const list = useQuery(trpc.support.list.queryOptions({ cityId: CITY_ID, status }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));
  if (!signedIn) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title={t('console.sup_title')} subtitle={t('console.sup_subtitle')} />
        <NeedLogin />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t('console.sup_title')} subtitle={t('console.sup_subtitle')}>
        <LiveBadge seconds={POLL_MS / 1000} updatedAt={list.dataUpdatedAt} fetching={list.isFetching} />
        <button type="button" className={primaryBtn} onClick={() => setOpening(true)}>
          {t('console.sup_new')}
        </button>
      </PageHeader>
      {list.error && <QueryError error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && <SupportQueue data={list.data} status={status} onStatus={setStatus} updatedAt={list.dataUpdatedAt} />}
      <NewTicketDialog open={opening} onClose={() => setOpening(false)} />
    </div>
  );
}

export function SupportQueue({ data, status, onStatus, updatedAt }: { data: SupportList; status: StatusFilter; onStatus: (s: StatusFilter) => void; updatedAt?: number }) {
  const tick = useSecondsSince(updatedAt ?? 0);
  const now = new Date(data.at.getTime() + tick * 1000);
  const c = data.counts;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t('console.sup_open')} value={c.open} />
        <Stat label={t('console.sup_breached')} value={c.breached} tone={c.breached ? 'bad' : 'ok'} hint={t('console.sup_same_day')} />
        <Stat label={t('console.sup_overdue24')} value={c.overdue24h} tone={c.overdue24h ? 'bad' : 'ok'} hint={t('console.sup_target_zero')} />
        <Stat label={t('console.sup_escalated')} value={c.escalated} tone={c.escalated ? 'accent' : 'default'} />
        <Stat label={t('console.sup_resolved_today')} value={c.resolvedToday} tone="ok" />
      </dl>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('console.sup_filter')}>
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={status === f} className={ghostBtn} onClick={() => onStatus(f)}>
            {t(`console.sup_filter_${f}` as MessageKey)}
          </button>
        ))}
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title={t('console.sup_empty')} hint={t('console.sup_empty_hint')} />
      ) : (
        <Card className="overflow-x-auto p-0 md:p-0">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-line text-start text-xs text-muted">
                <th className="w-2 p-0" aria-label={t('console.sup_col_urgency')} />
                <th className="px-3 py-2 text-start font-medium">{t('console.sup_col_subject')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('console.sup_col_customer')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('console.sup_col_order')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('console.sup_col_sla')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('console.sup_col_status')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('console.sup_col_refunded')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const sla = slaClock(r, now);
                return (
                  <tr key={r.id} className="border-b border-line/60 last:border-b-0 hover:bg-surface-2/50">
                    <td className="p-0">
                      <span aria-hidden className={`block h-12 w-1.5 ${r.urgency >= 60 ? 'bg-bad' : r.urgency >= 30 ? 'bg-accent' : 'bg-line'}`} />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/support/${encodeURIComponent(r.id)}`} className="font-semibold hover:text-accent">
                        {r.subject}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <Chip tone={r.kind === 'incident' ? 'bad' : r.kind === 'dispute' ? 'warn' : 'neutral'}>{r.kind_ar}</Chip>
                        <span>{t(`console.sup_channel_${r.channel}` as MessageKey)}</span>
                        {r.urgencyReasons.slice(0, 2).map((u) => (
                          <span key={u} className="text-accent">
                            · {u}
                          </span>
                        ))}
                      </p>
                    </td>
                    <td className="px-3 py-2">{r.customerName ?? (r.customerId ? <Mono>{shortId(r.customerId)}</Mono> : '—')}</td>
                    <td className="px-3 py-2">
                      {r.orderId ? (
                        <Link href={`/orders/${encodeURIComponent(r.orderId)}`} className="text-accent underline">
                          <Mono>{shortId(r.orderId)}</Mono>
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Chip tone={sla.tone}>{sla.text}</Chip>
                      <p className="mt-0.5 text-xs text-faint">{formatDayClock(r.openedAt)}</p>
                    </td>
                    <td className="px-3 py-2">
                      <Chip tone={r.status === 'escalated' ? 'warn' : r.status === 'resolved' ? 'done' : r.status === 'waiting' ? 'live' : 'neutral'}>{r.status_ar}</Chip>
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.refundedIqd ? formatIqd(r.refundedIqd) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const trpc = useTRPC();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const ids = { subject: useId(), order: useId(), note: useId() };
  const [kind, setKind] = useState<TicketKind>('complaint');
  const [channel, setChannel] = useState<TicketChannel>('phone');
  const [subject, setSubject] = useState('');
  const [orderId, setOrderId] = useState('');
  const [note, setNote] = useState('');
  const create = useMutation(trpc.support.open.mutationOptions({ onSuccess: (tk) => router.push(`/support/${encodeURIComponent(tk.id)}`) }));
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setSubject('');
      setOrderId('');
      setNote('');
      create.reset();
      d.showModal();
    }
    if (!open && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when opened
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (subject.trim().length < 3) return;
    create.mutate({ cityId: CITY_ID, kind, channel, subject: subject.trim(), ...(note.trim() ? { note: note.trim() } : {}), ...(orderId.trim() ? { orderId: orderId.trim() } : {}) });
  };
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="new-ticket" className="w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-text shadow-card">
      <form onSubmit={submit} className="space-y-4 p-5">
        <h2 id="new-ticket" className="font-display text-lg font-semibold">
          {t('console.sup_new')}
        </h2>
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} className={ghostBtn} onClick={() => setKind(k)}>
              {t(`console.sup_kind_${k}` as MessageKey)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {CHANNELS.map((c) => (
            <button key={c} type="button" aria-pressed={channel === c} className={ghostBtn} onClick={() => setChannel(c)}>
              {t(`console.sup_channel_${c}` as MessageKey)}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor={ids.subject} className="mb-1.5 block text-sm text-muted">
            {t('console.sup_subject')}
          </label>
          <input id={ids.subject} required minLength={3} maxLength={200} className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <label htmlFor={ids.order} className="mb-1.5 block text-sm text-muted">
            {t('console.sup_order_id')}
          </label>
          <input id={ids.order} dir="ltr" className={inputCls} value={orderId} onChange={(e) => setOrderId(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label htmlFor={ids.note} className="mb-1.5 block text-sm text-muted">
            {t('console.sup_note')}
          </label>
          <textarea id={ids.note} rows={3} maxLength={2000} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div role="status" className="min-h-[1.25rem] text-sm">
          {create.error && <p className="text-bad">{create.error.message}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={() => ref.current?.close()}>
            {t('console.cancel')}
          </button>
          <button type="submit" className={primaryBtn} disabled={create.isPending || subject.trim().length < 3}>
            {create.isPending ? t('status.loading') : t('console.sup_open_ticket')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
