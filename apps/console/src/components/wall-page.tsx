'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { LaunchMetric, LaunchMetricsView } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useState } from 'react';
import { bullet, dayBars, dayLabel, metricTone, mostUrgentTile, wallStale, wallTrend } from '@/lib/control-room';
import { formatClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { BrandMark } from './shell/brand';
import { cx, IconAlert, IconArrowUp, IconCheckCircle, IconClock, NeedLogin, QueryError } from './ui';

const POLL_MS = 30_000;

/**
 * The week-one metrics wall (launch playbook §6) for the TV in the ops room, read from 3–5 m: full
 * bleed over the shell, dark by default (`?theme=light` for a bright room), six tiles against the
 * playbook targets (status in words and an icon, a bullet bar to the target), orders per day against
 * the 30-a-day target, and a red line across the top when the screen stops updating (S-K6).
 * `?tv=1` hides the way back to the console and fits the whole wall in one screen: 1920×1080 (the TV)
 * at full size, a 1440×900 laptop scaled down by the viewport (K3b), never scrolling.
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
  // S-K6: the one tile worth a look pulses once a minute (the minute is its key, so it replays).
  const urgent = mostUrgentTile(data.metrics);
  const minute = now ? Math.floor(now.getTime() / 60_000) : 0;
  const stale = now ? wallStale(updatedAt, now.getTime()) : false;
  const staleMin = now && updatedAt ? Math.floor((now.getTime() - updatedAt) / 60_000) : 0;
  return (
    <div className={cx('flex flex-col', tv ? 'h-screen overflow-hidden' : 'min-h-screen')} data-tv={tv || undefined}>
      {stale && (
        <p role="alert" className="flex items-center justify-center gap-3 bg-bad-solid px-6 py-3 text-2xl font-bold text-on-bad">
          <IconAlert size={28} />
          {t('console.wall_stale', { n: staleMin, time: formatClock(new Date(updatedAt)) })}
        </p>
      )}
      <div className={cx('mx-auto flex w-full flex-1 flex-col', tv ? TV.frame : 'max-w-[1840px] gap-6 px-10 py-6')}>
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex items-center gap-5">
            <BrandMark size={64} />
            <div>
              <p className={cx('font-semibold text-muted', tv ? TV.kicker : 'text-xl')}>{t('console.wall_kicker')}</p>
              <h1 className={cx('font-bold tracking-[-0.015em]', tv ? TV.title : 'text-[52px] leading-[64px]')}>{t('console.wall_title', { day: data.day })}</h1>
            </div>
          </div>
          <div className="flex items-end gap-10">
            <div className="text-end">
              <p className={cx('text-muted', tv ? TV.kicker : 'text-xl')}>{t('console.wall_met_label')}</p>
              <p className={cx('flex items-center justify-end gap-3 font-bold', tv ? TV.met : 'text-[44px] leading-[56px]')}>
                <span>{t('console.wall_met_short', { n: met, total: data.metrics.length })}</span>
                <span className="flex gap-1.5" aria-hidden>
                  {data.metrics.map((m) => (
                    <span key={m.key} className={cx('h-4 w-4 rounded-pill', m.ok === true ? 'bg-ok-solid' : m.ok === false ? 'bg-bad-solid' : 'border-2 border-line-strong')} />
                  ))}
                </span>
              </p>
            </div>
            <div className="text-end">
              <p className={cx('font-bold tracking-[-0.02em]', tv ? TV.clock : 'text-[64px] leading-[72px]')} suppressHydrationWarning>
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

        <ul className={cx('grid flex-1', tv ? TV.tiles : 'grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 xl:grid-rows-2')}>
          {data.metrics.map((m) => (
            <MetricTile key={m.key} m={m} pulseKey={m.key === urgent ? minute : null} tv={tv} />
          ))}
        </ul>

        <OrdersByDay days={data.ordersByDay} tv={tv} />
      </div>
    </div>
  );
}

/**
 * TV mode sizes (K3b): the 1920×1080 sizes, shrunk with the viewport's height and width so a
 * 1440×900 laptop shows the whole wall, chart included, without scrolling.
 */
const TV = {
  frame: 'max-w-[1920px] min-h-0 gap-[min(2.2vh,1.25vw)] px-[min(2.5vw,48px)] py-[min(2.2vh,24px)]',
  kicker: 'text-[clamp(15px,min(1.85vh,1.05vw),20px)]',
  title: 'text-[clamp(32px,min(4.8vh,2.7vw),52px)] leading-[1.2]',
  met: 'text-[clamp(28px,min(4.1vh,2.3vw),44px)] leading-[1.25]',
  clock: 'text-[clamp(40px,min(5.9vh,3.35vw),64px)] leading-[1.1]',
  tiles: 'min-h-0 grid-cols-3 grid-rows-2 gap-[min(1.85vh,1.05vw)]',
  tile: 'min-h-0 overflow-hidden px-[min(2.6vh,1.45vw)] py-[min(1.85vh,1.05vw)]',
  tileTitle: 'text-[clamp(20px,min(2.6vh,1.45vw),28px)] leading-[1.35]',
  pill: 'gap-[0.4em] px-[0.8em] py-[0.3em] text-[clamp(15px,min(1.85vh,1.05vw),20px)]',
  value: 'text-[clamp(52px,min(8.9vh,5vw),96px)]',
  trend: 'text-[clamp(17px,min(2.2vh,1.25vw),24px)]',
  foot: 'text-[clamp(16px,min(2.2vh,1.25vw),24px)]',
  chart: 'px-[min(3vh,1.65vw)] py-[min(1.5vh,0.85vw)]',
  bars: 'mt-[min(5vh,2.8vw)] h-[clamp(48px,min(8.4vh,4.7vw),100px)]',
  todayNum: 'text-[clamp(22px,min(3.1vh,1.75vw),34px)] leading-[1.2]',
  dayNum: 'text-[clamp(16px,min(2.2vh,1.25vw),24px)] leading-[1.3]',
} as const;

const STATUS = {
  ok: { icon: IconCheckCircle, word: 'console.wall_on_target', pill: 'bg-ok-tint text-ok', value: 'text-text', bar: 'bg-ok-solid', edge: 'border-ok-solid/50' },
  bad: { icon: IconAlert, word: 'console.wall_off_target', pill: 'bg-bad-tint text-bad', value: 'text-bad', bar: 'bg-bad-solid', edge: 'border-bad-solid/70' },
  pending: { icon: IconClock, word: 'console.wall_pending', pill: 'bg-surface-3 text-muted', value: 'text-muted', bar: 'bg-line-strong', edge: 'border-line' },
} as const satisfies Record<'ok' | 'bad' | 'pending', { icon: unknown; word: MessageKey; pill: string; value: string; bar: string; edge: string }>;

function MetricTile({ m, pulseKey = null, tv = false }: { m: LaunchMetric; pulseKey?: number | null; tv?: boolean }) {
  const tone = metricTone(m);
  const s = STATUS[tone];
  const Icon = s.icon;
  const b = bullet(m.key, m.value);
  const trend = wallTrend(m);
  return (
    <li className={cx('relative flex flex-col rounded-xl border-2 bg-surface', tv ? TV.tile : 'px-7 py-5', s.edge)} data-urgent={pulseKey !== null || undefined}>
      {/* S-K6: once a minute, one ring swells out of the most urgent off-target tile (none with reduce motion). */}
      {pulseKey !== null ? <span key={pulseKey} aria-hidden className="wall-pulse pointer-events-none absolute -inset-[2px] rounded-xl" /> : null}
      <div className="flex items-start justify-between gap-4">
        <h2 className={cx('font-semibold', tv ? TV.tileTitle : 'text-[28px] leading-10')}>{m.label_ar}</h2>
        <span className={cx('inline-flex shrink-0 items-center whitespace-nowrap rounded-pill font-semibold', tv ? TV.pill : 'gap-2 px-4 py-1.5 text-xl', s.pill)}>
          <Icon size={24} className={tv ? 'h-[1.2em] w-[1.2em]' : undefined} />
          {t(s.word)}
        </span>
      </div>
      <div className={cx('mt-auto flex items-end justify-between gap-4', tv ? 'pt-[1vh]' : 'pt-3')}>
        <p className={cx('shrink-0 whitespace-nowrap font-bold leading-none tracking-[-0.03em]', tv ? TV.value : 'text-[96px]', s.value)}>{m.display}</p>
        {trend ? (
          <p
            className={cx('flex min-w-0 items-center gap-2 pb-2 font-semibold leading-[1.3]', tv ? TV.trend : 'text-2xl', trend.good === true ? 'text-ok' : trend.good === false ? 'text-bad' : 'text-muted')}
            aria-label={t('console.wall_trend_a11y', { label: m.label_ar, direction: t(`console.wall_vs_yesterday_${trend.dir}`), value: trend.previous })}
          >
            {trend.dir === 'flat' ? <span aria-hidden className="inline-block h-[3px] w-6 rounded-pill bg-current" /> : <IconArrowUp size={30} className={cx('shrink-0', tv && 'h-[1.25em] w-[1.25em]', trend.dir === 'down' && 'rotate-180')} />}
            <span className="num">{t('console.wall_vs_yesterday', { value: trend.previous })}</span>
          </p>
        ) : null}
      </div>
      {b && (
        <div className="relative mt-3 h-3" aria-hidden>
          <span className="absolute inset-0 rounded-pill bg-surface-3" />
          <span className={cx('absolute inset-y-0 start-0 rounded-pill', s.bar)} style={{ width: `${Math.max(b.value, 1.5)}%` }} />
          <span className="absolute -inset-y-1.5 w-1 rounded-pill bg-text" style={{ insetInlineStart: `calc(${b.target}% - 2px)` }} />
        </div>
      )}
      <div className={cx('flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1', tv ? 'mt-[1.4vh]' : 'mt-4')}>
        <p className={tv ? TV.foot : 'text-2xl'}>
          <span className="text-muted">{t('console.wall_target')}: </span>
          <span className="font-semibold">{m.target_ar}</span>
        </p>
        {m.hint_ar && <p className={cx('text-muted', tv ? TV.foot : 'text-2xl')}>{m.hint_ar}</p>}
      </div>
    </li>
  );
}

/** Orders per day: today in the brand orange, the days before in quiet ink, the 30-a-day line across. */
function OrdersByDay({ days, tv = false }: { days: LaunchMetricsView['ordersByDay']; tv?: boolean }) {
  const TARGET = 30;
  const max = Math.max(TARGET * 1.2, ...days.map((d) => d.orders));
  const bars = dayBars([...days, { orders: max }]).slice(0, days.length);
  const targetPct = (TARGET / max) * 100;
  return (
    <section aria-labelledby="wall-orders" className={cx('shrink-0 rounded-xl border-2 border-line bg-surface', tv ? TV.chart : 'px-8 py-4')}>
      <div className={cx('flex items-baseline justify-between gap-4', tv ? 'mb-[0.6vh]' : 'mb-3')}>
        <h2 id="wall-orders" className={cx('font-semibold', tv ? TV.tileTitle : 'text-[28px]')}>
          {t('console.wall_orders_by_day')}
        </h2>
        <p className={cx('flex items-center gap-2 text-muted', tv ? TV.foot : 'text-2xl')}>
          <span aria-hidden className="inline-block h-0 w-8 border-t-[3px] border-dashed border-text" />
          {t('console.wall_orders_target', { n: TARGET })}
        </p>
      </div>
      <div className="relative">
        <ol className={cx('relative flex items-end gap-5', tv ? TV.bars : 'mt-10 h-[100px]')}>
          {days.map((d, i) => {
            const today = i === days.length - 1;
            const h = Math.max(bars[i] ?? 0, 2);
            return (
              <li key={d.date} className="relative flex h-full flex-1 items-end justify-center">
                <span className={cx('w-full max-w-[160px] rounded-t-md', today ? 'bg-accent' : 'bg-line-strong')} style={{ height: `${h}%` }} />
                <span
                  className={cx('absolute start-1/2 z-[1] translate-x-1/2 rounded-md bg-surface px-2 text-center font-bold', today ? (tv ? TV.todayNum : 'text-[34px] leading-10') : tv ? TV.dayNum : 'text-2xl leading-8', today ? 'text-text' : 'text-muted')}
                  style={{ bottom: `calc(${h}% + 6px)` }}
                >
                  {d.orders}
                </span>
              </li>
            );
          })}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t-[3px] border-dashed border-text/70" style={{ bottom: `${targetPct}%` }} />
        </ol>
        <ol className="mt-2 flex gap-5 border-t border-line-strong pt-2" aria-hidden>
          {days.map((d, i) => (
            <li key={d.date} className={cx('flex-1 text-center', tv ? TV.dayNum : 'text-2xl', i === days.length - 1 ? 'font-semibold text-text' : 'text-muted')}>
              {i === days.length - 1 ? t('console.wall_today') : dayLabel(d.date)}
            </li>
          ))}
        </ol>
      </div>
      {/* A table keeps its rows' height even when visually hidden: the wrapper is what hides it. */}
      <div className="sr-only">
        <table>
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
      </div>
    </section>
  );
}
