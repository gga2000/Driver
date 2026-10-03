'use client';

import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { formatClock, formatDayClock, formatIqd, shortId } from '@/lib/format';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Card, Chip, LiveBadge, Mono, NeedLogin, PageHeader, primaryBtn, QueryError, Row } from './ui';

export function SystemPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('console.system_title')} subtitle={t('console.system_subtitle')} />
      <div className="grid gap-4 md:grid-cols-2">
        <HealthCard />
        <NightlyCard />
        <PlaceholderCard title={t('console.outbox')} hint={t('console.outbox_hint')} />
        <PlaceholderCard title={t('console.simulator')} hint={t('console.simulator_hint')} />
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

function PlaceholderCard({ title, hint }: { title: string; hint: string }) {
  return (
    <Card title={title}>
      <p className="text-sm text-muted">{hint}</p>
      <p className="mt-3">
        <Chip>{t('console.coming_next_step')}</Chip>
      </p>
    </Card>
  );
}
