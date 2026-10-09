'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RefundApproval } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import Link from 'next/link';
import { useId, useState } from 'react';
import { ageLabel } from '@/lib/control-room';
import { formatDayClock, formatIqd, formatMoney } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { errorText } from '@/lib/network';
import { LIMIT_KEY, refundHref, refundRole, STATE_TONE } from '@/lib/refund-approvals';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, cx, Dialog, Field, IconRefund, QueryError, Segmented, Skeleton, Textarea, useToast } from './ui';

const POLL_MS = 15_000;
const NOTE_MIN = 3;

function useInvalidate() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: trpc.support.refundApprovals.list.pathKey() });
    void qc.invalidateQueries({ queryKey: trpc.support.get.pathKey() });
  };
}

/**
 * Refunds over a staff limit (Ali, 2026-10-08, admins too): nothing posts until someone else in
 * finance or admin approves. On the approvals page, above the other queues; the oldest wait first.
 */
export function RefundApprovalsQueue() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const [state, setState] = useState<'pending' | 'decided'>('pending');
  const list = useQuery(
    trpc.support.refundApprovals.list.queryOptions({ state, cityId: CITY_ID }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }),
  );
  if (!signedIn) return null;
  const rows = list.data ?? [];
  const now = new Date(list.dataUpdatedAt || Date.now());
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <IconRefund size={18} className="text-accent-text" />
          {t('console.ra_title')}
          {state === 'pending' && rows.length > 0 ? (
            <Chip tone="warn" size="sm">
              {rows.length}
            </Chip>
          ) : null}
        </span>
      }
      hint={t('console.ra_hint')}
      actions={
        <Segmented
          size="sm"
          label={t('console.ra_title')}
          value={state}
          onChange={setState}
          options={[
            { value: 'pending', label: t('console.ra_tab_pending') },
            { value: 'decided', label: t('console.ra_tab_decided') },
          ]}
        />
      }
    >
      {list.error ? <QueryError error={list.error} onRetry={() => void list.refetch()} /> : null}
      {!list.data && list.isPending ? <Skeleton className="h-24 rounded-md" /> : null}
      {list.data && rows.length === 0 ? (
        <p className="text-sm text-muted">{t(state === 'pending' ? 'console.ra_empty' : 'console.ra_empty_decided')}</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="divide-y divide-line/70" aria-label={t('console.ra_title')} data-testid="refund-approvals">
          {rows.map((a) => (
            <RefundRow key={a.id} a={a} now={now} />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function RefundRow({ a, now }: { a: RefundApproval; now: Date }) {
  const me = useMyRoles();
  const role = refundRole(a, me);
  const href = refundHref(a);
  const asker = a.requestedBy.name ?? t('console.someone');
  return (
    <li className="flex flex-col gap-x-4 gap-y-2 py-3 sm:flex-row sm:items-start" data-testid="refund-approval">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="num text-lg font-bold text-text">{formatMoney(a.amountIqd)}</span>
          <Chip size="sm" tone={STATE_TONE[a.state]} dot>
            {t(`console.ra_state_${a.state}` as MessageKey)}
          </Chip>
          <Chip size="sm">{t(a.kind === 'ticket' ? 'console.ra_kind_ticket' : 'console.ra_kind_dispute')}</Chip>
        </p>
        <p className="mt-1 text-dense text-text">
          {t(LIMIT_KEY[a.limit])}
          <span aria-hidden className="mx-1.5 text-faint">
            ·
          </span>
          {t('console.ra_funded', { party: t(`console.sup_fault_${a.faultParty}` as MessageKey) })}
          {a.method ? (
            <>
              <span aria-hidden className="mx-1.5 text-faint">
                ·
              </span>
              {t(`console.sup_method_${a.method}` as MessageKey)}
            </>
          ) : null}
        </p>
        {a.note ? <p className="mt-1 text-dense text-muted">«{a.note}»</p> : null}
        <p className="num mt-1 text-xs text-muted">
          {t('console.ra_asked_by', { name: asker, age: ageLabel(a.requestedAt, now) })}
          {a.decidedAt ? (
            <>
              <span aria-hidden className="mx-1.5 text-faint">
                ·
              </span>
              {t(`console.ra_decided_${a.state}` as MessageKey, {
                name: a.decidedBy?.name ?? t('console.someone'),
                time: formatDayClock(a.decidedAt),
              })}
            </>
          ) : null}
        </p>
        {a.declineNote ? <p className="mt-1 text-dense text-bad">«{a.declineNote}»</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {href ? (
          <Link href={href} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-accent-text hover:bg-surface-2">
            {t(a.ticketId ? 'console.ra_open_case' : 'console.ra_open_order')}
          </Link>
        ) : null}
        {a.state === 'pending' ? <RefundActions a={a} role={role} /> : null}
      </div>
    </li>
  );
}

function RefundActions({ a, role, compact = false }: { a: RefundApproval; role: ReturnType<typeof refundRole>; compact?: boolean }) {
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const noteId = useId();
  const onError = (e: unknown) => toast({ title: errorText(e as { message?: string }), tone: 'bad' });
  const ok = (title: string) => {
    toast({ title, tone: 'ok' });
    setDeclining(false);
    setNote('');
    invalidate();
  };
  const amount = formatIqd(a.amountIqd);
  const approve = useMutation(trpc.support.refundApprovals.approve.mutationOptions({ onSuccess: () => ok(t('console.ra_approved', { amount })), onError }));
  const decline = useMutation(trpc.support.refundApprovals.decline.mutationOptions({ onSuccess: () => ok(t('console.ra_declined', { amount })), onError }));
  const cancel = useMutation(trpc.support.refundApprovals.cancel.mutationOptions({ onSuccess: () => ok(t('console.ra_cancelled', { amount })), onError }));

  if (role === 'asker') {
    return (
      <>
        {compact ? null : <span className="text-xs text-muted">{t('console.ra_yours')}</span>}
        <Button size="sm" variant="ghost" needsNet loading={cancel.isPending} onClick={() => cancel.mutate({ id: a.id })} data-testid="ra-cancel">
          {t('console.ra_cancel')}
        </Button>
      </>
    );
  }
  if (role === 'watcher') return <span className="text-xs text-muted">{t('console.ra_waits_finance')}</span>;
  return (
    <>
      <Button size="sm" variant="secondary" needsNet onClick={() => setDeclining(true)} data-testid="ra-decline">
        {t('console.ra_decline')}
      </Button>
      <Button size="sm" variant="primary" needsNet loading={approve.isPending} onClick={() => approve.mutate({ id: a.id })} data-testid="ra-approve">
        {t('console.ra_approve', { amount })}
      </Button>
      <Dialog
        open={declining}
        onClose={() => setDeclining(false)}
        width="sm"
        title={t('console.ra_decline_title', { amount })}
        description={t('console.ra_decline_body')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeclining(false)}>
              {t('console.cancel')}
            </Button>
            <Button
              variant="danger"
              needsNet
              loading={decline.isPending}
              disabled={note.trim().length < NOTE_MIN}
              onClick={() => decline.mutate({ id: a.id, note: note.trim() })}
              data-testid="ra-decline-confirm"
            >
              {t('console.ra_decline')}
            </Button>
          </>
        }
      >
        <div className="pb-2">
          <Field label={t('console.ra_decline_note')} htmlFor={noteId} hint={t('console.ra_decline_note_hint')}>
            <Textarea id={noteId} rows={3} maxLength={500} value={note} required onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

/**
 * On a support case: a refund on it is waiting for a second OK. The person who asked can take it
 * back here; everyone sees who it waits on.
 */
export function PendingRefundStrip({ pending, className }: { pending: { id: string; amountIqd: number; requestedAt: Date }; className?: string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const me = useMyRoles();
  const list = useQuery(trpc.support.refundApprovals.list.queryOptions({ state: 'pending', cityId: CITY_ID }, { enabled: signedIn, refetchInterval: POLL_MS, retry: false }));
  const row = list.data?.find((a) => a.id === pending.id);
  const role = row ? refundRole(row, me) : 'watcher';
  return (
    <div data-testid="pending-refund" className={cx('rounded-lg border border-warn/50 bg-warn-tint px-3 py-2.5', className)}>
      <p className="flex items-start gap-2 text-dense text-text">
        <IconRefund size={16} className="mt-0.5 shrink-0 text-warn" />
        <span className="min-w-0">
          <span className="num block font-semibold">{t('console.ra_strip', { amount: formatIqd(pending.amountIqd) })}</span>
          <span className="num block text-xs text-muted">
            {row ? t('console.ra_asked_by', { name: row.requestedBy.name ?? t('console.someone'), age: ageLabel(pending.requestedAt, new Date()) }) : ageLabel(pending.requestedAt, new Date())}
            {role === 'watcher' ? ` · ${t('console.ra_waits_finance')}` : ''}
          </span>
        </span>
      </p>
      {row && role !== 'watcher' ? (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <RefundActions a={row} role={role} compact />
        </div>
      ) : null}
    </div>
  );
}
