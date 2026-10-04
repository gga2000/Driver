'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApprovalItem, ApprovalKind, ApprovalPhoto, AuditEntry } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useMemo, useState } from 'react';
import { ageLabel, approvalCounts, fileUrl } from '@/lib/control-room';
import { formatDayClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { API_URL, useTRPC } from '@/lib/trpc';
import { errorText } from '@/lib/network';
import { Card, Chip, dangerBtn, EmptyState, ghostBtn, inputCls, LiveBadge, NeedLogin, PageHeader, primaryBtn, QueryError } from './ui';

const KINDS: readonly ApprovalKind[] = ['driver_document', 'merchant_deal', 'landmark_photo', 'merchant_onboarding', 'fleet_vehicle'];
const POLL_MS = 15_000;

/** One-tap reasons the reviewer can start from (edited before sending). */
const REJECT_PRESETS: Record<ApprovalKind, readonly MessageKey[]> = {
  driver_document: ['console.apr_reason_blurry', 'console.apr_reason_expired', 'console.apr_reason_mismatch'],
  merchant_deal: ['console.apr_reason_deal_cost', 'console.apr_reason_deal_parity'],
  landmark_photo: ['console.apr_reason_blurry', 'console.apr_reason_wrong_place'],
  merchant_onboarding: ['console.apr_reason_menu_missing', 'console.apr_reason_owner_id'],
  fleet_vehicle: ['console.apr_reason_plate', 'console.apr_reason_registration'],
};

export function ApprovalsPage() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const [kind, setKind] = useState<ApprovalKind | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery(trpc.approvals.list.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));
  const audit = useQuery(trpc.ops.controls.audit.queryOptions({ cityId: CITY_ID, subjectKind: 'approval', limit: 12 }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title={t('console.apr_title')} subtitle={t('console.apr_subtitle')} />
        <NeedLogin />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t('console.apr_title')} subtitle={t('console.apr_subtitle')}>
        <LiveBadge seconds={POLL_MS / 1000} updatedAt={list.dataUpdatedAt} fetching={list.isFetching} />
      </PageHeader>
      {list.error && <QueryError error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && (
        <ApprovalsBoard items={list.data.items} now={list.data.at} kind={kind} onKind={setKind} selectedId={selected} onSelect={setSelected} audit={audit.data ?? []} onDecided={() => setSelected(null)} />
      )}
    </div>
  );
}

export function ApprovalsBoard({
  items,
  now,
  kind,
  onKind,
  selectedId,
  onSelect,
  audit,
  onDecided,
}: {
  items: ApprovalItem[];
  now: Date;
  kind: ApprovalKind | 'all';
  onKind: (k: ApprovalKind | 'all') => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  audit: AuditEntry[];
  onDecided: () => void;
}) {
  const counts = useMemo(() => approvalCounts(items), [items]);
  const shown = kind === 'all' ? items : items.filter((i) => i.kind === kind);
  const current = shown.find((i) => i.id === selectedId) ?? shown.find((i) => !i.ownItem) ?? shown[0] ?? null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('console.apr_filter')}>
        <button type="button" aria-pressed={kind === 'all'} className={ghostBtn} onClick={() => onKind('all')}>
          {t('console.apr_all')} <Chip tone={items.length ? 'warn' : 'neutral'}>{items.length}</Chip>
        </button>
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} className={ghostBtn} onClick={() => onKind(k)}>
            {t(`console.apr_kind_${k}` as MessageKey)} <Chip tone={counts[k] ? 'warn' : 'neutral'}>{counts[k] ?? 0}</Chip>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState title={t('console.apr_empty')} hint={t('console.apr_empty_hint')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <Card title={t('console.apr_queue', { n: shown.length })} className="lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
            <ul className="space-y-1.5">
              {shown.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(i.id)}
                    aria-current={current?.id === i.id ? 'true' : undefined}
                    className={`w-full rounded-lg border px-3 py-2 text-start transition-colors ${current?.id === i.id ? 'border-accent bg-surface-2' : 'border-line hover:border-muted'}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold">{i.title_ar}</span>
                      <span className="shrink-0 text-xs text-faint">{ageLabel(i.submittedAt, now)}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Chip>{i.kind_ar}</Chip>
                      {i.ownItem && <Chip tone="warn">{t('console.apr_own_chip')}</Chip>}
                      {i.submittedByName && <span className="truncate">{i.submittedByName}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {current && <ApprovalDetail key={current.id} item={current} now={now} onDecided={onDecided} />}
        </div>
      )}

      {audit.length > 0 && (
        <Card title={t('console.apr_recent')}>
          <ul className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 border-b border-line/50 py-1">
                <span className="min-w-0 truncate">{a.summary_ar}</span>
                <span className="shrink-0 text-xs text-faint">
                  {a.actorName ?? t('console.someone')} · {formatDayClock(a.at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ApprovalDetail({ item, now, onDecided }: { item: ApprovalItem; now: Date; onDecided: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ids = { reason: useId(), expiry: useId() };
  const [reason, setReason] = useState('');
  const [expiry, setExpiry] = useState('');
  const [zoom, setZoom] = useState<ApprovalPhoto | null>(null);
  const decide = useMutation(
    trpc.approvals.decide.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.approvals.list.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
        onDecided();
      },
    }),
  );
  useEffect(() => {
    setReason('');
    setExpiry('');
  }, [item.id]);
  const run = (decision: 'approve' | 'reject') =>
    decide.mutate({
      kind: item.kind,
      refId: item.refId,
      decision,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(decision === 'approve' && item.takesExpiry && expiry ? { expiresAt: new Date(`${expiry}T00:00:00+03:00`) } : {}),
    });
  const canReject = reason.trim().length >= 3;
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {item.title_ar} <Chip tone="live">{item.kind_ar}</Chip>
        </span>
      }
    >
      <p className="-mt-1 mb-4 text-sm text-muted">
        {item.subtitle_ar ? `${item.subtitle_ar} · ` : ''}
        {t('console.apr_submitted', { who: item.submittedByName ?? t('console.someone'), age: ageLabel(item.submittedAt, now) })}
      </p>

      {item.ownItem && (
        <p role="note" className="mb-4 rounded-lg border border-primary-500/60 bg-primary-500/10 px-3 py-2 text-sm text-accent">
          {t('console.apr_own_note')}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <PhotoPane title={t('console.apr_under_review')} photos={item.photos} empty={t(`console.apr_no_photo_${item.kind}` as MessageKey)} onZoom={setZoom} highlight />
        <PhotoPane title={t(item.kind === 'merchant_onboarding' ? 'console.apr_compare_menu' : 'console.apr_compare')} photos={item.compare} empty={t('console.apr_no_compare')} onZoom={setZoom} />
      </div>

      {item.facts.length > 0 && (
        <dl className="mt-4 grid gap-x-6 sm:grid-cols-2">
          {item.facts.map((f) => (
            <div key={f.label_ar} className="flex items-baseline justify-between gap-4 border-b border-line/60 py-1.5 text-sm">
              <dt className="shrink-0 text-muted">{f.label_ar}</dt>
              <dd className="min-w-0 text-end">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <fieldset disabled={item.ownItem || decide.isPending} className="mt-5 space-y-3 disabled:opacity-60">
        <div>
          <label htmlFor={ids.reason} className="mb-1.5 block text-sm text-muted">
            {t('console.apr_reason')}
          </label>
          <input id={ids.reason} maxLength={300} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('console.apr_reason_placeholder')} />
          <div className="mt-2 flex flex-wrap gap-1">
            {REJECT_PRESETS[item.kind].map((k) => (
              <button key={k} type="button" className={`${ghostBtn} px-2 py-1 text-xs`} onClick={() => setReason(t(k))}>
                {t(k)}
              </button>
            ))}
          </div>
        </div>
        {item.takesExpiry && (
          <div className="max-w-xs">
            <label htmlFor={ids.expiry} className="mb-1.5 block text-sm text-muted">
              {t('console.apr_expiry')}
            </label>
            <input id={ids.expiry} type="date" dir="ltr" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} onClick={() => run('approve')}>
            {t(`console.apr_approve_${item.kind}` as MessageKey)}
          </button>
          <button type="button" className={dangerBtn} disabled={!canReject} title={canReject ? undefined : t('console.apr_reject_needs_reason')} onClick={() => run('reject')}>
            {t('console.apr_reject')}
          </button>
        </div>
        <div role="status" className="min-h-[1.25rem] text-sm">
          {decide.error && <p className="text-bad">{errorText(decide.error)}</p>}
        </div>
      </fieldset>

      {zoom && <PhotoZoom photo={zoom} onClose={() => setZoom(null)} />}
    </Card>
  );
}

function PhotoPane({ title, photos, empty, onZoom, highlight = false }: { title: string; photos: ApprovalPhoto[]; empty: string; onZoom: (p: ApprovalPhoto) => void; highlight?: boolean }) {
  return (
    <section aria-label={title} className={`rounded-xl border p-3 ${highlight ? 'border-accent/60 bg-surface-2/40' : 'border-line bg-surface-2/20'}`}>
      <h3 className="mb-2 text-xs font-semibold text-muted">{title}</h3>
      {photos.length === 0 ? (
        <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-line px-4 text-center text-sm text-faint">{empty}</div>
      ) : (
        <ul className={`grid gap-2 ${photos.length > 1 ? 'grid-cols-2' : ''}`}>
          {photos.map((p) => (
            <li key={p.url}>
              <button type="button" onClick={() => onZoom(p)} className="group block w-full overflow-hidden rounded-lg border border-line bg-bg" title={t('console.apr_zoom')}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed API URLs, not static assets */}
                <img src={fileUrl(p.url, API_URL)} alt={p.label_ar} className={`w-full object-contain transition-transform group-hover:scale-[1.02] ${photos.length > 1 ? 'aspect-square' : 'aspect-[4/3]'}`} />
              </button>
              <p className="mt-1 truncate text-xs text-muted">{p.label_ar}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PhotoZoom({ photo, onClose }: { photo: ApprovalPhoto; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={photo.label_ar} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed API URLs */}
      <img src={fileUrl(photo.url, API_URL)} alt={photo.label_ar} className="max-h-full max-w-full rounded-lg object-contain" />
      <button type="button" className={`${ghostBtn} absolute end-4 top-4`} onClick={onClose} aria-label={t('console.close')}>
        ✕
      </button>
    </div>
  );
}
