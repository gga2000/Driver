'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { LaunchMetric, LaunchMetricsView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useState } from 'react';
import { dayBars, metricTone } from '@/lib/control-room';
import { formatClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { NeedLogin, QueryError } from './ui';

const POLL_MS = 30_000;

/**
 * The week-one metrics wall (launch playbook §6) for the big screen in the ops room: full-bleed over
 * the console shell, six tiles that turn green or red against the playbook targets, orders per day.
 */
export function WallPage() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const wall = useQuery(trpc.metrics.wall.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-bg">
      {!signedIn && (
        <div className="p-8">
          <NeedLogin />
        </div>
      )}
      {wall.error && (
        <div className="p-8">
          <QueryError error={wall.error} onRetry={() => void wall.refetch()} />
        </div>
      )}
      {wall.data && <Wall data={wall.data} />}
    </div>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function Wall({ data }: { data: LaunchMetricsView }) {
  const now = useNow();
  const bars = dayBars(data.ordersByDay);
  const met = data.metrics.filter((m) => m.ok === true).length;
  return (
    <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col p-6 md:p-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-accent">{t('console.wall_kicker')}</p>
          <h1 className="font-display text-4xl font-bold md:text-5xl">{t('console.wall_title', { day: data.day })}</h1>
          <p className="mt-2 text-lg text-muted">{t('console.wall_met', { n: met, total: data.metrics.length })}</p>
        </div>
        <div className="text-end">
          <p className="font-display text-5xl font-bold tabular-nums" suppressHydrationWarning>
            {now ? formatClock(now) : ''}
          </p>
          <p className="mt-1 text-sm text-muted">
            {t('console.wall_updated', { time: formatClock(data.at) })} ·{' '}
            <Link href="/controls" className="underline hover:text-accent">
              {t('console.wall_exit')}
            </Link>
          </p>
        </div>
      </header>

      <ul className="grid flex-1 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {data.metrics.map((m) => (
          <MetricTile key={m.key} m={m} />
        ))}
      </ul>

      <section className="mt-8 rounded-2xl border border-line bg-surface p-6" aria-label={t('console.wall_orders_by_day')}>
        <h2 className="mb-4 font-display text-xl font-semibold">{t('console.wall_orders_by_day')}</h2>
        <ol className="flex h-40 items-end gap-3">
          {data.ordersByDay.map((d, i) => (
            <li key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
              <span className="font-display text-xl font-bold tabular-nums">{d.orders}</span>
              <span className={`w-full rounded-t-md ${i === data.ordersByDay.length - 1 ? 'bg-accent' : 'bg-surface-2'}`} style={{ height: `${Math.max(bars[i] ?? 0, 3)}%` }} />
              <span className="text-xs text-muted tabular-nums" dir="ltr">
                {d.date.slice(5).replace('-', '/')}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function MetricTile({ m }: { m: LaunchMetric }) {
  const tone = metricTone(m);
  const ring = tone === 'ok' ? 'border-success-500 bg-success-500/10' : tone === 'bad' ? 'border-danger-500 bg-danger-500/15' : 'border-line bg-surface';
  const value = tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-text';
  return (
    <li className={`flex min-h-[13rem] flex-col justify-between rounded-2xl border-2 p-6 ${ring}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold">{m.label_ar}</h2>
        <span className={`shrink-0 whitespace-nowrap rounded-pill px-3 py-1 text-sm font-semibold ${tone === 'ok' ? 'bg-success-500 text-white' : tone === 'bad' ? 'bg-danger-500 text-white' : 'bg-surface-2 text-muted'}`}>
          {t(tone === 'ok' ? 'console.wall_on_target' : tone === 'bad' ? 'console.wall_off_target' : 'console.wall_pending')}
        </span>
      </div>
      <p className={`font-display text-7xl font-bold tabular-nums leading-none md:text-8xl ${value}`}>{m.display}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-base">
        <span className="text-muted">
          {t('console.wall_target')}: <span className="text-text">{m.target_ar}</span>
        </span>
        {m.hint_ar && <span className="text-sm text-faint">{m.hint_ar}</span>}
      </div>
    </li>
  );
}
