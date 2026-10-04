'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApprovalItem, ApprovalKind, ApprovalPhoto, AuditEntry } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ageLabel, approvalCounts, arabicDay, fileUrl, nextAfter } from '@/lib/control-room';
import { formatDayClock } from '@/lib/format';
import { stepIndex, useHotkeys } from '@/lib/hotkeys';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { API_URL, useTRPC } from '@/lib/trpc';
import { errorText } from '@/lib/network';
import {
  Avatar,
  Button,
  Card,
  Chip,
  cx,
  EmptyState,
  Field,
  IconBack,
  IconCheckCircle,
  IconClose,
  IconForward,
  IconLock,
  IconZoom,
  IconButton,
  Input,
  Kbd,
  LiveBadge,
  NeedLogin,
  PageHeader,
  QueryError,
  Skeleton,
  Tabs,
  useToast,
} from './ui';

const KINDS: readonly ApprovalKind[] = ['driver_document', 'merchant_deal', 'landmark_photo', 'merchant_onboarding', 'fleet_vehicle'];
const POLL_MS = 15_000;

/** One-tap reasons the reviewer can start from (keys 1–4; edited before sending). */
const REJECT_PRESETS: Record<ApprovalKind, readonly MessageKey[]> = {
  driver_document: ['console.apr_reason_blurry', 'console.apr_reason_expired', 'console.apr_reason_mismatch'],
  merchant_deal: ['console.apr_reason_deal_cost', 'console.apr_reason_deal_parity'],
  landmark_photo: ['console.apr_reason_blurry', 'console.apr_reason_wrong_place'],
  merchant_onboarding: ['console.apr_reason_menu_missing', 'console.apr_reason_owner_id'],
  fleet_vehicle: ['console.apr_reason_plate', 'console.apr_reason_registration'],
};

/** Quick expiry choices for documents (years from today), instead of a US-format date box (K-15). */
const EXPIRY_YEARS = [1, 2, 3, 5] as const;

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
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title={t('console.apr_title')} subtitle={t('console.apr_subtitle')}>
        <span className="hidden items-center gap-1.5 text-xs text-muted lg:inline-flex" aria-hidden>
          <Kbd>A</Kbd> {t('console.apr_key_approve')} <Kbd>X</Kbd> {t('console.apr_key_reject')} <Kbd>J</Kbd>
          <Kbd>K</Kbd> {t('console.apr_key_move')}
        </span>
        <LiveBadge seconds={POLL_MS / 1000} updatedAt={list.dataUpdatedAt} fetching={list.isFetching} error={Boolean(list.error)} />
      </PageHeader>
      {list.error && <QueryError error={list.error} onRetry={() => void list.refetch()} />}
      {!list.data && list.isPending && (
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]" aria-busy>
          <Skeleton className="h-[480px] rounded-lg" />
          <Skeleton className="h-[480px] rounded-lg" />
        </div>
      )}
      {list.data && (
        <ApprovalsBoard
          items={list.data.items}
          now={list.data.at}
          kind={kind}
          onKind={setKind}
          selectedId={selected}
          onSelect={setSelected}
          audit={audit.data ?? []}
          onDecided={(next) => setSelected(next)}
        />
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
  /** Called with the item to show next once one is decided. */
  onDecided: (nextId: string | null) => void;
}) {
  const counts = useMemo(() => approvalCounts(items), [items]);
  const shown = kind === 'all' ? items : items.filter((i) => i.kind === kind);
  const current = shown.find((i) => i.id === selectedId) ?? shown.find((i) => !i.ownItem) ?? shown[0] ?? null;
  const index = current ? shown.indexOf(current) : -1;
  const move = (d: 1 | -1) => {
    const next = shown[stepIndex(index, shown.length, d)];
    if (next) onSelect(next.id);
  };
  return (
    <div className="space-y-5">
      <Tabs<ApprovalKind | 'all'>
        label={t('console.apr_filter')}
        value={kind}
        onChange={onKind}
        options={[{ value: 'all', label: t('console.apr_all'), count: items.length }, ...KINDS.map((k) => ({ value: k, label: t(`console.apr_kind_${k}` as MessageKey), count: counts[k] ?? 0 }))]}
      />

      {shown.length === 0 ? (
        <EmptyState icon={<IconCheckCircle size={20} />} title={kind === 'all' ? t('console.apr_empty') : t('console.apr_empty_kind', { kind: t(`console.apr_kind_${kind}` as MessageKey) })} hint={t('console.apr_empty_hint')} />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <nav aria-label={t('console.apr_queue', { n: shown.length })} className="rounded-lg border border-line bg-surface shadow-card lg:sticky lg:top-6">
            <p className="flex items-center justify-between border-b border-line px-4 py-2.5 text-dense font-semibold">
              {t('console.apr_queue_title')}
              <span className="num text-xs font-medium text-muted">{shown.length}</span>
            </p>
            <ol className="max-h-[calc(100vh-15rem)] overflow-y-auto p-1.5">
              {shown.map((i) => {
                const on = current?.id === i.id;
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(i.id)}
                      aria-current={on ? 'true' : undefined}
                      className={cx(
                        'relative w-full rounded-md px-3 py-2 text-start transition-colors duration-fast',
                        on ? 'bg-accent-wash' : 'hover:bg-surface-2',
                      )}
                    >
                      {on && <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-pill bg-accent" />}
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cx('min-w-0 truncate text-sm', on ? 'font-semibold text-text' : 'font-medium text-text')}>{i.title_ar}</span>
                        <span className="num shrink-0 text-xs text-muted">{ageLabel(i.submittedAt, now)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                        <span className="truncate">
                          {i.kind_ar}
                          {i.submittedByName ? ` · ${i.submittedByName}` : ''}
                        </span>
                        {i.ownItem && (
                          <Chip size="sm" tone="warn">
                            {t('console.apr_own_chip')}
                          </Chip>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          {current && (
            <ApprovalDetail
              key={current.id}
              item={current}
              now={now}
              position={{ n: index + 1, of: shown.length }}
              onMove={move}
              onDecided={() => onDecided(nextAfter(shown, current.id)?.id ?? null)}
            />
          )}
        </div>
      )}

      {audit.length > 0 && (
        <Card title={t('console.apr_recent')}>
          <ul className="grid gap-x-8 md:grid-cols-2">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center gap-3 border-b border-line/70 py-2 text-sm">
                <Avatar name={a.actorName} id={a.actorId} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{a.actorName ?? t('console.someone')}</span> {a.summary_ar}
                </span>
                <span className="num shrink-0 text-xs text-muted">{formatDayClock(a.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** "بعد سنة" / "بعد سنتين" / "بعد 3 سنين", as people say it. */
function yearsLabel(n: number): string {
  return n === 1 ? t('console.apr_years_1') : n === 2 ? t('console.apr_years_2') : t('console.apr_years', { n });
}

function yearsFrom(now: Date, years: number): string {
  const d = new Date(now.getTime() + 3 * 3_600_000);
  return `${d.getUTCFullYear() + years}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function ApprovalDetail({ item, now, position, onMove, onDecided }: { item: ApprovalItem; now: Date; position: { n: number; of: number }; onMove: (d: 1 | -1) => void; onDecided: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ids = { reason: useId(), expiry: useId() };
  const reasonRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState('');
  const [expiry, setExpiry] = useState('');
  const [customDate, setCustomDate] = useState(false);
  const [zoom, setZoom] = useState<ApprovalPhoto | null>(null);
  const [needReason, setNeedReason] = useState(false);
  const lastG = useRef(0);
  const decide = useMutation(
    trpc.approvals.decide.mutationOptions({
      onSuccess: (r) => {
        void qc.invalidateQueries({ queryKey: trpc.approvals.list.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
        toast({ title: r.decision === 'approve' ? t('console.apr_toast_approved', { title: item.title_ar }) : t('console.apr_toast_rejected', { title: item.title_ar }), tone: 'ok' });
        onDecided();
      },
    }),
  );
  const presets = REJECT_PRESETS[item.kind];
  const canReject = reason.trim().length >= 3;
  const locked = item.ownItem || decide.isPending;
  const run = (decision: 'approve' | 'reject') => {
    if (locked) return;
    if (decision === 'reject' && !canReject) {
      setNeedReason(true);
      reasonRef.current?.focus();
      return;
    }
    decide.mutate({
      kind: item.kind,
      refId: item.refId,
      decision,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(decision === 'approve' && item.takesExpiry && expiry ? { expiresAt: new Date(`${expiry}T00:00:00+03:00`) } : {}),
    });
  };
  // "g a" jumps to this page from anywhere: an "a" right after "g" is navigation, never an approval.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyG') lastG.current = Date.now();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const afterG = () => Date.now() - lastG.current < 1000;
  useHotkeys(
    {
      a: () => !afterG() && run('approve'),
      x: () => !afterG() && run('reject'),
      j: () => !afterG() && onMove(1),
      k: () => !afterG() && onMove(-1),
      ...Object.fromEntries(presets.map((k, i) => [String(i + 1), () => !locked && (setReason(t(k)), setNeedReason(false))])),
    },
    { enabled: zoom === null },
  );
  const compare = item.compare.length > 0;
  return (
    <article aria-labelledby="apr-title" className="rounded-lg border border-line bg-surface shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-4">
        <div className="min-w-0">
          <p className="mb-1 flex items-center gap-2 text-xs text-muted">
            <Chip size="sm" tone="live">
              {item.kind_ar}
            </Chip>
            <span className="num">{t('console.apr_position', { n: position.n, of: position.of })}</span>
          </p>
          <h2 id="apr-title" className="text-lg font-semibold">
            {item.title_ar}
          </h2>
          <p className="text-sm text-muted">
            {item.subtitle_ar ? `${item.subtitle_ar} · ` : ''}
            {t('console.apr_submitted', { who: item.submittedByName ?? t('console.someone'), age: ageLabel(item.submittedAt, now) })}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label={t('console.apr_prev')} onClick={() => onMove(-1)} disabled={position.n <= 1}>
            <IconBack size={18} />
          </IconButton>
          <IconButton label={t('console.apr_next')} onClick={() => onMove(1)} disabled={position.n >= position.of}>
            <IconForward size={18} />
          </IconButton>
        </div>
      </header>

      <div className="space-y-5 px-6 py-5">
        {item.ownItem && (
          <p role="note" className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn-tint px-3 py-2.5 text-sm text-text">
            <IconLock size={16} className="shrink-0 text-warn" />
            {t('console.apr_own_note')}
          </p>
        )}

        {compare ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <PhotoPane title={t('console.apr_under_review')} photos={item.photos} empty={t(`console.apr_no_photo_${item.kind}` as MessageKey)} onZoom={setZoom} highlight />
              <PhotoPane title={t(item.kind === 'merchant_onboarding' ? 'console.apr_compare_menu' : 'console.apr_compare')} photos={item.compare} empty={t('console.apr_no_compare')} onZoom={setZoom} />
            </div>
            <Facts facts={item.facts} cols />
          </>
        ) : (
          // Nothing to compare (K-20): the photo takes the room and the facts sit beside it.
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_15rem]">
            <PhotoPane title={t('console.apr_under_review')} photos={item.photos} empty={t(`console.apr_no_photo_${item.kind}` as MessageKey)} onZoom={setZoom} highlight tall />
            <div className="min-w-0">
              <Facts facts={item.facts} />
              {item.kind !== 'merchant_deal' && <p className="mt-3 text-xs text-muted">{t('console.apr_nothing_to_compare')}</p>}
            </div>
          </div>
        )}
      </div>

      <footer className="sticky bottom-0 z-[2] space-y-4 rounded-b-lg border-t border-line bg-surface-2 px-6 py-4 shadow-[0_-6px_16px_-12px_rgb(var(--c-shadow)/0.5)]">
        <fieldset disabled={locked} className="space-y-4 disabled:opacity-60">
          <legend className="sr-only">{t('console.apr_decide')}</legend>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <Field label={t('console.apr_reason')} htmlFor={ids.reason} error={needReason && !canReject ? t('console.apr_reject_needs_reason') : undefined}>
              <Input
                ref={reasonRef}
                id={ids.reason}
                maxLength={300}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setNeedReason(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
                }}
                placeholder={t('console.apr_reason_placeholder')}
                aria-invalid={needReason && !canReject}
              />
            </Field>
            {item.takesExpiry && (
              <Field label={t('console.apr_expiry')} htmlFor={ids.expiry} hint={expiry ? t('console.apr_expires_on', { date: arabicDay(expiry, true) }) : t('console.apr_expiry_optional')}>
                {customDate ? (
                  <Input id={ids.expiry} type="date" dir="ltr" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-44" />
                ) : (
                  <div id={ids.expiry} role="group" aria-label={t('console.apr_expiry')} className="flex flex-wrap gap-1">
                    {EXPIRY_YEARS.map((y) => {
                      const v = yearsFrom(now, y);
                      return (
                        <Button key={y} size="sm" aria-pressed={expiry === v} onClick={() => setExpiry(expiry === v ? '' : v)}>
                          {yearsLabel(y)}
                        </Button>
                      );
                    })}
                    <Button size="sm" variant="ghost" onClick={() => setCustomDate(true)}>
                      {t('console.apr_other_date')}
                    </Button>
                  </div>
                )}
              </Field>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">{t('console.apr_quick_reasons')}</span>
            {presets.map((k, i) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setReason(t(k));
                  setNeedReason(false);
                }}
                className={cx(
                  'inline-flex h-7 items-center gap-1.5 rounded-pill border px-2.5 text-xs transition-colors duration-fast',
                  reason === t(k) ? 'border-accent/70 bg-accent-tint font-semibold text-text' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-text',
                )}
              >
                <Kbd>{i + 1}</Kbd>
                {t(k)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" kbd="A" onClick={() => run('approve')}>
                {t(`console.apr_approve_${item.kind}` as MessageKey)}
              </Button>
              <Button variant="danger-soft" size="lg" kbd="X" onClick={() => run('reject')}>
                {canReject ? t('console.apr_reject_with', { reason: reason.trim().length > 24 ? `${reason.trim().slice(0, 24)}…` : reason.trim() }) : t('console.apr_reject')}
              </Button>
            </div>
            <div role="status" className="text-sm">
              {decide.error && <p className="text-bad">{errorText(decide.error)}</p>}
            </div>
          </div>
        </fieldset>
      </footer>

      {zoom && <PhotoZoom photo={zoom} onClose={() => setZoom(null)} />}
    </article>
  );
}

function Facts({ facts, cols = false }: { facts: ApprovalItem['facts']; cols?: boolean }) {
  if (facts.length === 0) return null;
  return (
    <dl className={cx('grid gap-x-8', cols && 'sm:grid-cols-2')}>
      {facts.map((f) => (
        <div key={f.label_ar} className={cx('border-b border-line/70 py-2 text-sm', cols ? 'flex items-baseline justify-between gap-4' : '')}>
          <dt className="shrink-0 text-xs text-muted">{f.label_ar}</dt>
          <dd className={cx('min-w-0 font-medium', cols && 'text-end')}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PhotoPane({
  title,
  photos,
  empty,
  onZoom,
  highlight = false,
  tall = false,
}: {
  title: string;
  photos: ApprovalPhoto[];
  empty: string;
  onZoom: (p: ApprovalPhoto) => void;
  highlight?: boolean;
  tall?: boolean;
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-dense font-semibold">
        {highlight && <span aria-hidden className="h-2 w-2 rounded-pill bg-accent" />}
        {title}
      </h3>
      {photos.length === 0 ? (
        <div className={cx('flex items-center justify-center rounded-md border border-dashed border-line-strong/60 bg-surface-2 px-6 text-center text-sm text-muted', tall ? 'h-48' : 'aspect-[4/3]')}>{empty}</div>
      ) : (
        <ul className={cx('grid gap-3', photos.length > 1 && 'grid-cols-2')}>
          {photos.map((p) => (
            <li key={p.url} className="min-w-0">
              <button
                type="button"
                onClick={() => onZoom(p)}
                className={cx('group relative block w-full overflow-hidden rounded-md border bg-surface-3', highlight ? 'border-accent/60' : 'border-line')}
                aria-label={`${t('console.apr_zoom')}: ${p.label_ar}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed API URLs, not static assets */}
                <img src={fileUrl(p.url, API_URL)} alt={p.label_ar} className={cx('w-full object-contain', tall && photos.length === 1 ? 'h-[300px]' : photos.length > 1 ? 'aspect-square' : 'aspect-[4/3]')} />
                <span aria-hidden className="absolute bottom-2 end-2 inline-flex h-8 w-8 items-center justify-center rounded-pill bg-inverse/80 text-on-inverse opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100">
                  <IconZoom size={16} />
                </span>
              </button>
              <p className="mt-1.5 truncate text-xs text-muted">{p.label_ar}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PhotoZoom({ photo, onClose }: { photo: ApprovalPhoto; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={photo.label_ar} className="m-auto max-h-[92vh] max-w-[92vw] overflow-visible bg-transparent p-0 backdrop:bg-inverse/80" onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed API URLs */}
      <img src={fileUrl(photo.url, API_URL)} alt={photo.label_ar} className="max-h-[86vh] max-w-[92vw] rounded-lg object-contain shadow-overlay" />
      <p className="mt-2 text-center text-sm text-on-inverse">{photo.label_ar}</p>
      <IconButton label={t('console.close')} variant="secondary" className="absolute -top-3 end-[-12px]" onClick={() => ref.current?.close()}>
        <IconClose size={18} />
      </IconButton>
    </dialog>
  );
}
