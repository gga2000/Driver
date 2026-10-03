'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { outboxHealth } from '@/lib/board';
import { formatClock, formatDayClock, formatIqd, shortId } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Card, Chip, ghostBtn, LiveBadge, Mono, NeedLogin, PageHeader, primaryBtn, QueryError, Row } from './ui';

export function SystemPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('console.system_title')} subtitle={t('console.system_subtitle')} />
      <div className="grid gap-4 md:grid-cols-2">
        <HealthCard />
        <NightlyCard />
        <OutboxCard />
        <SimulatorCard />
      </div>
    </div>
  );
}

function Status({ ok }: { ok: boolean }) {
  return <Chip tone={ok ? 'done' : 'bad'}>{ok ? t('console.health_ok') : t('console.health_down')}</Chip>;
}

function HealthCard() {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.ping.queryOptions(undefined, { refetchInterval: 5_000, retry: false }));
  const h = health.data;
  return (
    <Card title={t('console.health')} actions={<LiveBadge seconds={5} updatedAt={health.dataUpdatedAt} fetching={health.isFetching} />}>
      <dl>
        <Row k={t('console.health_api')} v={health.isPending ? t('console.api_checking') : <Status ok={health.isSuccess} />} />
        <Row k={t('console.health_db')} v={h ? <Status ok={h.db === 'ok'} /> : '—'} />
        <Row k={t('console.health_redis')} v={h ? <Status ok={h.redis === 'ok'} /> : '—'} />
        <Row k={t('console.health_version')} v={h ? <Mono>{h.version}</Mono> : '—'} />
        <Row k={t('console.health_server_time')} v={h ? formatDayClock(h.now) : '—'} />
      </dl>
      {health.error && <p className="mt-2 text-sm text-bad">{t('console.api_offline')}</p>}
    </Card>
  );
}

function NightlyCard() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const run = useMutation(trpc.ledger.runNightly.mutationOptions());
  const r = run.data;
  const overCap = r?.drivers.filter((d) => d.overCap) ?? [];
  return (
    <Card title={t('console.nightly')} tone={r ? (r.ok ? 'ok' : 'bad') : 'default'}>
      <p className="text-sm text-muted">{t('console.nightly_hint')}</p>
      {!signedIn ? (
        <div className="mt-3">
          <NeedLogin />
        </div>
      ) : (
        <button type="button" className={`${primaryBtn} mt-4`} disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? t('console.nightly_running') : t('console.nightly_run')}
        </button>
      )}

      <div role="status" aria-live="polite" className="mt-4 space-y-2">
        {run.error && <QueryError error={run.error} />}
        {r && (
          <>
            <p className={`font-display text-xl font-bold ${r.ok ? 'text-ok' : 'text-bad'}`}>{r.message_ar}</p>
            <ul className="space-y-1 text-sm">
              <li className={r.money.ok ? '' : 'text-bad'}>{t('console.nightly_money', { net: formatIqd(r.money.net), events: r.money.events })}</li>
              <li className={r.points.ok ? '' : 'text-bad'}>{t('console.nightly_points', { net: formatIqd(r.points.net), events: r.points.events })}</li>
              <li className={r.kindViolations > 0 ? 'text-bad' : ''}>{t('console.nightly_kind', { n: r.kindViolations })}</li>
              <li className={overCap.length > 0 ? 'text-accent' : ''}>{t('console.nightly_over_cap', { n: overCap.length })}</li>
            </ul>
            {overCap.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-sm">
                {overCap.map((d) => (
                  <li key={d.driverId}>
                    <Link href={`/drivers/${encodeURIComponent(d.driverId)}/ledger`} className="text-accent underline">
                      <Mono title={d.driverId}>{shortId(d.driverId)}</Mono>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {r.incidentId && <p className="text-sm text-bad">{t('console.nightly_incident', { id: r.incidentId })}</p>}
            <p className="text-xs text-faint">{t('console.nightly_ran_at', { time: formatClock(r.runAt) })}</p>
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
  return (
    <Card
      title={t('console.outbox')}
      tone={health === 'failing' ? 'bad' : 'default'}
      actions={signedIn ? <LiveBadge seconds={5} updatedAt={outbox.dataUpdatedAt} fetching={outbox.isFetching} /> : undefined}
    >
      <p className="text-sm text-muted">{t('console.outbox_hint')}</p>
      {!signedIn && (
        <div className="mt-3">
          <NeedLogin />
        </div>
      )}
      {outbox.error && <QueryError error={outbox.error} onRetry={() => void outbox.refetch()} />}
      {o && (
        <>
          <dl className="mt-3">
            <Row k={t('console.outbox_pending')} v={<span className={`tabular-nums ${health === 'backlog' ? 'text-accent' : ''}`}>{o.pending}</span>} />
            <Row k={t('console.outbox_failed')} v={<span className={`tabular-nums ${o.failed > 0 ? 'text-bad' : ''}`}>{o.failed}</span>} />
            <Row k={t('console.outbox_published')} v={<span className="tabular-nums">{o.published}</span>} />
          </dl>
          {o.recentFailed.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted">{t('console.outbox_recent_failed')}</p>
              <ul className="mt-1 max-h-72 space-y-2 overflow-y-auto text-sm">
                {o.recentFailed.map((f) => (
                  <li key={f.id} className="rounded-md border border-danger-500/50 bg-danger-500/5 px-2 py-1.5">
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
                      <p dir="ltr" className="mt-1 break-words font-mono text-xs text-bad">
                        {f.lastError}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {o.failed === 0 && <p className="mt-3 text-sm text-ok">{t('console.outbox_all_ok')}</p>}
        </>
      )}
    </Card>
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
    <Card title={t('console.simulator')}>
      <p className="text-sm text-muted">{t('console.simulator_hint')}</p>
      {!signedIn && (
        <div className="mt-3">
          <NeedLogin />
        </div>
      )}
      {status.error && <QueryError error={status.error} onRetry={() => void status.refetch()} />}
      {s && !s.available && (
        <p className="mt-3">
          <Chip>{t('console.simulator_unavailable')}</Chip>
        </p>
      )}
      {s?.available && (
        <>
          <dl className="mt-3">
            <Row k={t('console.simulator_state')} v={<Chip tone={s.running ? 'live' : 'neutral'}>{s.running ? t('console.simulator_running') : t('console.simulator_stopped')}</Chip>} />
            <Row k={t('console.simulator_drivers')} v={<span className="tabular-nums">{s.drivers}</span>} />
            {s.startedAt && <Row k={t('console.simulator_started')} v={formatDayClock(s.startedAt)} />}
          </dl>
          {s.progress && (
            <p className="mt-2 text-sm tabular-nums">
              {t('console.simulator_progress', { time: formatClock(s.progress.simTime), placed: s.progress.placed, delivered: s.progress.delivered, online: s.progress.driversOnline })}
            </p>
          )}
          {s.lastReport && (
            <dl className="mt-2">
              <Row
                k={t('console.simulator_last_report')}
                v={
                  <Chip tone={s.lastReport.ok ? 'done' : 'bad'}>
                    {s.lastReport.ok
                      ? t('console.simulator_report_ok', { delivered: s.lastReport.delivered, orders: s.lastReport.orders })
                      : t('console.simulator_report_failed', { count: s.lastReport.violations.length, names: s.lastReport.violations.map((v) => v.invariant).join('، ') })}
                  </Chip>
                }
              />
            </dl>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} disabled={s.running || start.isPending} onClick={() => start.mutate({ cityId: CITY_ID })}>
              {t('console.simulator_start')}
            </button>
            <button type="button" className={ghostBtn} disabled={!s.running || stop.isPending} onClick={() => stop.mutate()}>
              {t('console.simulator_stop')}
            </button>
          </div>
        </>
      )}
      <div role="status" className="mt-2 text-sm">
        {start.error && <p className="text-bad">{start.error.message}</p>}
        {stop.error && <p className="text-bad">{stop.error.message}</p>}
      </div>
    </Card>
  );
}
