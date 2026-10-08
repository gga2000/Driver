'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orderTicketNumber, type LadderStep, type SafetyCallTarget, type SafetyIncidentCase, type SafetyIncidentSummary, type SafetyOutcome, type SafetyPerson } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock, formatDayClock, safeDecode } from '@/lib/format';
import { stepIndex, useHotkeys } from '@/lib/hotkeys';
import { queryRetry } from '@/lib/live';
import { ageText, categoryText, contactText, contactTone, coordsText, entryText, entryTime, mapsUrl, personName, roleText, stateText, stateTone, trailPath } from '@/lib/safety';
import { SAFETY_POLL_MS, useSafetyAlerts } from '@/lib/safety-live';
import { withBdi } from './bdi';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import {
  Avatar,
  Button,
  buttonCls,
  Chip,
  cx,
  Dialog,
  EmptyState,
  Field,
  IconAlert,
  IconCheck,
  IconCopy,
  IconExternal,
  IconPhone,
  IconPin,
  IconSiren,
  LiveBadge,
  NeedLogin,
  QueryError,
  Segmented,
  Skeleton,
  Textarea,
  Timeline,
  useNow,
  useToast,
} from '../ui';

/**
 * The emergencies desk (scoring & safety §3), in the support desk's shape: the alerts on the start
 * side (open first), the incident on the other — who pressed and their role, the trip, the last
 * position with its age and accuracy (a small trail sketch, a maps link; no map component), the
 * emergency contact and whether the message arrived, masked calls to all three, acknowledge, notes,
 * resolve with an outcome and a note, and the timeline. Keys: J/K move, A takes it, E closes it.
 */
export function SafetyDesk() {
  const trpc = useTRPC();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const id = params?.id ? safeDecode(params.id) : null;
  const signedIn = useSignedIn();
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const alerts = useSafetyAlerts();
  const all = useQuery(trpc.safety.list.queryOptions({ scope: 'all', limit: 100 }, { enabled: signedIn && alerts.allowed && scope === 'all', refetchInterval: SAFETY_POLL_MS * 3, retry: queryRetry }));
  const rows = useMemo(() => (scope === 'open' ? alerts.rows : (all.data ?? [])), [scope, alerts.rows, all.data]);
  const source = scope === 'open' ? alerts.query : all;
  const kase = useQuery(trpc.safety.get.queryOptions({ id: id ?? '' }, { enabled: signedIn && Boolean(id), refetchInterval: SAFETY_POLL_MS, retry: queryRetry }));
  const [resolving, setResolving] = useState(false);
  const ack = useAck();

  // Open the oldest open alert when the desk opens on /safety (desktop).
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || id || !rows[0] || typeof window === 'undefined' || window.innerWidth < 1024) return;
    opened.current = true;
    router.replace(`/safety/${encodeURIComponent(rows[0].id)}`);
  }, [rows, id, router]);

  const select = (next: string) => router.push(`/safety/${encodeURIComponent(next)}`);
  const move = (d: 1 | -1) => {
    const next = rows[stepIndex(rows.findIndex((r) => r.id === id), rows.length, d)];
    if (next) select(next.id);
  };
  const live = kase.data && (kase.data.state === 'open' || kase.data.state === 'acknowledged');
  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      a: () => kase.data?.state === 'open' && ack.mutate({ id: kase.data.id }),
      e: () => live && setResolving(true),
    },
    { enabled: signedIn && !resolving },
  );

  if (!signedIn) {
    return (
      <div className="p-8">
        <NeedLogin />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
      <div className={id ? 'hidden min-h-0 md:block' : 'min-h-0'}>
        <section aria-label={t('console.safety.title')} className="flex h-full min-h-0 flex-col border-e border-line bg-surface">
          <div className="space-y-3 border-b border-line px-4 pb-3 pt-4">
            <div className="flex items-center justify-between gap-2">
              <h1 className="flex items-center gap-2 text-lg font-bold">
                <IconSiren size={20} className="text-bad" />
                {t('console.safety.title')}
              </h1>
              <LiveBadge seconds={SAFETY_POLL_MS / 1000} updatedAt={source.dataUpdatedAt} fetching={source.isFetching} error={Boolean(source.error)} compact />
            </div>
            <p className="text-dense text-muted">{t('console.safety.subtitle')}</p>
            <Segmented<'open' | 'all'>
              label={t('console.safety.title')}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'open', label: `${t('console.safety.list_open')} · ${alerts.rows.length}` },
                { value: 'all', label: t('console.safety.list_all') },
              ]}
            />
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            // A listbox must hold options: while loading, empty or failed it is a plain region.
            role={rows.length > 0 && !source.isPending ? 'listbox' : 'region'}
            aria-label={t('console.safety.title')}
          >
            {source.error && !source.data ? (
              <div className="p-4">
                <QueryError error={source.error} onRetry={() => void source.refetch()} />
              </div>
            ) : source.isPending ? (
              <div className="space-y-3 p-4">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6">
                <EmptyState bare icon={<IconCheck size={20} />} title={t('console.safety.empty')} hint={t('console.safety.empty_hint')} />
              </div>
            ) : (
              rows.map((r) => <AlertRow key={r.id} row={r} selected={r.id === id} onSelect={() => select(r.id)} />)
            )}
          </div>
        </section>
      </div>

      <div className={id ? 'min-h-0 min-w-0 overflow-y-auto bg-canvas' : 'hidden min-h-0 bg-canvas md:block'}>
        {!id ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState bare icon={<IconSiren size={20} />} title={t('console.safety.pick')} hint={t('console.safety.empty_hint')} />
          </div>
        ) : kase.error && !kase.data ? (
          <div className="p-6">
            <QueryError error={kase.error} onRetry={() => void kase.refetch()} />
          </div>
        ) : kase.data ? (
          <IncidentView data={kase.data} onResolve={() => setResolving(true)} />
        ) : (
          <div className="space-y-4 p-6">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        )}
      </div>
      {kase.data ? <ResolveDialog data={kase.data} open={resolving} onClose={() => setResolving(false)} /> : null}
    </div>
  );
}

function AlertRow({ row, selected, onSelect }: { row: SafetyIncidentSummary; selected: boolean; onSelect: () => void }) {
  const now = useNow(1000);
  const open = row.state === 'open';
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      data-testid={`sos-row-${row.id}`}
      className={cx('relative flex w-full items-start gap-3 border-b border-line/70 px-4 py-3 text-start transition-colors duration-fast', selected ? 'bg-accent-wash' : 'hover:bg-surface-2')}
    >
      {selected ? <span aria-hidden className="absolute inset-y-0 start-0 w-[3px] bg-accent" /> : null}
      <span aria-hidden className={cx('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-pill', open ? 'bg-bad-solid' : row.state === 'acknowledged' ? 'bg-warn-solid' : 'bg-line-strong')} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cx('truncate text-sm', open ? 'font-bold' : 'font-semibold')}>
            {personName(row.raiser)} <span className="font-normal text-muted">({roleText(row.raiser.role)})</span>
          </span>
          <span className={cx('num shrink-0 text-xs', open ? 'font-semibold text-bad' : 'text-muted')}>{ageText(now - row.raisedAt.getTime())}</span>
        </span>
        <span className="block truncate text-dense text-muted">{withBdi(row.subject.label)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {row.overdue ? (
            <Chip size="sm" tone="bad" dot>
              {t('console.safety.overdue', { ago: ageText(now - row.raisedAt.getTime()) })}
            </Chip>
          ) : (
            <Chip size="sm" tone={stateTone(row.state)} dot>
              {stateText(row.state)}
            </Chip>
          )}
        </span>
      </span>
    </button>
  );
}

function useAck() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation(
    trpc.safety.acknowledge.mutationOptions({
      onSuccess: (data) => {
        qc.setQueryData(trpc.safety.get.queryKey({ id: data.id }), data);
        void qc.invalidateQueries(trpc.safety.list.pathFilter());
        toast({ title: t('console.safety.ack_done'), tone: 'ok' });
      },
      onError: (e) => toast({ title: e.message, tone: 'bad' }),
    }),
  );
}

function IncidentView({ data, onResolve }: { data: SafetyIncidentCase; onResolve: () => void }) {
  const now = useNow(1000);
  const ack = useAck();
  const live = data.state === 'open' || data.state === 'acknowledged';
  const raiserName = personName(data.raiser);
  return (
    <article className="mx-auto max-w-5xl space-y-5 px-4 py-5 lg:px-8 lg:py-6" data-testid="sos-incident">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={data.raiser.displayName} id={data.raiser.personId} size="lg" />
          <div className="min-w-0">
            <h2 className="text-2xl font-bold">
              {raiserName} <span className="text-lg font-medium text-muted">({roleText(data.raiser.role)})</span>
            </h2>
            <p className="num mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Chip tone={stateTone(data.state)} dot>
                {stateText(data.state)}
              </Chip>
              <span>{t('console.safety.raised_at', { time: formatClock(data.raisedAt) })}</span>
              <span>· {ageText(now - data.raisedAt.getTime())}</span>
              {data.category ? <Chip tone="warn">{categoryText(data.category)}</Chip> : null}
            </p>
          </div>
        </div>
        {live ? (
          <div className="flex flex-wrap items-center gap-2">
            {data.state === 'open' ? (
              <Button variant="primary" size="lg" kbd="A" loading={ack.isPending} onClick={() => ack.mutate({ id: data.id })} data-testid="sos-ack">
                {t('console.safety.ack')}
              </Button>
            ) : null}
            <Button variant="danger-soft" size="lg" kbd="E" onClick={onResolve} data-testid="sos-resolve">
              {t('console.safety.resolve')}
            </Button>
          </div>
        ) : null}
      </header>

      {data.state === 'open' && data.overdue ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-bad/40 bg-bad-tint px-4 py-3 text-sm font-semibold text-bad">
          <IconAlert size={18} />
          {t('console.safety.overdue', { ago: ageText(now - data.raisedAt.getTime()) })}
          {data.escalatedAt ? ` · ${t('console.safety.outcome_escalated')}` : ''}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PositionCard data={data} now={now} />
        <section className="rounded-lg border border-line bg-surface p-5 shadow-card">
          <h3 className="mb-3 text-[15px] font-semibold">{t('console.safety.trip')}</h3>
          <p className="text-base font-semibold" data-testid="sos-subject">
            {withBdi(data.subject.label)}
          </p>
          {data.subject.vehicle ? <p className="num mt-1 text-sm text-muted">{data.subject.vehicle}</p> : null}
          {data.subject.orderId ? (
            <Link href={`/orders/${encodeURIComponent(data.subject.orderId)}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
              <bdi>#{orderTicketNumber(data.subject.orderId)}</bdi>
              <IconExternal size={14} />
            </Link>
          ) : null}
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <PersonLine label={t('console.safety.who')} person={data.raiser} id={data.id} who="raiser" live={live} />
            {data.counterpart ? <PersonLine label={t('console.safety.other_party')} person={data.counterpart} id={data.id} who="counterpart" live={live} /> : null}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-line bg-surface p-5 shadow-card" data-testid="sos-contact">
          <h3 className="mb-3 text-[15px] font-semibold">{t('console.safety.contact')}</h3>
          {data.contact.set ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold">{data.contact.name}</p>
                <p className="num text-sm text-muted">
                  <bdi>{data.contact.phoneMasked}</bdi>
                </p>
                <Chip tone={contactTone(data.contact.status)} dot className="mt-2">
                  {contactText(data.contact.status)}
                </Chip>
              </div>
              <CallButton id={data.id} who="contact" label={t('console.safety.call_contact')} />
            </div>
          ) : (
            <p className="text-sm text-muted">{t('console.safety.contact_none')}</p>
          )}
          {data.shareUrl ? (
            <a href={data.shareUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-dense text-accent-text hover:underline">
              {t('sos.page_title')}
              <IconExternal size={14} />
            </a>
          ) : null}
        </section>
        <NotesCard data={data} />
      </div>

      <LadderCard id={data.id} live={live} />

      <section className="rounded-lg border border-line bg-surface p-5 shadow-card" data-testid="sos-timeline">
        <h3 className="mb-4 text-[15px] font-semibold">{t('console.safety.timeline')}</h3>
        <Timeline
          items={data.timeline.map((e, i) => ({
            id: e.id,
            title: entryText(e, raiserName),
            time: <span className="num">{entryTime(e)}</span>,
            meta: e.note ?? (e.kind === 'resolved' && data.outcome ? t(`console.safety.outcome_${data.outcome}`) : undefined),
            tone: e.kind === 'raised' || e.kind === 'escalated' ? 'bad' : e.kind === 'resolved' || e.kind === 'acknowledged' ? 'ok' : 'default',
            current: live && i === data.timeline.length - 1,
          }))}
        />
      </section>
    </article>
  );
}

/** Who the alert has reached so far (`onCall.ladder`, E1 CON-02): the desk again, then the people on call. */
function LadderCard({ id, live }: { id: string; live: boolean }) {
  const trpc = useTRPC();
  const ladder = useQuery(trpc.onCall.ladder.queryOptions({ alertId: id }, { retry: queryRetry, refetchInterval: live ? SAFETY_POLL_MS : false }));
  const l = ladder.data;
  if (!l || l.steps.length === 0) return null;
  return (
    <section className={cx('rounded-lg border bg-surface p-5 shadow-card', l.unanswered ? 'border-bad/45' : 'border-line')} data-testid="sos-ladder">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{t('console.safety.ladder_title')}</h3>
        {l.unanswered ? (
          <Chip tone="bad" dot>
            {t('console.safety.ladder_unanswered')}
          </Chip>
        ) : null}
      </div>
      <ol className="space-y-1.5">
        {foldRings(l.steps).map((s, i) => (
          <li key={i} className="flex items-baseline gap-3 text-dense">
            <span className="num w-[132px] shrink-0 whitespace-nowrap text-muted">{s.times > 1 ? `${formatClock(s.at)} – ${formatClock(s.last)}` : formatClock(s.at)}</span>
            <span className={s.step === 'ring' ? 'text-muted' : 'font-medium text-text'}>{t(LADDER_KEY[s.step], { n: s.count })}</span>
            {s.times > 1 ? <span className="num text-muted">{`× ${s.times}`}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Back-to-back rings to the same number of people read as one line (`2:45 – 2:50 … × 11`); a ladder step breaks the run. */
function foldRings(steps: readonly LadderStep[]): Array<LadderStep & { last: Date; times: number }> {
  const out: Array<LadderStep & { last: Date; times: number }> = [];
  for (const s of steps) {
    const prev = out.at(-1);
    if (prev && s.step === 'ring' && prev.step === 'ring' && prev.count === s.count) {
      prev.last = s.at;
      prev.times += 1;
    } else out.push({ ...s, last: s.at, times: 1 });
  }
  return out;
}

const LADDER_KEY = {
  ring: 'console.safety.ladder_ring',
  on_call_1: 'console.safety.ladder_on_call_1',
  on_call_2: 'console.safety.ladder_on_call_2',
  admins: 'console.safety.ladder_admins',
} as const;

function PositionCard({ data, now }: { data: SafetyIncidentCase; now: number }) {
  const toast = useToast();
  const p = data.lastPosition;
  const W = 320;
  const H = 150;
  const path = useMemo(() => trailPath(data.trail, W, H), [data.trail]);
  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-card" data-testid="sos-position">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{t('console.safety.last_position')}</h3>
        {p ? <span className={cx('num text-xs', now - p.at.getTime() > 30_000 ? 'text-warn' : 'text-muted')}>{t('console.safety.position_age', { ago: ageText(now - p.at.getTime()) })}</span> : null}
      </div>
      {p ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <IconPin size={20} className="mt-0.5 shrink-0 text-bad" />
            <div className="min-w-0">
              <p className="num text-lg font-semibold">
                <bdi className="ltr">{coordsText(p)}</bdi>
              </p>
              <p className="num text-dense text-muted">
                {[p.accuracyM !== null ? t('console.safety.accuracy', { meters: Math.round(p.accuracyM) }) : null, t('console.safety.device_time', { time: formatDayClock(p.deviceAt) }), t('console.safety.points', { count: data.trail.length })].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          {data.trail.length > 1 ? (
            <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full rounded-md bg-surface-2" role="img" aria-label={t('console.safety.points', { count: data.trail.length })} data-testid="sos-trail">
              <polyline points={path.points} fill="none" stroke="rgb(var(--c-line-strong))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {path.first ? <circle cx={path.first.x} cy={path.first.y} r={4} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-muted))" strokeWidth={1.5} /> : null}
              {path.last ? <circle cx={path.last.x} cy={path.last.y} r={6} fill="rgb(var(--c-bad-solid))" stroke="rgb(var(--c-surface))" strokeWidth={2} /> : null}
              <text x={W - 8} y={H - 8} textAnchor="end" direction="ltr" className="num" fontSize={12} fill="rgb(var(--c-muted))">
                {`${path.spanM} m`}
              </text>
            </svg>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <a href={mapsUrl(p)} target="_blank" rel="noreferrer" className={buttonCls('secondary', 'md')} data-testid="sos-open-map">
              <IconExternal size={16} />
              {t('console.safety.open_map')}
            </a>
            <button
              type="button"
              className={buttonCls('ghost', 'md')}
              onClick={() => {
                void navigator.clipboard?.writeText(coordsText(p)).catch(() => undefined);
                toast({ title: coordsText(p) });
              }}
            >
              <IconCopy size={16} />
              {t('console.safety.copy_coords')}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">{t('console.safety.no_position')}</p>
      )}
    </section>
  );
}

function PersonLine({ label, person, id, who, live }: { label: string; person: SafetyPerson; id: string; who: SafetyCallTarget; live: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={person.displayName} id={person.personId} />
        <div className="min-w-0">
          <p className="text-xs text-muted">{label}</p>
          <p className="truncate text-sm font-semibold">
            {personName(person)} <span className="font-normal text-muted">({roleText(person.role)})</span>
          </p>
          {person.phoneMasked ? (
            <p className="num text-xs text-muted">
              <bdi>{person.phoneMasked}</bdi>
            </p>
          ) : null}
        </div>
      </div>
      <CallButton id={id} who={who} label={who === 'raiser' ? t('console.safety.call_raiser', { name: personName(person) }) : t('console.safety.call_other')} primary={live && who === 'raiser'} />
    </div>
  );
}

function CallButton({ id, who, label, primary = false }: { id: string; who: SafetyCallTarget; label: string; primary?: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const call = useMutation(
    trpc.safety.requestCall.mutationOptions({
      onSuccess: (s) => {
        void qc.invalidateQueries(trpc.safety.get.pathFilter());
        toast({
          title: t('console.safety.call_dial', { number: s.dial }),
          body: s.mode === 'dev_direct' ? t('console.safety.call_dev') : t('console.safety.call_proxy'),
          action: { label: label, onClick: () => window.open(`tel:${s.dial}`, '_self') },
        });
      },
      onError: (e) => toast({ title: e.message, tone: 'bad' }),
    }),
  );
  return (
    <Button variant={primary ? 'primary' : 'secondary'} loading={call.isPending} icon={<IconPhone size={16} />} onClick={() => call.mutate({ id, who })} data-testid={`sos-call-${who}`}>
      {label}
    </Button>
  );
}

function NotesCard({ data }: { data: SafetyIncidentCase }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const add = useMutation(
    trpc.safety.note.mutationOptions({
      onSuccess: (d) => {
        qc.setQueryData(trpc.safety.get.queryKey({ id: d.id }), d);
        setNote('');
      },
      onError: (e) => toast({ title: e.message, tone: 'bad' }),
    }),
  );
  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-card">
      <h3 className="mb-3 text-[15px] font-semibold">{t('console.safety.note_add')}</h3>
      {data.resolution ? (
        <p className="mb-3 rounded-md bg-note px-3 py-2 text-sm text-text">
          <span className="font-semibold">{data.outcome ? t(`console.safety.outcome_${data.outcome}`) : ''}</span> · {data.resolution}
        </p>
      ) : null}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim().length >= 2) add.mutate({ id: data.id, note: note.trim() });
        }}
      >
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('console.safety.note_placeholder')} rows={3} aria-label={t('console.safety.note_add')} />
        <div className="flex justify-end">
          <Button type="submit" loading={add.isPending} disabled={note.trim().length < 2}>
            {t('console.safety.note_send')}
          </Button>
        </div>
      </form>
    </section>
  );
}

const OUTCOMES: readonly SafetyOutcome[] = ['safe', 'false_alarm', 'emergency', 'escalated'];

function ResolveDialog({ data, open, onClose }: { data: SafetyIncidentCase; open: boolean; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const [outcome, setOutcome] = useState<SafetyOutcome>('safe');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setOutcome('safe');
    setNote('');
    setTried(false);
  }, [open]);
  const resolve = useMutation(
    trpc.safety.resolve.mutationOptions({
      onSuccess: (d) => {
        qc.setQueryData(trpc.safety.get.queryKey({ id: d.id }), d);
        void qc.invalidateQueries(trpc.safety.list.pathFilter());
        toast({ title: t('console.safety.resolved_done'), tone: 'ok' });
        onClose();
      },
      onError: (e) => toast({ title: e.message, tone: 'bad' }),
    }),
  );
  const short = note.trim().length < 5;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('console.safety.resolve_title', { name: personName(data.raiser) })}
      description={t('console.safety.resolve_body')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={resolve.isPending}
            onClick={() => {
              setTried(true);
              if (!short) resolve.mutate({ id: data.id, outcome, note: note.trim() });
            }}
            data-testid="sos-resolve-confirm"
          >
            {t('console.safety.resolve')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">{t('console.safety.resolve')}</legend>
          {OUTCOMES.map((o) => (
            <label key={o} className={cx('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm', outcome === o ? 'border-accent bg-accent-tint font-semibold' : 'border-line hover:bg-surface-2')}>
              <input type="radio" name="sos-outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="accent-[rgb(var(--c-accent))]" />
              {t(`console.safety.outcome_${o}`)}
            </label>
          ))}
        </fieldset>
        <Field label={t('console.safety.timeline')} error={tried && short ? t('console.safety.note_short') : undefined}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('console.safety.note_placeholder')} rows={4} aria-invalid={tried && short} data-testid="sos-resolve-note" />
        </Field>
      </div>
    </Dialog>
  );
}
