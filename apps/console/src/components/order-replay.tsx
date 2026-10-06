'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock } from '@/lib/format';
import { queryRetry } from '@/lib/live';
import { eventLabel } from '@/lib/orders';
import { useTheme } from '@/lib/prefs';
import { REPLAY_SPEEDS, replayPath, replaySpan, type ReplaySpeed } from '@/lib/replay';
import { useTRPC } from '@/lib/trpc';
import { Button, cx, EmptyState, QueryError, Segmented } from './ui';

const ReplayMap = dynamic(() => import('./replay-map'), { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-surface-2" /> });

/**
 * Replay any order (maps program o2): the courier's stored path on a map, played at 10×, 30× or 60×
 * real time or scrubbed by hand, with its moments (accepted, arrived, picked up, delivered) marked
 * on the timeline — a tap jumps there. "He never came" is settled in seconds. Trails live 30 days.
 */
export function OrderReplay({ orderId }: { orderId: string }) {
  const trpc = useTRPC();
  const theme = useTheme();
  const q = useQuery({ ...trpc.orders.replay.queryOptions({ orderId }), retry: queryRetry, staleTime: 60_000 });
  const replay = q.data;
  const path = useMemo(() => (replay ? replayPath(replay) : []), [replay]);
  const span = useMemo(() => (replay ? replaySpan(replay) : null), [replay]);
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(30);
  const now = at ?? span?.from ?? 0;

  // Playback: advance `speed` × real time per animation frame; stop at the end.
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !span) return;
    let raf = 0;
    const step = (ts: number) => {
      const prev = last.current ?? ts;
      last.current = ts;
      setAt((cur) => {
        const next = (cur ?? span.from) + (ts - prev) * speed;
        if (next >= span.to) {
          setPlaying(false);
          return span.to;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, speed, span]);

  return (
    <section aria-labelledby="order-replay" className="mt-5 rounded-lg border border-line bg-surface shadow-card" data-testid="order-replay">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="order-replay" className="text-base font-semibold">
          {t('console.replay_title')}
        </h2>
        {path.length > 1 && span ? (
          <div className="flex items-center gap-2">
            <Segmented
              size="sm"
              label={t('console.replay_speed_label')}
              value={String(speed)}
              onChange={(v) => setSpeed(Number(v) as ReplaySpeed)}
              options={REPLAY_SPEEDS.map((s) => ({ value: String(s), label: t('console.replay_speed', { x: s }) }))}
            />
            <Button size="sm" variant="primary" data-testid="replay-play" onClick={() => (now >= span.to ? (setAt(span.from), setPlaying(true)) : setPlaying((p) => !p))}>
              {playing ? t('console.replay_pause') : now >= span.to ? t('console.replay_again') : t('console.replay_play')}
            </Button>
          </div>
        ) : null}
      </header>
      {q.isError ? (
        <div className="p-4">
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !replay ? (
        <div className="h-[340px] animate-pulse bg-surface-2/60" />
      ) : path.length < 2 || !span ? (
        <EmptyState bare title={replay.trailPurged ? t('console.replay_purged') : t('console.replay_empty')} hint={replay.trailPurged ? t('console.replay_purged_hint') : undefined} />
      ) : (
        <>
          <div className="relative h-[340px] overflow-hidden">
            <ReplayMap replay={replay} path={path} t={now} theme={theme === 'light' ? 'light' : 'dark'} />
            <span className="num absolute start-3 top-3 z-10 rounded-md bg-surface/95 px-2.5 py-1 text-sm font-semibold shadow-card" data-testid="replay-clock">
              {formatClock(new Date(now))}
            </span>
          </div>
          <div className="space-y-2 px-4 py-3">
            <input
              type="range"
              className="w-full accent-accent"
              aria-label={t('console.replay_scrub')}
              data-testid="replay-scrub"
              min={span.from}
              max={span.to}
              step={1000}
              value={now}
              onChange={(e) => {
                setPlaying(false);
                setAt(Number(e.target.value));
              }}
            />
            <ul className="flex flex-wrap gap-1.5">
              {replay.marks.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      setAt(m.at.getTime());
                    }}
                    className={cx('rounded-full border px-2.5 py-1 text-xs', m.at.getTime() <= now ? 'border-accent/60 bg-accent/10' : 'border-line text-muted')}
                  >
                    <span className="num">{formatClock(m.at)}</span> · {eventLabel(m.type)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
