'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { LaunchMetric, LaunchMetricsView } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useState } from 'react';
import { bullet, dayBars, dayLabel, metricTone, wallStale } from '@/lib/control-room';
import { formatClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { BrandMark } from './shell/brand';
import { cx, IconAlert, IconCheckCircle, IconClock, NeedLogin, QueryError } from './ui';

const POLL_MS = 30_000;

/**
 * The week-one metrics wall (launch playbook §6) for the TV in the ops room, read from 3–5 m: full
 * bleed over the shell, dark by default (`?theme=light` for a bright room), six tiles against the
 * playbook targets (status in words and an icon, a bullet bar to the target), orders per day against
 * the 30-a-day target, and a red line across the top when the screen stops updating (S-K6).
 * `?tv=1` hides the way back to the console.
 */
export function WallPage() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const wall = useQuery(trpc.metrics.wall.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));
  const [opts, setOpts] = useState({ tv: false, light: false });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setOpts({ tv: q.get('tv') === '1', light: q.get('theme') === 'light' });
  }, []);
  return (
    <div data-theme={opts.light ? 'light' : 'dark'} className="fixed inset-0 z-40 overflow-y-auto bg-canvas text-text">
      {!signedIn && (
        <div className="p-8">
          <NeedLogin />
        </div>
      )}
      {wall.error && !wall.data && (
        <div className="p-8">
          <QueryError error={wall.error} onRetry={() => void wall.refetch()} />
        </div>
      )}
      {wall.data && <Wall data={wall.data} updatedAt={wall.dataUpdatedAt} tv={opts.tv} />}
    </div>
  );
}

function useClock(ms = 1000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function Wall({ data, updatedAt = 0, tv = false }: { data: LaunchMetricsView; updatedAt?: number; tv?: boolean }) {
  const now = useClock();
  const met = data.metrics.filter((m) => m.ok === true).length;
  const stale = now ? wallStale(updatedAt, now.getTime()) : false;
  const staleMin = now && updatedAt ? Math.floor((now.getTime() - updatedAt) / 60_000) : 0;
  return (
    <div className="flex min-h-screen flex-col">
      {stale && (
        <p role="alert" className="flex items-center justify-center gap-3 bg-bad-solid px-6 py-3 text-2xl font-bold text-on-bad">
          <IconAlert size={28} />
          {t('console.wall_stale', { n: staleMin, time: formatClock(new Date(updatedAt)) })}
        </p>
      )}
      <div className="mx-auto flex w-full max-w-[1840px] flex-1 flex-col gap-6 px-10 py-6">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex items-center gap-5">
            <BrandMark size={64} />
            <div>
              <p className="text-xl font-semibold text-muted">{t('console.wall_kicker')}</p>
              <h1 className="text-[52px] font-bold leading-[64px] tracking-[-0.015em]">{t('console.wall_title', { day: data.day })}</h1>
            </div>
          </div>
          <div className="flex items-end gap-10">
            <div className="text-end">
              <p className="text-xl text-muted">{t('console.wall_met_label')}</p>
              <p className="flex items-center justify-end gap-3 text-[44px] font-bold leading-[56px]">
                <span>{t('console.wall_met_short', { n: met, total: data.metrics.length })}</span>
                <span className="flex gap-1.5" aria-hidden>
                  {data.metrics.map((m) => (
                    <span key={m.key} className={cx('h-4 w-4 rounded-pill', m.ok === true ? 'bg-ok-solid' : m.ok === false ? 'bg-bad-solid' : 'border-2 border-line-strong')} />
                  ))}
                </span>
              </p>
            </div>
            <div className="text-end">
              <p className="text-[64px] font-bold leading-[72px] tracking-[-0.02em]" suppressHydrationWarning>
                {now ? formatClock(now) : ''}
              </p>
              <p className="text-lg text-muted">
                {t('console.wall_updated', { time: formatClock(data.at) })}
                {!tv && (
                  <>
                    {' · '}
                    <Link href="/controls" className="underline underline-offset-4 hover:text-accent-text">
                      {t('console.wall_exit')}
                    </Link>
                  </>
                )}
              </p>
            </div>
          </div>
        </header>

        <ul className="grid flex-1 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 xl:grid-rows-2">
          {data.metrics.map((m) => (
            <MetricTile key={m.key} m={m} />
          ))}
        </ul>

        <OrdersByDay days={data.ordersByDay} />
      </div>
    </div>
  );
}

const STATUS = {
  ok: { icon: IconCheckCircle, word: 'console.wall_on_target', pill: 'bg-ok-tint text-ok', value: 'text-text', bar: 'bg-ok-solid', edge: 'border-ok-solid/50' },
  bad: { icon: IconAlert, word: 'console.wall_off_target', pill: 'bg-bad-tint text-bad', value: 'text-bad', bar: 'bg-bad-solid', edge: 'border-bad-solid/70' },
  pending: { icon: IconClock, word: 'console.wall_pending', pill: 'bg-surface-3 text-muted', value: 'text-muted', bar: 'bg-line-strong', edge: 'border-line' },
} as const satisfies Record<'ok' | 'bad' | 'pending', { icon: unknown; word: MessageKey; pill: string; value: string; bar: string; edge: string }>;

function MetricTile({ m }: { m: LaunchMetric }) {
  const tone = metricTone(m);
  const s = STATUS[tone];
  const Icon = s.icon;
  const b = bullet(m.key, m.value);
  return (
    <li className={cx('flex flex-col rounded-xl border-2 bg-surface px-7 py-5', s.edge)}>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[28px] font-semibold leading-10">{m.label_ar}</h2>
        <span className={cx('inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-pill px-4 py-1.5 text-xl font-semibold', s.pill)}>
          <Icon size={24} />
          {t(s.word)}
        </span>
      </div>
      <p className={cx('mt-auto pt-3 text-[96px] font-bold leading-none tracking-[-0.03em]', s.value)}>{m.display}</p>
      {b && (
        <div className="relative mt-3 h-3" aria-hidden>
          <span className="absolute inset-0 rounded-pill bg-surface-3" />
          <span className={cx('absolute inset-y-0 start-0 rounded-pill', s.bar)} style={{ width: `${Math.max(b.value, 1.5)}%` }} />
          <span className="absolute -inset-y-1.5 w-1 rounded-pill bg-text" style={{ insetInlineStart: `calc(${b.target}% - 2px)` }} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-2xl">
          <span className="text-muted">{t('console.wall_target')}: </span>
          <span className="font-semibold">{m.target_ar}</span>
        </p>
        {m.hint_ar && <p className="text-xl text-muted">{m.hint_ar}</p>}
      </div>
    </li>
  );
}

/** Orders per day: today in the brand orange, the days before in quiet ink, the 30-a-day line across. */
function OrdersByDay({ days }: { days: LaunchMetricsView['ordersByDay'] }) {
  const TARGET = 30;
  const max = Math.max(TARGET * 1.2, ...days.map((d) => d.orders));
  const bars = dayBars([...days, { orders: max }]).slice(0, days.length);
  const targetPct = (TARGET / max) * 100;
  return (
    <section aria-labelledby="wall-orders" className="rounded-xl border-2 border-line bg-surface px-8 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="wall-orders" className="text-[28px] font-semibold">
          {t('console.wall_orders_by_day')}
        </h2>
        <p className="flex items-center gap-2 text-xl text-muted">
          <span aria-hidden className="inline-block h-0 w-8 border-t-[3px] border-dashed border-text" />
          {t('console.wall_orders_target', { n: TARGET })}
        </p>
      </div>
      <div className="relative">
        <ol className="relative mt-10 flex h-[100px] items-end gap-5">
          {days.map((d, i) => {
            const today = i === days.length - 1;
            const h = Math.max(bars[i] ?? 0, 2);
            return (
              <li key={d.date} className="relative flex h-full flex-1 items-end justify-center">
                <span className={cx('w-full max-w-[160px] rounded-t-md', today ? 'bg-accent' : 'bg-line-strong')} style={{ height: `${h}%` }} />
                <span className={cx('absolute start-1/2 z-[1] translate-x-1/2 rounded-md bg-surface px-2 text-center font-bold', today ? 'text-[34px] leading-10 text-text' : 'text-2xl leading-8 text-muted')} style={{ bottom: `calc(${h}% + 6px)` }}>
                  {d.orders}
                </span>
              </li>
            );
          })}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t-[3px] border-dashed border-text/70" style={{ bottom: `${targetPct}%` }} />
        </ol>
        <ol className="mt-2 flex gap-5 border-t border-line-strong pt-2" aria-hidden>
          {days.map((d, i) => (
            <li key={d.date} className={cx('flex-1 text-center text-xl', i === days.length - 1 ? 'font-semibold text-text' : 'text-muted')}>
              {i === days.length - 1 ? t('console.wall_today') : dayLabel(d.date)}
            </li>
          ))}
        </ol>
      </div>
      <table className="sr-only">
        <caption>{t('console.wall_orders_by_day')}</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{dayLabel(d.date)}</th>
              <td>{d.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
