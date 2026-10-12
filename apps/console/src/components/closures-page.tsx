'use client';

import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CLOSURE_EDIT_ROLES, CLOSURE_LIMITS, ClosureReason, type ClosureView, type LatLng } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatClock } from '@/lib/format';
import { isTypingTarget } from '@/lib/hotkeys';
import { CITY_ID, CITY_TZ, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { errorText } from '@/lib/network';
import { useTheme } from '@/lib/prefs';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, cx, Drawer, EmptyState, Field, Input, NeedLogin, PageHeader, QueryError, Row, Skeleton, useNow, useToast, type ChipTone } from './ui';

const ClosuresMapCanvas = dynamic(() => import('./closures-map-canvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted" role="status">
      {t('console.map_loading')}
    </div>
  ),
});

const REASONS = ClosureReason.options;
/** Mirrors the server's CLOSURES_RULES.minOpenMs: a closure must stay at least this long. */
const MIN_OPEN_MS = 5 * 60_000;
const LIST_REFRESH_MS = 60_000;
const ORIGIN: LatLng = { lat: 0, lng: 0 };

type ClosureState = 'active' | 'opened' | 'ended';
const STATE_TONE: Record<ClosureState, ChipTone> = { active: 'bad', opened: 'done', ended: 'neutral' };

/** A courier's report still waiting for ops: it routes nothing until confirmed (or a second report). */
const isWaiting = (c: ClosureView): boolean => c.active && c.source === 'courier' && !c.confirmed;

function stateOf(c: ClosureView): ClosureState {
  if (c.active) return 'active';
  return c.openedAt ? 'opened' : 'ended';
}

const nameOf = (c: Pick<ClosureView, 'nameAr'>): string => c.nameAr ?? t('console.closures_unnamed');
const reasonLabel = (r: ClosureReason): string => t(`console.closures_reason_${r}`);
const metres = (m: number): string => t('console.closures_length_value', { m: m.toLocaleString('en-US') });

/** Today's wall clock in the city, and the offset that turns a city clock time back into a Date. */
function cityDay(now: number): { y: number; mo: number; d: number; offsetMs: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CITY_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  const wall = Date.UTC(y, mo - 1, d, get('hour'), get('minute'));
  return { y, mo, d, offsetMs: wall - Math.floor(now / 60_000) * 60_000 };
}

/** The next midnight in the city: every closure opens again by then. */
function nextMidnight(now: number): Date {
  const c = cityDay(now);
  return new Date(Date.UTC(c.y, c.mo - 1, c.d + 1) - c.offsetMs);
}

/** "HH:MM" today in the city → a Date; null when it isn't a valid time. */
function todayAt(now: number, hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const c = cityDay(now);
  return new Date(Date.UTC(c.y, c.mo - 1, c.d, Number(m[1]), Number(m[2])) - c.offsetMs);
}

/** A first suggestion for «لحد ساعة معيّنة»: two hours from now on the hour, before midnight. */
function suggestedHour(now: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CITY_TZ, hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) + 2;
  return h >= 24 ? '23:30' : `${String(h).padStart(2, '0')}:00`;
}

interface Draft {
  nameAr: string;
  reason: ClosureReason;
  untilMode: 'midnight' | 'hour';
  hour: string;
}
const NEW_DRAFT: Draft = { nameAr: '', reason: 'works', untilMode: 'midnight', hour: '' };

/**
 * Console › شوارع مسدودة (N20, Ali 2026-10-11, design "A: two taps"): field ops close a street for
 * today. «سدّ شارع», tap where the closed stretch starts and where it ends, the line follows the street,
 * and every route goes around it until midnight (or the hour picked). No price or fee changes.
 */
export function ClosuresPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const signedIn = useSignedIn();
  const theme = useTheme();
  const { roles } = useMyRoles();
  const canEdit = hasAny(roles, CLOSURE_EDIT_ROLES);
  const now = useNow(30_000);

  const list = useQuery(trpc.ops.closures.list.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, retry: queryRetry, refetchInterval: LIST_REFRESH_MS }));
  const closures = useMemo(() => {
    const rows = [...(list.data ?? [])];
    // Couriers' reports waiting for ops on top, then closed ones, newest first inside each group.
    return rows.sort((a, b) => Number(isWaiting(b)) - Number(isWaiting(a)) || Number(b.active) - Number(a.active) || b.startsAt.getTime() - a.startsAt.getTime());
  }, [list.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (closures.find((c) => c.id === selectedId) ?? null) : null;

  const [marking, setMarking] = useState(false);
  const [from, setFrom] = useState<LatLng | null>(null);
  const [to, setTo] = useState<LatLng | null>(null);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);

  const snap = useQuery(
    trpc.ops.closures.snap.queryOptions(
      { cityId: CITY_ID, from: from ?? ORIGIN, to: to ?? ORIGIN },
      { enabled: signedIn && canEdit && marking && from !== null && to !== null, retry: queryRetry, staleTime: Infinity },
    ),
  );
  const preview = marking && from && to && snap.data ? snap.data.path : null;

  const resetMarking = useCallback(() => {
    setMarking(false);
    setFrom(null);
    setTo(null);
    setDraft(NEW_DRAFT);
  }, []);

  const refresh = () => void qc.invalidateQueries({ queryKey: trpc.ops.closures.list.queryKey() });
  const close = useMutation(
    trpc.ops.closures.close.mutationOptions({
      onSuccess: (c) => {
        refresh();
        resetMarking();
        setSelectedId(c.id);
        toast({ title: t('console.closures_closed_toast', { name: nameOf(c) }), tone: 'ok' });
      },
    }),
  );
  const open = useMutation(
    trpc.ops.closures.open.mutationOptions({
      onSuccess: (c) => {
        refresh();
        toast({ title: t('console.closures_opened_toast', { name: nameOf(c) }), tone: 'ok' });
      },
      onError: (e) => toast({ title: errorText(e), tone: 'bad' }),
    }),
  );
  const confirmReport = useMutation(
    trpc.ops.closures.confirm.mutationOptions({
      onSuccess: () => {
        refresh();
        toast({ title: t('console.closures_confirmed_toast'), tone: 'ok' });
      },
      onError: (e) => toast({ title: errorText(e), tone: 'bad' }),
    }),
  );

  const startMarking = useCallback(() => {
    setSelectedId(null);
    close.reset();
    setFrom(null);
    setTo(null);
    setDraft(NEW_DRAFT);
    setMarking(true);
  }, [close]);

  const onTap = useCallback(
    (at: LatLng) => {
      if (!from || to) {
        // First tap, or a third one: start over from here.
        setFrom(at);
        setTo(null);
        close.reset();
        return;
      }
      setTo(at);
    },
    [from, to, close],
  );

  const pick = useCallback(
    (id: string) => {
      if (marking) return;
      setSelectedId(id);
    },
    [marking],
  );

  // Esc leaves mark mode or closes the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (marking) resetMarking();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [marking, resetMarking]);

  const lengthM = snap.data?.lengthM ?? 0;
  const lengthProblem = !snap.data
    ? null
    : lengthM < CLOSURE_LIMITS.minLengthM
      ? t('console.closures_too_short', { m: lengthM, min: CLOSURE_LIMITS.minLengthM })
      : lengthM > CLOSURE_LIMITS.maxLengthM
        ? t('console.closures_too_long', { m: lengthM.toLocaleString('en-US'), max: CLOSURE_LIMITS.maxLengthM.toLocaleString('en-US') })
        : null;
  const until = draft.untilMode === 'hour' ? todayAt(now, draft.hour) : null;
  const untilBad = draft.untilMode === 'hour' && (!until || until.getTime() - now < MIN_OPEN_MS || until.getTime() > nextMidnight(now).getTime());

  const confirm = () => {
    if (!snap.data || lengthProblem || untilBad) return;
    close.mutate({
      cityId: CITY_ID,
      path: snap.data.path,
      reason: draft.reason,
      nameAr: draft.nameAr.trim() ? draft.nameAr.trim() : null,
      ...(draft.untilMode === 'hour' && until ? { until } : {}),
    });
  };

  const openStreet = (c: ClosureView) => {
    if (!window.confirm(t('console.closures_confirm_open', { name: nameOf(c) }))) return;
    open.mutate({ id: c.id });
  };

  if (!signedIn) {
    return (
      <>
        <PageHeader title={t('console.closures_title')} subtitle={t('console.closures_subtitle')} />
        <NeedLogin />
      </>
    );
  }

  // Only what routes go around counts as closed; a report waiting for ops does not yet.
  const activeCount = closures.filter((c) => c.active && c.confirmed).length;
  const formOpen = marking && from !== null && to !== null;

  let sheet: ReactNode = null;
  if (formOpen) {
    sheet = (
      <Drawer open title={t('console.closures_form_title')} onClose={resetMarking}>
        <CloseForm
          draft={draft}
          setDraft={setDraft}
          snapping={snap.isPending}
          snapError={snap.error ? <SnapFailed onRetry={() => void snap.refetch()} /> : null}
          lengthM={snap.data ? lengthM : null}
          estimated={snap.data?.basis === 'estimated'}
          lengthProblem={lengthProblem}
          untilBad={untilBad}
          saving={close.isPending}
          saveError={close.error ? errorText(close.error) : null}
          onConfirm={confirm}
          onCancel={resetMarking}
        />
      </Drawer>
    );
  } else if (selected && !marking) {
    sheet = (
      <Drawer open title={nameOf(selected)} onClose={() => setSelectedId(null)}>
        <ClosureDetail
          closure={selected}
          canEdit={canEdit}
          opening={open.isPending}
          onOpen={() => openStreet(selected)}
          confirming={confirmReport.isPending}
          onConfirm={() => confirmReport.mutate({ id: selected.id })}
        />
      </Drawer>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('console.closures_title')} subtitle={t('console.closures_subtitle')}>
        {list.data ? (
          <Chip tone={activeCount > 0 ? 'bad' : 'neutral'} dot>
            {t('console.closures_count', { n: activeCount })}
          </Chip>
        ) : null}
        {canEdit ? (
          marking ? (
            <Button variant="secondary" size="lg" onClick={resetMarking}>
              {t('console.closures_mark_cancel')}
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={startMarking} needsNet>
              {t('console.closures_close_street')}
            </Button>
          )
        ) : (
          <Chip>{t('console.closures_read_only')}</Chip>
        )}
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="relative h-[62vh] min-h-[360px] overflow-hidden rounded-lg border border-line bg-surface shadow-card lg:h-[calc(100vh-15rem)] lg:min-h-[480px]">
          <ClosuresMapCanvas theme={theme} closures={closures} selectedId={selectedId} marking={marking} from={from} to={to} preview={preview} onPick={pick} onTap={onTap} />
          {marking && !formOpen ? (
            <div role="status" className="absolute inset-x-3 top-3 z-10 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border border-line bg-raised px-4 py-2.5 shadow-overlay">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden className="num inline-flex h-6 w-6 items-center justify-center rounded-pill bg-accent text-xs font-bold text-on-accent">
                  {from ? 2 : 1}
                </span>
                {t(from ? 'console.closures_mark_end' : 'console.closures_mark_start')}
              </span>
              <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={resetMarking}>
                {t('console.closures_mark_cancel')}
              </Button>
            </div>
          ) : null}
          {sheet}
        </section>
        <aside aria-label={t('console.closures_list_title')}>
          <Card title={t('console.closures_list_title')} flush>
            <ClosureList
              closures={closures}
              loading={list.isPending}
              error={list.error ? <div className="p-4"><QueryError error={list.error} onRetry={() => void list.refetch()} /></div> : null}
              canEdit={canEdit}
              selectedId={selectedId}
              onPick={pick}
              onStart={canEdit && !marking ? startMarking : undefined}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}

function SnapFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-bad-tint px-3 py-2 text-sm text-bad">
      <span>{t('console.closures_snap_failed')}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        {t('console.closures_retry')}
      </Button>
    </div>
  );
}

function untilText(c: ClosureView): string {
  const ends = c.endsAt;
  const cityMidnight = nextMidnight(c.startsAt.getTime());
  return ends.getTime() >= cityMidnight.getTime() ? t('console.closures_until_midnight') : t('console.closures_until_time', { time: formatClock(ends) });
}

export interface ClosureListProps {
  closures: readonly ClosureView[];
  loading: boolean;
  error: ReactNode;
  canEdit: boolean;
  selectedId: string | null;
  onPick: (id: string) => void;
  onStart?: () => void;
}

/** Today's closures, closed ones first: name, reason, until-time and state. */
export function ClosureList(p: ClosureListProps) {
  if (p.error) return <>{p.error}</>;
  if (p.loading) {
    return (
      <div className="space-y-2 p-4" aria-busy="true">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }
  if (p.closures.length === 0) {
    return (
      <div className="p-4">
        <EmptyState title={t('console.closures_empty')} hint={t(p.canEdit ? 'console.closures_empty_hint' : 'console.closures_empty_hint_read')}>
          {p.onStart ? (
            <Button variant="primary" onClick={p.onStart} needsNet>
              {t('console.closures_close_street')}
            </Button>
          ) : null}
        </EmptyState>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {p.closures.map((c) => {
        const state = stateOf(c);
        const waiting = isWaiting(c);
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => p.onPick(c.id)}
              aria-current={c.id === p.selectedId ? 'true' : undefined}
              className={cx(
                'flex min-h-[56px] w-full items-center justify-between gap-3 px-5 py-2.5 text-start',
                c.id === p.selectedId ? 'bg-accent-tint' : waiting ? 'bg-warn-tint hover:bg-warn-tint/70' : 'hover:bg-surface-2',
                state !== 'active' && 'text-muted',
              )}
            >
              <span className="min-w-0">
                <span className={cx('block truncate text-sm font-semibold', state === 'active' && 'text-text')}>{nameOf(c)}</span>
                <span className="block truncate text-xs text-muted">
                  {reasonLabel(c.reason)} · {waiting ? null : <>{untilText(c)} · </>}
                  <span className="num">{metres(c.lengthM)}</span>
                </span>
              </span>
              <StateChip closure={c} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** «مسدود» / «انفتح» / «خلص», or «بلّغ عنه دليفري» in the warning tone while a report waits for ops. */
function StateChip({ closure: c }: { closure: ClosureView }) {
  if (isWaiting(c)) {
    return (
      <Chip size="sm" tone="warn" dot>
        {t('console.closures_from_courier')}
      </Chip>
    );
  }
  const state = stateOf(c);
  return (
    <Chip size="sm" tone={STATE_TONE[state]} dot={state === 'active'}>
      {t(`console.closures_state_${state}`)}
    </Chip>
  );
}

interface ClosureDetailProps {
  closure: ClosureView;
  canEdit: boolean;
  opening: boolean;
  onOpen: () => void;
  confirming: boolean;
  onConfirm: () => void;
}

function ClosureDetail({ closure: c, canEdit, opening, onOpen, confirming, onConfirm }: ClosureDetailProps) {
  const waiting = isWaiting(c);
  const byCourier = c.source === 'courier';
  return (
    <div className="space-y-4">
      {waiting ? (
        <div className="space-y-3">
          <p role="status" className="rounded-md bg-warn-tint px-3 py-2 text-sm font-medium text-warn">
            {t('console.closures_waiting')}
          </p>
          {/* The decision comes first: on a phone the sheet is short and the rows can scroll under it. */}
          {canEdit ? (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Button variant="primary" size="lg" className="w-full" onClick={onConfirm} loading={confirming} disabled={opening} needsNet>
                {t('console.closures_confirm_report')}
              </Button>
              <Button variant="danger-soft" size="lg" className="w-full" onClick={onOpen} loading={opening} disabled={confirming} needsNet>
                {t('console.closures_open_street')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <dl>
        <Row k={t('console.closures_state')} v={<StateChip closure={c} />} />
        <Row k={t('console.closures_reason')} v={reasonLabel(c.reason)} />
        <Row k={t('console.closures_length')} v={<span className="num">{metres(c.lengthM)}</span>} />
        <Row k={t('console.closures_until')} v={untilText(c)} />
        <Row k={t('console.closures_closed_at')} v={<span className="num">{formatClock(c.startsAt)}</span>} />
        <Row
          k={t('console.closures_closed_by')}
          v={
            byCourier ? (
              <span>
                {c.closedByName ?? t('console.closures_someone')} <span className="text-muted">· {t('console.closures_from_courier')}</span>
              </span>
            ) : (
              (c.closedByName ?? t('console.closures_someone'))
            )
          }
        />
        {c.openedAt ? <Row k={t('console.closures_opened_by')} v={`${c.openedByName ?? t('console.closures_someone')} · ${formatClock(c.openedAt)}`} /> : null}
      </dl>
      {byCourier && c.confirmed && c.confirmedByName ? <p className="text-sm text-muted">{t('console.closures_confirmed_by', { name: c.confirmedByName })}</p> : null}
      {canEdit && c.active && !waiting ? (
        <Button variant="danger-soft" size="lg" className="w-full" onClick={onOpen} loading={opening} needsNet>
          {t('console.closures_open_street')}
        </Button>
      ) : null}
    </div>
  );
}

export interface CloseFormProps {
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  snapping: boolean;
  snapError: ReactNode;
  lengthM: number | null;
  estimated: boolean;
  lengthProblem: string | null;
  untilBad: boolean;
  saving: boolean;
  saveError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The sheet after the second tap: name, reason, until, length, then «سدّ الشارع». */
export function CloseForm(p: CloseFormProps) {
  const now = Date.now();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        p.onConfirm();
      }}
    >
      {p.snapError}
      <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2 text-sm">
        <span className="text-muted">{t('console.closures_length')}</span>
        {p.snapping ? <span className="text-muted" role="status">{t('console.closures_snapping')}</span> : p.lengthM !== null ? <span className="num font-semibold">{metres(p.lengthM)}</span> : <span>—</span>}
      </div>
      {p.estimated ? <p className="text-xs text-muted">{t('console.closures_estimated')}</p> : null}
      {p.lengthProblem ? (
        <p role="alert" className="text-sm text-bad">
          {p.lengthProblem}
        </p>
      ) : null}
      <Field label={t('console.closures_name_label')}>
        <Input
          value={p.draft.nameAr}
          maxLength={CLOSURE_LIMITS.nameMax}
          placeholder={t('console.closures_name_placeholder')}
          onChange={(e) => {
            const nameAr = e.target.value;
            p.setDraft((d) => ({ ...d, nameAr }));
          }}
        />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t('console.closures_reason_label')}</legend>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <Button key={r} type="button" variant="secondary" className="min-h-[44px]" aria-pressed={p.draft.reason === r} onClick={() => p.setDraft((d) => ({ ...d, reason: r }))}>
              {reasonLabel(r)}
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t('console.closures_until_label')}</legend>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="min-h-[44px]" aria-pressed={p.draft.untilMode === 'midnight'} onClick={() => p.setDraft((d) => ({ ...d, untilMode: 'midnight' }))}>
            {t('console.closures_until_midnight')}
          </Button>
          <Button type="button" variant="secondary" className="min-h-[44px]" aria-pressed={p.draft.untilMode === 'hour'} onClick={() => p.setDraft((d) => ({ ...d, untilMode: 'hour', hour: d.hour || suggestedHour(now) }))}>
            {t('console.closures_until_hour')}
          </Button>
        </div>
        {p.draft.untilMode === 'hour' ? (
          <div className="mt-3">
            <Field label={t('console.closures_until_hour_label')}>
              <Input
                type="time"
                dir="ltr"
                className="num max-w-[10rem] min-h-[44px]"
                value={p.draft.hour}
                onChange={(e) => {
                  const hour = e.target.value;
                  p.setDraft((d) => ({ ...d, hour }));
                }}
              />
            </Field>
            {p.untilBad ? (
              <p role="alert" className="mt-1.5 text-sm text-bad">
                {t('console.closures_until_bad')}
              </p>
            ) : null}
          </div>
        ) : null}
      </fieldset>
      {p.saveError ? (
        <p role="alert" className="text-sm text-bad">
          {p.saveError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        <Button type="button" variant="ghost" size="lg" onClick={p.onCancel}>
          {t('console.closures_mark_cancel')}
        </Button>
        <Button type="submit" variant="primary" size="lg" loading={p.saving} disabled={p.lengthM === null || p.lengthProblem !== null || p.untilBad} needsNet>
          {t('console.closures_confirm')}
        </Button>
      </div>
    </form>
  );
}
