'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orderTicketNumber, type InboxRow, type TicketChannel, type TicketSummary } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useMemo } from 'react';
import { formatClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { ageText } from '@/lib/safety';
import { SAFETY_POLL_MS } from '@/lib/safety-live';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Button, buttonCls, Chip, cx, IconAlert, QueryError, Skeleton, useNow, useToast } from '../ui';
import { withBdi } from './bdi';

/**
 * Safety reports next to SOS (concept A, Ali 2026-10-08): the support desk's incident tickets (unsafe
 * driving, a phoned-in near miss) shown on the emergencies desk with a minutes clock and who holds
 * them. Who holds one is its Today row (`safety_report`, taken here or on Today). Handling and closing
 * stay in support, as today (y1 off): the row closes by itself when the ticket is resolved there.
 */
export interface SafetyReport {
  ticket: TicketSummary;
  /** Its Today row; null for a ticket opened before Today listened for them. */
  row: InboxRow | null;
}

const CHANNEL_KEY: Record<TicketChannel, MessageKey> = {
  in_app: 'console.sup_channel_in_app',
  whatsapp: 'console.sup_channel_whatsapp',
  phone: 'console.sup_channel_phone',
  system: 'console.sup_channel_system',
  chat: 'console.sup_channel_chat',
};

export function useSafetyReports() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const tickets = useQuery(trpc.support.list.queryOptions({ cityId: CITY_ID, status: 'active', kind: 'incident', limit: 50 }, { enabled: signedIn, retry: queryRetry, refetchInterval: SAFETY_POLL_MS * 2 }));
  const rows = useQuery(trpc.inbox.list.queryOptions({ cityId: CITY_ID, view: 'open', kind: 'safety_report' }, { enabled: signedIn, retry: queryRetry, refetchInterval: SAFETY_POLL_MS * 2 }));
  const reports = useMemo<SafetyReport[]>(() => {
    const bySubject = new Map((rows.data ?? []).map((r) => [r.subjectId, r]));
    return (tickets.data?.rows ?? [])
      .filter((tk) => tk.kind === 'incident' && tk.status !== 'resolved')
      .map((ticket) => ({ ticket, row: bySubject.get(ticket.id) ?? null }))
      .sort((a, b) => a.ticket.openedAt.getTime() - b.ticket.openedAt.getTime());
  }, [tickets.data, rows.data]);
  return { reports, query: tickets };
}

function holderText(row: InboxRow | null): string {
  if (!row?.assigneeId) return t('console.safety.report_nobody');
  return row.mine ? t('console.safety.report_held_you') : t('console.safety.report_held_by', { name: row.assigneeName ?? t('console.oncall_no_name') });
}

/** The list section under the SOS presses. */
export function SafetyReportsSection({ selectedId }: { selectedId: string | null }) {
  const router = useRouter();
  const { reports, query } = useSafetyReports();
  const now = useNow(15_000);
  return (
    <section aria-label={t('console.safety.sec_reports')} data-testid="safety-reports">
      <h2 className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2 text-dense font-semibold text-bad">
        <span>{t('console.safety.sec_reports')}</span>
        <span className="num">{reports.length}</span>
      </h2>
      {query.error && !query.data ? (
        <div className="p-4">
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : query.isPending ? (
        <div className="p-4">
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      ) : reports.length === 0 ? (
        <p className="px-4 py-3 text-dense text-muted">{t('console.safety.reports_none')}</p>
      ) : (
        reports.map(({ ticket, row }) => {
          const selected = ticket.id === selectedId;
          const nobody = !row?.assigneeId;
          const min = (now - ticket.openedAt.getTime()) / 60_000;
          return (
            <button
              key={ticket.id}
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => router.push(`/safety/report/${encodeURIComponent(ticket.id)}`)}
              data-testid={`report-row-${ticket.id}`}
              className={cx('relative flex w-full flex-col gap-0.5 border-b border-line/70 px-4 py-3 text-start transition-colors duration-fast', selected ? 'bg-accent-wash' : 'hover:bg-surface-2')}
            >
              {selected ? <span aria-hidden className="absolute inset-y-0 start-0 w-[3px] bg-bad-solid" /> : null}
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-bold">{withBdi(ticket.subject)}</span>
                <span className={cx('num shrink-0 rounded-md px-2 text-xs font-bold', min < 15 && nobody ? 'bg-bad-tint text-bad' : 'bg-warn-tint text-warn')}>
                  {t('console.safety.report_age', { ago: ageText(now - ticket.openedAt.getTime()) })}
                </span>
              </span>
              <span className="text-dense text-muted">
                {t(CHANNEL_KEY[ticket.channel])}
                {ticket.orderId ? <> · <span className="num">{t('console.safety.report_order_no', { n: orderTicketNumber(ticket.orderId) })}</span></> : null}
              </span>
              <span className={cx('text-dense', nobody ? 'font-semibold text-bad' : 'text-muted')}>{holderText(row)}</span>
            </button>
          );
        })
      )}
      <p className="px-4 py-3 text-xs text-muted">{t('console.safety.reports_hint')}</p>
    </section>
  );
}

/** The detail pane for one report. */
export function SafetyReportView({ ticketId }: { ticketId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const signedIn = useSignedIn();
  const now = useNow(15_000);
  const { reports } = useSafetyReports();
  const kase = useQuery(trpc.support.get.queryOptions({ ticketId }, { enabled: signedIn, retry: queryRetry, refetchInterval: SAFETY_POLL_MS * 2 }));
  const row = reports.find((r) => r.ticket.id === ticketId)?.row ?? null;
  const take = useMutation(
    trpc.inbox.take.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.inbox.list.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.inbox.counts.queryKey() });
        toast({ title: t('console.safety.report_taken'), tone: 'ok' });
      },
      onError: (e) => toast({ title: errorText(e), tone: 'bad' }),
    }),
  );

  if (kase.error && !kase.data)
    return (
      <div className="p-6">
        <QueryError error={kase.error} onRetry={() => void kase.refetch()} />
      </div>
    );
  if (!kase.data)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );

  const { ticket, entries, order } = kase.data;
  const first = entries.find((e) => e.kind === 'opened') ?? entries[0];
  const resolved = ticket.status === 'resolved';
  return (
    <article className="mx-auto max-w-5xl space-y-5 px-4 py-5 lg:px-8 lg:py-6" data-testid="safety-report">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Chip tone={resolved ? 'done' : 'bad'} dot>
            {t(resolved ? 'console.safety.report_closed' : 'console.safety.report_chip')}
          </Chip>
          <h2 className="mt-2 text-2xl font-bold">{withBdi(ticket.subject)}</h2>
          <p className="num mt-1 text-sm text-muted">
            {t('console.safety.report_opened', { time: formatClock(ticket.openedAt), channel: t(CHANNEL_KEY[ticket.channel]) })}
            {first?.actorName ? ` · ${t('console.safety.report_by', { name: first.actorName })}` : ''}
            {` · ${t('console.safety.report_age', { ago: ageText(now - ticket.openedAt.getTime()) })}`}
            {` · ${holderText(row)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row && !row.mine && !resolved ? (
            <Button variant={row.assigneeId ? 'secondary' : 'primary'} size="lg" loading={take.isPending} onClick={() => take.mutate({ id: row.id })} needsNet data-testid="report-take">
              {t('console.safety.report_take')}
            </Button>
          ) : null}
          <Link href={`/support/${encodeURIComponent(ticket.id)}`} className={buttonCls('secondary', 'lg')}>
            {t('console.safety.report_open_support')}
          </Link>
        </div>
      </header>

      {first?.text ? (
        <blockquote className="rounded-lg border-s-[3px] border-bad-solid bg-surface px-4 py-3 text-base leading-relaxed shadow-card">«{withBdi(first.text)}»</blockquote>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-4 shadow-card" aria-label={t('console.safety.report_order')}>
          <h3 className="text-dense text-faint">{t('console.safety.report_order')}</h3>
          {order ? (
            <>
              <p className="num mt-1 text-lg font-bold">{t('console.safety.report_order_no', { n: orderTicketNumber(order.id) })}</p>
              <Link href={`/orders/${encodeURIComponent(order.id)}`} className={cx(buttonCls('secondary', 'sm'), 'mt-3')}>
                {t('console.safety.report_open_order')}
              </Link>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">{t('console.safety.report_no_order')}</p>
          )}
        </section>
        <section className="rounded-lg border border-line bg-surface p-4 shadow-card" aria-label={t('console.safety.report_who')}>
          <h3 className="text-dense text-faint">{t('console.safety.report_who')}</h3>
          <p className="mt-1 text-lg font-bold">{ticket.customerName ?? t('console.oncall_no_name')}</p>
          <p className="text-sm text-muted">{t('console.safety.report_call_hint')}</p>
        </section>
      </div>

      <p className="flex items-start gap-2 rounded-md border border-warn-solid/40 bg-warn-tint px-3 py-2 text-sm text-text" data-testid="waits-ali">
        <IconAlert size={16} className="mt-0.5 shrink-0 text-warn" />
        <span>{t('console.safety.report_pause_waits')}</span>
      </p>
      <p className="text-dense text-muted">{t('console.safety.report_close_hint')}</p>
    </article>
  );
}
