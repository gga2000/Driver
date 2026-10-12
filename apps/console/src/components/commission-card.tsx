'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommissionDueRow, CommissionTier, MerchantCommissionTier, MerchantCommissionView } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useState } from 'react';
import { formatDate, formatDayClock } from '@/lib/format';
import { queryRetry } from '@/lib/live';
import { errorText, useConsoleNetwork } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, cx, Dialog, QueryError, Skeleton, useToast } from './ui';

export const tierLabel = (tier: CommissionTier) => t(`console.commission.tier_${tier}` as MessageKey);
/** «12%» isolated LTR so the sign stays on the right inside an Arabic line. */
const pctText = (pct: number) => `\u2066${pct}%\u2069`;

/**
 * Console › a store's commission (GAP-06, Ali 2026-10-11): its tier and rate, the starter period's
 * start, the 7-week reminder, and finance's / an admin's control to put it on another tier
 * (`finance.setCommissionTier`, audited). Nothing switches by itself.
 */
export function CommissionCard({ merchantOrgId }: { merchantOrgId: string }) {
  const trpc = useTRPC();
  const view = useQuery(trpc.finance.commission.queryOptions({ merchantOrgId }, { retry: queryRetry }));
  if (view.error) return <QueryError error={view.error} onRetry={() => void view.refetch()} />;
  if (!view.data) {
    return (
      <Card title={t('console.commission.title')}>
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-5 w-1/2 rounded-md" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      </Card>
    );
  }
  return (
    <Card title={t('console.commission.title')} hint={view.data.name} tone={view.data.reviewDue ? 'warn' : 'default'}>
      <CommissionControl view={view.data} />
    </Card>
  );
}

function CommissionControl({ view, onSaved }: { view: MerchantCommissionView; onSaved?: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const net = useConsoleNetwork();
  const [picked, setPicked] = useState<MerchantCommissionTier | null>(null);
  const current = picked ?? (view.tier === 'pickup' ? null : view.tier);
  const dirty = picked !== null && (picked !== view.tier || !view.onFile);
  const save = useMutation(
    trpc.finance.setCommissionTier.mutationOptions({
      onSuccess: (saved) => {
        qc.setQueryData(trpc.finance.commission.queryKey({ merchantOrgId: saved.merchantOrgId }), saved);
        void qc.invalidateQueries({ queryKey: trpc.finance.desk.queryKey() });
        setPicked(null);
        toast({ title: t('console.commission.saved', { name: saved.name, pct: pctText(saved.pct) }), tone: 'ok' });
        onSaved?.();
      },
      onError: (e) => toast({ title: t('console.commission.save_failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  );
  const offline = net.state === 'offline';
  return (
    <div data-testid="commission-control">
      <p className="max-w-[68ch] text-sm text-muted">{t('console.commission.intro')}</p>
      <p className="mt-3 text-lg font-semibold text-text" data-testid="commission-now">
        {t('console.commission.now', { tier: tierLabel(view.tier), pct: pctText(view.pct) })}
      </p>
      {!view.onFile ? <p className="text-dense text-muted">{t('console.commission.default_note')}</p> : null}
      {view.starterSince ? (
        <p className="text-dense text-text">{t('console.commission.starter_since', { date: formatDate(view.starterSince), days: t('console.commission.days', { n: view.starterDays ?? 0 }) })}</p>
      ) : null}
      {view.reviewDue ? (
        <p role="status" className="mt-3 rounded-md border border-warn/40 bg-warn-tint px-3 py-2 text-sm text-text" data-testid="commission-due">
          {t('console.commission.review_due')}
        </p>
      ) : null}
      {view.lastChange ? <p className="mt-2 text-xs text-muted">{t('console.commission.last_change', { name: view.lastChange.byName ?? t('console.someone'), when: formatDayClock(view.lastChange.at) })}</p> : null}

      <div role="radiogroup" aria-label={t('console.commission.pick')} className="mt-4 grid grid-cols-2 gap-2">
        {view.options.map((o) => (
          <button
            key={o.tier}
            type="button"
            role="radio"
            aria-checked={current === o.tier}
            onClick={() => setPicked(o.tier)}
            className={cx(
              'min-h-11 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-fast',
              current === o.tier ? 'border-accent bg-accent-tint text-text' : 'border-line bg-surface text-text hover:border-line-strong hover:bg-surface-2',
            )}
          >
            {t('console.commission.option', { tier: tierLabel(o.tier), pct: pctText(o.pct) })}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="max-w-[48ch] text-xs text-muted">{offline ? t('console.net_offline') : t('console.commission.audited')}</p>
        <Button size="lg" variant="primary" loading={save.isPending} disabled={!dirty || offline} onClick={() => picked && save.mutate({ merchantOrgId: view.merchantOrgId, tier: picked })}>
          {t('console.commission.save')}
        </Button>
      </div>
    </div>
  );
}

/** The finance desk's reminder: starter stores past 7 weeks, each with «اختار العمولة». */
export function CommissionDueCard({ rows, canSet }: { rows: CommissionDueRow[]; canSet: boolean }) {
  const [open, setOpen] = useState<CommissionDueRow | null>(null);
  if (rows.length === 0) return null;
  return (
    <Card title={t('console.commission.due_title')} hint={t('console.commission.due_hint')} tone="warn">
      <ul className="-my-1 divide-y divide-line" data-testid="commission-due-list">
        {rows.map((r) => (
          <li key={r.merchantOrgId} className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{r.name}</span>
              <span className="block text-xs text-muted">{t('console.commission.due_row', { date: formatDate(r.starterSince), days: t('console.commission.days', { n: r.days }) })}</span>
            </span>
            {canSet ? (
              <Button size="sm" variant="secondary" needsNet onClick={() => setOpen(r)}>
                {t('console.commission.choose')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <Dialog open={open !== null} onClose={() => setOpen(null)} title={t('console.commission.title')} description={open?.name}>
        {open ? <DialogBody merchantOrgId={open.merchantOrgId} onSaved={() => setOpen(null)} /> : null}
      </Dialog>
    </Card>
  );
}

function DialogBody({ merchantOrgId, onSaved }: { merchantOrgId: string; onSaved: () => void }) {
  const trpc = useTRPC();
  const view = useQuery(trpc.finance.commission.queryOptions({ merchantOrgId }, { retry: queryRetry }));
  if (view.error) return <QueryError error={view.error} onRetry={() => void view.refetch()} />;
  if (!view.data) return <Skeleton className="h-40 w-full rounded-md" />;
  return <CommissionControl view={view.data} onSaved={onSaved} />;
}
