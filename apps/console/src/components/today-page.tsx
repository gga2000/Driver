'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INBOX_CLOSE_AT_SOURCE,
  INBOX_KINDS,
  INBOX_RULES,
  INBOX_WORK_ROLES,
  type InboxCounts,
  type InboxKind,
  type InboxRow,
  type InboxStaffOutcome,
  type InboxView,
} from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useId, useMemo, useState } from 'react';
import { formatClock } from '@/lib/format';
import { useHotkeys } from '@/lib/hotkeys';
import { detailText, holdRows, KIND_KEY, noteRequired, OUTCOME_KEY, OUTCOMES, rowHref, rowTone } from '@/lib/inbox';
import { CITY_ID, queryRetry, useRightNow } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { countText } from '@/lib/plural';
import { errorText } from '@/lib/network';
import { ageText } from '@/lib/safety';
import { useRowKeys } from '@/lib/row-keys';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { StuckRowActions } from './stuck/row-actions';
import {
  Button,
  buttonCls,
  Chip,
  cx,
  Dialog,
  EmptyState,
  Field,
  IconAlert,
  IconCheckCircle,
  IconClock,
  LiveBadge,
  NeedLogin,
  PageHeader,
  Popover,
  QueryError,
  Segmented,
  SkeletonBlock,
  Stat,
  StatStrip,
  Tabs,
  Textarea,
  useNow,
  useToast,
} from './ui';

/** The list and its counts refresh this often (the plan's freshness bar: Today within 3 s). */
const TODAY_POLL_MS = 3_000;
const VIEWS: readonly InboxView[] = ['open', 'mine', 'snoozed', 'done'];
const VIEW_KEY = {
  open: 'console.today.view_open',
  mine: 'console.today.view_mine',
  snoozed: 'console.today.view_snoozed',
  done: 'console.today.view_done',
} as const;

/**
 * Console › اليوم (E1, CON-12): the home page. Every problem the server sees (an SOS, a trip nobody
 * took, a shop that went quiet, a late order…) is one row with an owner, most urgent first. Take it,
 * hand it on, snooze it a few minutes or close it with what happened; rows close by themselves when
 * the problem ends. Above the list: the city's pulse and who holds SOS tonight.
 */
export function TodayPage() {
  const signedIn = useSignedIn();
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title={t('console.today.title')} subtitle={t('console.today.subtitle')} />
      {!signedIn ? <NeedLogin /> : <Today />}
    </div>
  );
}

function Today() {
  const trpc = useTRPC();
  const { roles, loaded } = useMyRoles();
  const canWork = loaded && hasAny(roles, INBOX_WORK_ROLES);
  const [view, setView] = useState<InboxView>('open');
  const [kind, setKind] = useState<InboxKind | null>(null);
  const counts = useQuery(
    trpc.inbox.counts.queryOptions(
      { cityId: CITY_ID },
      { retry: queryRetry, refetchInterval: TODAY_POLL_MS },
    ),
  );
  const list = useQuery(
    trpc.inbox.list.queryOptions(
      { cityId: CITY_ID, view, ...(kind ? { kind } : {}) },
      { retry: queryRetry, refetchInterval: TODAY_POLL_MS, placeholderData: (prev) => prev },
    ),
  );
  const c = counts.data;
  const viewCount: Record<InboxView, number | undefined> = {
    open: c?.open,
    mine: c?.mine,
    snoozed: c?.snoozed,
    done: c?.doneToday,
  };
  return (
    <div className="space-y-5">
      <Pulse counts={c} />
      <NobodyOnCall />
      <section
        className="rounded-lg border border-line bg-surface shadow-card"
        data-testid="today-list"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
          <Tabs<InboxView>
            label={t('console.today.views')}
            value={view}
            onChange={(v) => setView(v)}
            options={VIEWS.map((v) => ({
              value: v,
              label: t(VIEW_KEY[v]),
              ...(viewCount[v] !== undefined ? { count: viewCount[v] } : {}),
            }))}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {c?.oldestOpenAt && view === 'open' ? <OldestLine at={c.oldestOpenAt} /> : null}
            <LiveBadge
              seconds={TODAY_POLL_MS / 1000}
              updatedAt={list.dataUpdatedAt || undefined}
              fetching={list.isFetching}
              error={list.isError}
            />
          </div>
        </div>
        {view === 'open' && c ? <KindFilter counts={c} value={kind} onChange={setKind} /> : null}
        {list.isError ? (
          <div className="p-5">
            <QueryError error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : list.isPending ? (
          <div className="space-y-2 p-5">
            <SkeletonBlock className="h-16" />
            <SkeletonBlock className="h-16" />
            <SkeletonBlock className="h-16" />
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState
            icon={<IconCheckCircle size={28} />}
            title={t(
              view === 'open'
                ? 'console.today.empty_open'
                : view === 'mine'
                  ? 'console.today.empty_mine'
                  : view === 'snoozed'
                    ? 'console.today.empty_snoozed'
                    : 'console.today.empty_done',
            )}
            hint={view === 'open' ? t('console.today.empty_open_hint') : undefined}
            className="py-12"
          />
        ) : (
          <Rows rows={list.data} listKey={`${view}:${kind ?? ''}`} canWork={canWork} />
        )}
      </section>
      {loaded && !canWork ? (
        <p className="text-dense text-muted">{t('console.today.read_only')}</p>
      ) : null}
    </div>
  );
}

// ───────────────────────── the pulse ─────────────────────────

function Pulse({ counts }: { counts: InboxCounts | undefined }) {
  const now = useRightNow();
  const r = now.data;
  const dash = '—';
  return (
    <StatStrip>
      <Stat
        label={t('console.today.stat_open')}
        value={<span className="num">{counts?.open ?? dash}</span>}
        tone={
          counts && (counts.byKind.sos ?? 0) > 0
            ? 'bad'
            : counts && counts.open > 0
              ? 'warn'
              : 'default'
        }
        hint={counts ? t('console.today.stat_unassigned', { n: counts.unassigned }) : undefined}
      />
      <Stat
        label={t('console.today.stat_late')}
        value={<span className="num">{r?.lateOrders ?? dash}</span>}
        tone={r && r.lateOrders > 0 ? 'warn' : 'default'}
      />
      <Stat
        label={t('console.today.stat_active')}
        value={<span className="num">{r?.activeOrders ?? dash}</span>}
        hint={r ? t('console.today.stat_last_hour', { n: r.ordersLastHour }) : undefined}
      />
      <Stat
        label={t('console.today.stat_drivers')}
        value={<span className="num">{r?.activeDrivers ?? dash}</span>}
      />
      <Stat
        label={t('console.today.stat_done')}
        value={<span className="num">{counts?.doneToday ?? dash}</span>}
        tone={counts && counts.doneToday > 0 ? 'ok' : 'default'}
      />
    </StatStrip>
  );
}

/** Red line when nobody holds SOS: an unanswered SOS then goes to the admins (build plan: "SOS: Ali only"). */
function NobodyOnCall() {
  const trpc = useTRPC();
  const now = useQuery(
    trpc.onCall.now.queryOptions(
      { cityId: CITY_ID },
      { retry: queryRetry, refetchInterval: 60_000 },
    ),
  );
  const sos = now.data?.find((d) => d.desk === 'sos');
  if (!sos?.fallbackToAdmins) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-bad/40 bg-bad-tint px-4 py-3 text-sm text-bad"
      data-testid="today-no-on-call"
    >
      <IconAlert size={18} className="shrink-0" />
      <span className="min-w-0 flex-1 font-medium">{t('console.today.no_on_call')}</span>
      <Link href="/on-call" className={buttonCls('secondary', 'sm')}>
        {t('console.today.open_on_call')}
      </Link>
    </div>
  );
}

function OldestLine({ at }: { at: Date }) {
  const now = useNow(15_000);
  return (
    <p className="num flex items-center gap-1.5 text-dense text-muted">
      <IconClock size={15} />
      {t('console.today.oldest', { ago: ageText(now - at.getTime()) })}
    </p>
  );
}

function KindFilter({
  counts,
  value,
  onChange,
}: {
  counts: InboxCounts;
  value: InboxKind | null;
  onChange: (k: InboxKind | null) => void;
}) {
  const kinds = INBOX_KINDS.filter((k) => (counts.byKind[k] ?? 0) > 0 || value === k);
  if (kinds.length < 2 && value === null) return null;
  const chip = (active: boolean) =>
    cx(
      'inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-xs font-medium transition-colors',
      active
        ? 'border-accent bg-accent-wash text-text'
        : 'border-line bg-surface text-muted hover:text-text',
    );
  return (
    <div
      className="flex flex-wrap gap-2 border-b border-line px-5 py-3"
      role="group"
      aria-label={t('console.today.filter')}
    >
      <button
        type="button"
        className={chip(value === null)}
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        {t('console.today.filter_all')}
      </button>
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          className={chip(value === k)}
          aria-pressed={value === k}
          onClick={() => onChange(value === k ? null : k)}
        >
          {t(KIND_KEY[k])}
          <span className="num text-faint">{counts.byKind[k] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── the rows ─────────────────────────

/**
 * The list with its keys (J/K move, Enter opens, A takes, S snoozes, E closes) and, while someone
 * works it, new rows held behind «N جديد · اعرضها» so nothing jumps under their hand.
 */
function Rows({ rows, listKey, canWork }: { rows: InboxRow[]; listKey: string; canWork: boolean }) {
  const router = useRouter();
  const [hovering, setHovering] = useState(false);
  const [onScreen, setOnScreen] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const known = onScreen?.key === listKey ? onScreen.ids : null;
  const [active, setActive] = useRowKeys(rows, (r) => r.id, (r) => router.push(rowHref(r)), !busy);
  const holding = hovering || active !== null || busy;
  const { shown, held } = useMemo(() => holdRows(rows, known, holding), [rows, known, holding]);
  // What is on screen while nobody holds the list becomes the list to hold.
  useEffect(() => {
    if (!holding || known === null) setOnScreen({ key: listKey, ids: new Set(rows.map((r) => r.id)) });
  }, [holding, known, listKey, rows]);
  // The highlight follows the visible rows only.
  useEffect(() => {
    if (active !== null && !shown.some((r) => r.id === active)) setActive(null);
  }, [active, shown, setActive]);
  const showAll = () => setOnScreen({ key: listKey, ids: new Set(rows.map((r) => r.id)) });
  return (
    <div
      className="relative"
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      {held > 0 ? (
        // Floats over the list so showing it doesn't push the rows down either.
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-5">
          <button
            type="button"
            onClick={showAll}
            className="num pointer-events-auto inline-flex min-h-11 animate-pop-in items-center gap-2 rounded-pill border border-accent/50 bg-raised px-4 text-sm font-semibold text-text shadow-pop hover:bg-accent-wash"
            data-testid="today-held"
          >
            {countText('console.today.new_rows', held)}
            <span className="text-muted">·</span>
            <span className="underline underline-offset-4">{t('console.today.show_new')}</span>
          </button>
        </div>
      ) : null}
      <ul className="divide-y divide-line/70">
        {shown.map((row) => (
          <InboxLine
            key={row.id}
            row={row}
            canWork={canWork}
            active={row.id === active}
            onBusy={setBusy}
          />
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────── one row ─────────────────────────

function InboxLine({
  row,
  canWork,
  active,
  onBusy,
}: {
  row: InboxRow;
  canWork: boolean;
  active: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow(15_000);
  const [snoozing, setSnoozing] = useState(false);
  const [closing, setClosing] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.inbox.list.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.inbox.counts.queryKey() });
  };
  const failed = (e: Parameters<typeof errorText>[0]) =>
    toast({ title: t('console.today.failed', { message: errorText(e) }), tone: 'bad' });
  const take = useMutation(
    trpc.inbox.take.mutationOptions({ onSuccess: refresh, onError: failed }),
  );
  const snooze = useMutation(
    trpc.inbox.snooze.mutationOptions({
      onSuccess: (_r, v) => {
        setSnoozing(false);
        toast({ title: t('console.today.snoozed', { minutes: v.minutes }) });
        refresh();
      },
      onError: failed,
    }),
  );
  const done = row.state === 'done';
  const closeHere = !INBOX_CLOSE_AT_SOURCE.includes(row.kind);
  const workable = canWork && !done && closeHere;
  // While the snooze menu or the close dialog is open, the list's own keys rest.
  useEffect(() => {
    if (!snoozing && !closing) return;
    onBusy(true);
    return () => onBusy(false);
  }, [snoozing, closing, onBusy]);
  useHotkeys(
    {
      a: () => {
        if (!row.mine && !take.isPending) take.mutate({ id: row.id });
      },
      s: () => setSnoozing(true),
      e: () => setClosing(true),
    },
    { enabled: active && workable && !snoozing && !closing },
  );
  useHotkeys(
    Object.fromEntries(
      INBOX_RULES.snoozeMinutes.map((m, i) => [
        String(i + 1),
        () => {
          if (!snooze.isPending) snooze.mutate({ id: row.id, minutes: m });
        },
      ]),
    ),
    { enabled: snoozing },
  );
  return (
    <li
      className={cx(
        'relative flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3.5',
        row.kind === 'sos' && !done ? 'bg-bad-tint/40' : '',
        active ? 'bg-accent-wash/50 before:absolute before:inset-y-0 before:start-0 before:w-1 before:bg-accent' : '',
      )}
      data-testid="today-row"
      data-kind={row.kind}
      data-active={active || undefined}
      aria-current={active || undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={done ? 'done' : rowTone(row)} dot={!done}>
            {t(KIND_KEY[row.kind])}
          </Chip>
          <span className="num text-dense text-muted">
            {done && row.doneAt ? formatClock(row.doneAt) : ageText(now - row.openedAt.getTime())}
          </span>
          {row.times > 1 ? (
            <span className="num text-dense text-muted">
              {t('console.today.times', { n: row.times })}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-text">{detailText(row) || t(KIND_KEY[row.kind])}</p>
        <p className="mt-0.5 text-dense text-muted">
          {done
            ? row.outcome === 'auto'
              ? t('console.today.closed_auto')
              : t('console.today.closed_by', {
                  name: row.doneByName ?? t('console.oncall_no_name'),
                  outcome: t(OUTCOME_KEY[row.outcome ?? 'fixed']),
                })
            : row.assigneeId
              ? row.mine
                ? t('console.today.held_by_you')
                : t('console.today.held_by', {
                    name: row.assigneeName ?? t('console.oncall_no_name'),
                  })
              : t('console.today.held_by_nobody')}
          {row.state === 'snoozed' && row.snoozedUntil
            ? ` · ${t('console.today.snoozed_until', { time: formatClock(row.snoozedUntil) })}`
            : ''}
        </p>
        {row.note ? (
          <p className="mt-1 rounded-md bg-surface-2 px-3 py-1.5 text-dense text-text">
            {row.note}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link
          href={rowHref(row)}
          className={buttonCls(closeHere || done ? 'ghost' : 'primary', 'sm')}
        >
          {t(closeHere || done ? 'console.today.open' : 'console.today.open_at_source')}
        </Link>
        {workable ? (
          <>
            {!row.mine ? (
              <Button
                size="sm"
                variant={row.assigneeId ? 'secondary' : 'primary'}
                loading={take.isPending}
                onClick={() => take.mutate({ id: row.id })}
                needsNet
              >
                {t('console.today.take')}
              </Button>
            ) : null}
            <span className="relative">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSnoozing((s) => !s)}
                aria-expanded={snoozing}
                needsNet
              >
                {t('console.today.snooze')}
              </Button>
              <Popover open={snoozing} onClose={() => setSnoozing(false)} align="end">
                <div className="flex gap-1.5 p-2">
                  {INBOX_RULES.snoozeMinutes.map((m, i) => (
                    <Button
                      key={m}
                      size="sm"
                      variant="ghost"
                      loading={snooze.isPending && snooze.variables?.minutes === m}
                      onClick={() => snooze.mutate({ id: row.id, minutes: m })}
                      aria-keyshortcuts={String(i + 1)}
                    >
                      <span className="num">{t('console.today.snooze_min', { minutes: m })}</span>
                    </Button>
                  ))}
                </div>
              </Popover>
            </span>
            <Button size="sm" variant="secondary" onClick={() => setClosing(true)} needsNet>
              {t('console.today.close')}
            </Button>
          </>
        ) : null}
      </div>
      {row.kind === 'stuck' && row.subjectKind === 'order' && row.mine && !done ? (
        <StuckRowActions orderId={row.subjectId} />
      ) : null}
      {closing ? (
        <CloseDialog row={row} onClose={() => setClosing(false)} onDone={refresh} />
      ) : null}
    </li>
  );
}

function CloseDialog({
  row,
  onClose,
  onDone,
}: {
  row: InboxRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const toast = useToast();
  const noteId = useId();
  const [outcome, setOutcome] = useState<InboxStaffOutcome>('fixed');
  const [note, setNote] = useState(row.note ?? '');
  const needsNote = noteRequired(row);
  const close = useMutation(
    trpc.inbox.done.mutationOptions({
      onSuccess: () => {
        toast({ title: t('console.today.closed_toast') });
        onClose();
        onDone();
      },
      onError: (e) =>
        toast({ title: t('console.today.failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('console.today.close_title')}
      description={`${t(KIND_KEY[row.kind])} · ${detailText(row)}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          close.mutate({
            id: row.id,
            outcome,
            ...(note.trim() && note.trim() !== row.note ? { note: note.trim() } : {}),
          });
        }}
      >
        <Field label={t('console.today.outcome')}>
          <Segmented<InboxStaffOutcome>
            label={t('console.today.outcome')}
            value={outcome}
            onChange={setOutcome}
            options={OUTCOMES.map((o) => ({ value: o, label: t(OUTCOME_KEY[o]) }))}
          />
        </Field>
        <Field
          label={t('console.today.note')}
          htmlFor={noteId}
          hint={t(needsNote ? 'console.today.note_hint_low_rating' : 'console.today.note_hint')}
        >
          <Textarea
            id={noteId}
            rows={3}
            maxLength={INBOX_RULES.noteMax}
            value={note}
            required={needsNote}
            aria-required={needsNote || undefined}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('console.today.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={close.isPending}
            disabled={needsNote && !note.trim()}
            needsNet
          >
            {t('console.today.close_confirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
