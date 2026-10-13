'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OUTBOX_REQUEUE_ROLES } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState, type ReactNode } from 'react';
import { outboxHealth } from '@/lib/board';
import { formatClock, formatDayClock, formatIqd, shortId } from '@/lib/format';
import { netWords } from '@/lib/control-room';
import { CITY_ID, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { errorText } from '@/lib/network';
import { Button, Card, Chip, cx, Dialog, IconAlert, IconCheckCircle, IconClock, LiveBadge, Mono, NeedLogin, PageHeader, QueryError, Row, Skeleton, useToast } from './ui';

/** Engineering health lives here (K-23): the API and its stores, the nightly close, the outbox and the simulator. */
export function SystemPage() {
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title={t('console.system_title')} subtitle={t('console.system_subtitle')} />
      <div className="space-y-5">
        <HealthStrip />
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <NightlyCard />
            <SimulatorCard />
          </div>
          <div className="space-y-5">
            <OutboxCard />
            <NotifyStuckCard />
            <SmsDayCard />
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthStrip() {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.ping.queryOptions(undefined, { refetchInterval: 5_000, retry: false }));
  const h = health.data;
  const checking = health.isPending;
  const parts: Array<{ k: string; ok: boolean | null; detail?: ReactNode }> = [
    { k: t('console.health_api'), ok: checking ? null : health.isSuccess, detail: h ? <Mono>{h.version}</Mono> : undefined },
    { k: t('console.health_db'), ok: h ? h.db === 'ok' : checking ? null : false },
    { k: t('console.health_redis'), ok: h ? h.redis === 'ok' : checking ? null : false },
  ];
  const down = parts.filter((p) => p.ok === false).length;
  return (
    <section aria-labelledby="sys-health" className="rounded-lg border border-line bg-surface shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id="sys-health" className="flex items-center gap-2 text-[15px] font-semibold">
          {t('console.health')}
          {!checking && <span className={cx('text-dense font-medium', down ? 'text-bad' : 'text-ok')}>{down ? t('console.health_n_down', { n: down }) : t('console.health_all_ok')}</span>}
        </h2>
        <LiveBadge seconds={5} updatedAt={health.dataUpdatedAt} fetching={health.isFetching} error={Boolean(health.error)} />
      </header>
      <dl className="grid divide-y divide-line sm:grid-cols-4 sm:divide-x sm:divide-y-0 sm:divide-x-reverse">
        {parts.map((p) => (
          <div key={p.k} className="px-5 py-4">
            <dt className="text-dense text-muted">{p.k}</dt>
            <dd className={cx('mt-1 flex items-center gap-2 text-lg font-semibold', p.ok === null ? 'text-muted' : p.ok ? 'text-text' : 'text-bad')}>
              {p.ok === null ? <IconClock size={20} /> : p.ok ? <IconCheckCircle size={20} className="text-ok" /> : <IconAlert size={20} />}
              {p.ok === null ? t('console.api_checking') : p.ok ? t('console.health_ok') : t('console.health_down')}
            </dd>
            {p.detail ? <dd className="mt-0.5 text-xs text-muted">{p.detail}</dd> : null}
          </div>
        ))}
        <div className="px-5 py-4">
          <dt className="text-dense text-muted">{t('console.health_server_time')}</dt>
          <dd className="num mt-1 text-lg font-semibold">{h ? formatClock(h.now) : '—'}</dd>
          <dd className="mt-0.5 text-xs text-muted">{h ? formatDayClock(h.now).split(' · ')[0] : ''}</dd>
        </div>
      </dl>
      {health.error && <p className="border-t border-line px-5 py-2.5 text-sm text-bad">{t('console.api_offline')}</p>}
    </section>
  );
}

function NightlyCard() {
  const trpc = useTRPC();
  const toast = useToast();
  const signedIn = useSignedIn();
  const run = useMutation(trpc.ledger.runNightly.mutationOptions({ onSuccess: (r) => toast({ title: r.message_ar, tone: r.ok ? 'ok' : 'bad' }) }));
  const r = run.data;
  const overCap = r?.drivers.filter((d) => d.overCap) ?? [];
  const lines = r
    ? [
        { ok: r.money.ok, text: t('console.nightly_money_words', { net: netWords(r.money.net), events: formatIqd(r.money.events) }) },
        { ok: r.points.ok, text: t('console.nightly_points_words', { net: netWords(r.points.net), events: formatIqd(r.points.events) }) },
        { ok: r.kindViolations === 0, text: t('console.nightly_kind', { n: r.kindViolations }) },
        { ok: overCap.length === 0, text: t('console.nightly_over_cap', { n: overCap.length }), warn: true },
      ]
    : [];
  return (
    <Card title={t('console.nightly')} hint={t('console.nightly_hint')} tone={r ? (r.ok ? 'ok' : 'bad') : 'default'}>
      {!signedIn ? (
        <NeedLogin />
      ) : (
        <Button variant="primary" needsNet loading={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? t('console.nightly_running') : t('console.nightly_run')}
        </Button>
      )}
      <div role="status" aria-live="polite" className="mt-4 space-y-3 empty:hidden">
        {run.error && <QueryError error={run.error} />}
        {r && (
          <>
            <p className={cx('flex items-center gap-2 text-lg font-semibold', r.ok ? 'text-text' : 'text-bad')}>
              {r.ok ? <IconCheckCircle size={22} className="text-ok" /> : <IconAlert size={22} />}
              {r.message_ar}
            </p>
            <ul className="space-y-1.5 text-sm">
              {lines.map((l) => (
                <li key={l.text} className={cx('flex items-center gap-2', !l.ok && (l.warn ? 'text-warn' : 'text-bad'))}>
                  {l.ok ? <IconCheckCircle size={16} className="shrink-0 text-ok" /> : <IconAlert size={16} className="shrink-0" />}
                  {l.text}
                </li>
              ))}
            </ul>
            {overCap.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-sm">
                {overCap.map((d) => (
                  <li key={d.driverId}>
                    <Link href={`/drivers/${encodeURIComponent(d.driverId)}/ledger`} className="text-accent-text underline underline-offset-4">
                      <Mono title={d.driverId}>{shortId(d.driverId)}</Mono>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {r.incidentId && <p className="text-sm text-bad">{t('console.nightly_incident', { id: r.incidentId })}</p>}
            <p className="text-xs text-muted">{t('console.nightly_ran_at', { time: formatClock(r.runAt) })}</p>
          </>
        )}
      </div>
    </Card>
  );
}

function OutboxCard() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const outbox = useQuery(trpc.system.outbox.queryOptions(undefined, { enabled: signedIn, refetchInterval: 5_000, retry: queryRetry }));
  const o = outbox.data;
  const health = o ? outboxHealth(o) : 'ok';
  const { roles } = useMyRoles();
  // Admin only (audited on the server): failed rows go back on the queue once the cause is fixed.
  const canRequeue = hasAny(roles, OUTBOX_REQUEUE_ROLES);
  const [requeue, setRequeue] = useState<string[] | null>(null);
  return (
    <Card title={t('console.outbox')} hint={t('console.outbox_hint')} tone={health === 'failing' ? 'bad' : 'default'} actions={signedIn ? <LiveBadge seconds={5} updatedAt={outbox.dataUpdatedAt} fetching={outbox.isFetching} compact /> : undefined}>
      <RequeueDialog ids={requeue} onClose={() => setRequeue(null)} />
      {!signedIn && <NeedLogin />}
      {outbox.error && <QueryError error={outbox.error} onRetry={() => void outbox.refetch()} />}
      {signedIn && !o && outbox.isPending && <Skeleton className="h-16" />}
      {o && (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Count k={t('console.outbox_pending')} v={o.pending} tone={health === 'backlog' ? 'warn' : undefined} />
            <Count k={t('console.outbox_failed')} v={o.failed} tone={o.failed > 0 ? 'bad' : undefined} />
            <Count k={t('console.outbox_published')} v={o.published} />
          </dl>
          {o.recentFailed.length > 0 ? (
            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-dense font-medium">{t('console.outbox_recent_failed')}</p>
                {canRequeue && (
                  <Button variant="secondary" needsNet onClick={() => setRequeue(o.recentFailed.map((f) => f.id))} data-testid="outbox-requeue-all">
                    {t('console.outbox_requeue_all', { n: o.recentFailed.length })}
                  </Button>
                )}
              </div>
              <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto text-sm">
                {o.recentFailed.map((f) => (
                  <li key={f.id} className="rounded-md border border-bad/40 bg-bad-tint px-3 py-2">
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <Mono title={f.eventId}>{f.type}</Mono>
                      <span className="text-xs text-muted">
                        {t('console.outbox_attempts', { n: f.attempts })} · {formatDayClock(f.createdAt)}
                      </span>
                    </p>
                    <p className="text-xs text-muted">
                      {f.aggregate} · <Mono title={f.aggregateId}>{shortId(f.aggregateId)}</Mono>
                    </p>
                    {f.lastError && (
                      <p dir="ltr" className="mt-1 break-words text-xs text-bad">
                        {f.lastError}
                      </p>
                    )}
                    {canRequeue && (
                      <Button variant="secondary" needsNet className="mt-2" onClick={() => setRequeue([f.id])} data-testid={`outbox-requeue-${f.id}`}>
                        {t('console.outbox_requeue')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 flex items-center gap-2 text-sm text-text">
              <IconCheckCircle size={16} className="text-ok" />
              {t('console.outbox_all_ok')}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** Confirms an admin requeue of failed outbox rows (`system.requeueOutbox`, audited on the server). */
function RequeueDialog({ ids, onClose }: { ids: string[] | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const run = useMutation(
    trpc.system.requeueOutbox.mutationOptions({
      onSuccess: (r) => {
        void qc.invalidateQueries({ queryKey: trpc.system.outbox.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.system.moneyAlarm.queryKey() });
        toast({ title: t('console.outbox_requeued', { n: r.requeued }), tone: 'ok' });
        onClose();
      },
      onError: (e) => toast({ title: errorText(e), tone: 'bad' }),
    }),
  );
  const n = ids?.length ?? 0;
  return (
    <Dialog
      open={ids !== null}
      onClose={onClose}
      width="sm"
      title={t('console.outbox_requeue_title', { n })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button variant="primary" needsNet loading={run.isPending} onClick={() => ids && run.mutate({ ids })} data-testid="outbox-requeue-confirm">
            {t('console.outbox_requeue_confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">{t('console.outbox_requeue_body')}</p>
    </Dialog>
  );
}

/**
 * Outgoing messages claimed for a send more than 5 minutes ago that never recorded an answer
 * (`system.notifyStuck`; job machines log the same count to Sentry). Read only: nothing is resent.
 */
function NotifyStuckCard() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const q = useQuery(trpc.system.notifyStuck.queryOptions(undefined, { enabled: signedIn, refetchInterval: 30_000, retry: queryRetry }));
  const s = q.data;
  const stuck = (s?.stuck ?? 0) > 0;
  return (
    <Card title={t('console.notify_stuck')} hint={t('console.notify_stuck_hint')} tone={stuck ? 'bad' : 'default'} actions={signedIn ? <LiveBadge seconds={30} updatedAt={q.dataUpdatedAt} fetching={q.isFetching} compact /> : undefined}>
      {!signedIn && <NeedLogin />}
      {q.error && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {signedIn && !s && q.isPending && <Skeleton className="h-16" />}
      {s && <NotifyStuckView stuck={s.stuck} oldestSec={s.oldestSec} />}
    </Card>
  );
}

/** The stuck-messages count and what to do about it (no data fetching, so tests can render it). */
export function NotifyStuckView({ stuck, oldestSec }: { stuck: number; oldestSec: number }) {
  const any = stuck > 0;
  return (
    <>
      <dl className="grid grid-cols-2 gap-3">
        <Count k={t('console.notify_stuck_count')} v={stuck} tone={any ? 'bad' : undefined} />
        <Count k={t('console.notify_stuck_oldest')} v={Math.floor(oldestSec / 60)} />
      </dl>
      <p className={cx('mt-3 flex items-center gap-2 text-sm', any ? 'text-bad' : 'text-text')} data-testid="notify-stuck-state">
        {any ? <IconAlert size={16} className="shrink-0" /> : <IconCheckCircle size={16} className="shrink-0 text-ok" />}
        {any ? t('console.notify_stuck_help') : t('console.notify_stuck_none')}
      </p>
    </>
  );
}

/** The day's SMS (sign-in codes and notification texts share one budget and one account balance). */
function SmsDayCard() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const sms = useQuery(trpc.system.smsDay.queryOptions(undefined, { enabled: signedIn, refetchInterval: 30_000, retry: queryRetry }));
  const s = sms.data;
  const share = s ? s.sent / s.budget : 0;
  const tone = share >= 1 ? 'bad' : share >= 0.8 ? 'warn' : undefined;
  return (
    <Card title={t('console.sms_day')} hint={t('console.sms_day_hint')} tone={tone ?? 'default'} actions={signedIn ? <LiveBadge seconds={30} updatedAt={sms.dataUpdatedAt} fetching={sms.isFetching} compact /> : undefined}>
      {!signedIn && <NeedLogin />}
      {sms.error && <QueryError error={sms.error} onRetry={() => void sms.refetch()} />}
      {signedIn && !s && sms.isPending && <Skeleton className="h-16" />}
      {s && (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <Count k={t('console.sms_day_sent')} v={s.sent} tone={tone} />
            <Count k={t('console.sms_day_budget')} v={s.budget} />
          </dl>
          {share >= 1 && (
            <p className="mt-3 flex items-center gap-2 text-sm text-bad">
              <IconAlert size={16} className="shrink-0" />
              {t('console.sms_day_over')}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function Count({ k, v, tone }: { k: string; v: number; tone?: 'bad' | 'warn' }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2.5">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={cx('mt-0.5 text-xl font-semibold', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-text')}>{formatIqd(v)}</dd>
    </div>
  );
}

/** Calls the simulator contract; until the rebuilt simulator lands it answers `available: false`. */
function SimulatorCard() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const status = useQuery(trpc.system.simulator.status.queryOptions(undefined, { enabled: signedIn, refetchInterval: 5_000, retry: queryRetry }));
  const refresh = { onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.system.simulator.status.queryKey() }) };
  const start = useMutation(trpc.system.simulator.start.mutationOptions(refresh));
  const stop = useMutation(trpc.system.simulator.stop.mutationOptions(refresh));
  const s = status.data;
  return (
    <Card
      title={t('console.simulator')}
      hint={t('console.simulator_hint')}
      actions={s?.available ? <Chip tone={s.running ? 'live' : 'neutral'} dot>{s.running ? t('console.simulator_running') : t('console.simulator_stopped')}</Chip> : undefined}
    >
      {!signedIn && <NeedLogin />}
      {status.error && <QueryError error={status.error} onRetry={() => void status.refetch()} />}
      {signedIn && !s && status.isPending && <Skeleton className="h-16" />}
      {s && !s.available && <p className="text-sm text-muted">{t('console.simulator_unavailable')}</p>}
      {s?.available && (
        <>
          <dl>
            <Row k={t('console.simulator_drivers')} v={<span className="num">{s.drivers}</span>} />
            {s.startedAt && <Row k={t('console.simulator_started')} v={<span className="num">{formatDayClock(s.startedAt)}</span>} />}
            {s.progress && (
              <Row
                k={t('console.simulator_now')}
                v={<span className="num">{t('console.simulator_progress', { time: formatClock(s.progress.simTime), placed: s.progress.placed, delivered: s.progress.delivered, online: s.progress.driversOnline })}</span>}
              />
            )}
            {s.lastReport && (
              <Row
                k={t('console.simulator_last_report')}
                v={
                  <Chip tone={s.lastReport.ok ? 'done' : 'bad'}>
                    {s.lastReport.ok
                      ? t('console.simulator_report_ok', { delivered: s.lastReport.delivered, orders: s.lastReport.orders })
                      : t('console.simulator_report_failed', { count: s.lastReport.violations.length, names: s.lastReport.violations.map((v) => v.invariant).join(t('console.list_sep')) })}
                  </Chip>
                }
              />
            )}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {s.running ? (
              <Button loading={stop.isPending} onClick={() => stop.mutate()}>
                {t('console.simulator_stop')}
              </Button>
            ) : (
              <Button variant="primary" loading={start.isPending} onClick={() => start.mutate({ cityId: CITY_ID })}>
                {t('console.simulator_start')}
              </Button>
            )}
          </div>
        </>
      )}
      <div role="status" className="mt-2 text-sm empty:hidden">
        {start.error && <p className="text-bad">{errorText(start.error)}</p>}
        {stop.error && <p className="text-bad">{errorText(stop.error)}</p>}
      </div>
    </Card>
  );
}
