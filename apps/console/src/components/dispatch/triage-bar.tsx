'use client';

import Link from 'next/link';
import type { RightNow as ServerRightNow } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useState } from 'react';
import { outboxHealth, rightNow, serverNowTiles, type NowTile } from '@/lib/board';
import { ageText } from '@/lib/safety';
import type { Triage } from '@/lib/dispatch';
import { cx, IconAlert, IconCheckCircle, IconChevronDown, IconControls, Kbd, Popover } from '../ui';
import { setMuted, useMuted } from './sound';

/**
 * S-K1 · the triage bar: what needs me now, then five numbers. The needs-dispatcher block is the one
 * loud thing on the page (count, the oldest wait ticking, "خذه" with its key). The rest of the old
 * thirteen tiles sit behind "تفاصيل". K-06: numbers the board can't vouch for read "—".
 */

const TILE_KEY: Record<NowTile['key'], MessageKey> = {
  orders_hour: 'console.triage_orders_hour',
  drivers: 'console.now_drivers_online',
  time_to_accept: 'console.triage_accept',
  late: 'console.now_late',
  cash_field: 'console.now_cash_field',
  outbox: 'console.now_outbox',
};
const MAIN: NowTile['key'][] = ['orders_hour', 'drivers', 'time_to_accept', 'late', 'cash_field'];

export function TriageBar({
  tri,
  oldestSec,
  local,
  known,
  server,
  serverError,
  onTake,
  blocked,
}: {
  tri: Triage;
  oldestSec: number | null;
  local: ReturnType<typeof rightNow>;
  known: boolean;
  server: ServerRightNow | undefined;
  serverError: boolean;
  onTake: () => void;
  blocked: boolean;
}) {
  const [more, setMore] = useState(false);
  const muted = useMuted();
  const tiles = serverNowTiles(server);
  const tile = (k: NowTile['key']) => tiles.find((x) => x.key === k)!;
  const loud = known && tri.needs > 0;
  const health = server ? outboxHealth(server.outbox) : 'ok';
  const v = (x: string | number) => (known ? x : '—');

  return (
    <section aria-label={t('console.now_bar')} className="flex min-w-0 flex-1 flex-wrap items-stretch gap-x-1 gap-y-2">
      {/* Announce the count only: the ticking oldest-wait clock would chatter every second. */}
      <p className="sr-only" role="status" aria-live="polite">
        {loud ? `${tri.needs} ${tri.needs === 1 ? t('console.triage_needs_one') : t('console.triage_needs')}` : known ? t('console.triage_clear') : ''}
      </p>
      {/* The lamp: needs a dispatcher. */}
      <div
        className={cx(
          'flex shrink-0 items-center gap-3 rounded-lg border px-3 py-1.5',
          loud ? 'border-bad/50 bg-bad-tint' : 'border-line bg-surface',
        )}
      >
        <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-pill', loud ? 'bg-bad-solid text-on-bad' : 'bg-ok-tint text-ok')} aria-hidden>
          {loud ? <IconAlert size={18} /> : <IconCheckCircle size={18} />}
        </span>
        {loud ? (
          <span className="min-w-0 leading-tight">
            <span className="flex items-baseline gap-1.5 text-bad">
              <span className="num text-[22px] font-bold leading-7">{tri.needs}</span>
              <span className="text-sm font-semibold">{tri.needs === 1 ? t('console.triage_needs_one') : t('console.triage_needs')}</span>
            </span>
            <span className="num block text-xs text-text">{t('console.triage_oldest', { time: oldestSec === null ? '—' : ageText(oldestSec * 1000) })}</span>
          </span>
        ) : (
          <span className="text-sm font-medium text-text">{known ? t('console.triage_clear') : t('console.triage_unknown')}</span>
        )}
        {loud ? (
          <button
            type="button"
            onClick={onTake}
            className="ms-1 inline-flex h-9 items-center gap-2 rounded-md bg-bad-solid px-3 text-sm font-semibold text-on-bad shadow-card hover:opacity-90"
          >
            {t('console.triage_take')}
            <Kbd tone="inverse" className="border-on-bad/30 bg-on-bad/15 text-on-bad">
              A
            </Kbd>
          </button>
        ) : null}
      </div>

      {/* Five numbers, one row: label over value, hairlines between. */}
      <dl className="flex min-w-[min(100%,400px)] flex-1 items-center py-1">
        {MAIN.map((k) => {
          const x = tile(k);
          const alert = k === 'late' ? x.alert : false;
          return (
            <div key={k} className={cx('min-w-0 border-e border-line px-3.5 last:border-e-0', k === 'cash_field' ? 'flex-[1.45]' : 'flex-1')}>
              <dt className="truncate text-xs text-muted">{t(TILE_KEY[k])}</dt>
              <dd
                className={cx('num whitespace-nowrap text-[17px] font-semibold leading-7', alert ? 'text-bad' : 'text-text')}
                title={k === 'cash_field' && x.value !== '—' ? `${x.value} ${t('console.iqd')}` : undefined}
              >
                {x.value}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="flex shrink-0 items-center gap-1">
        <div className="relative">
          <button
            type="button"
            data-triage-more
            aria-expanded={more}
            onClick={() => setMore((m) => !m)}
            className="inline-flex h-11 items-center gap-1 rounded-md px-3 text-sm text-muted hover:bg-surface-2 hover:text-text aria-expanded:bg-surface-2 aria-expanded:text-text"
          >
            {t('console.triage_more')}
            <IconChevronDown size={16} />
          </button>
          <Popover open={more} onClose={() => setMore(false)} align="end" className="w-[340px] p-0">
            <div className="p-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                {(
                  [
                    ['console.now_searching', v(local.searching)],
                    ['console.now_offered', v(local.offered)],
                    ['console.now_assigned', v(local.assigned)],
                    ['console.now_red', v(local.red)],
                    ['console.now_avg_wait', v(local.avgWaitSec === null ? '—' : ageText(local.avgWaitSec * 1000))],
                    ['console.now_compensated', v(local.compensated)],
                    ['console.now_outbox', tile('outbox').value],
                  ] as Array<[MessageKey, string | number]>
                ).map(([k, val]) => (
                  <div key={k} className={cx('flex items-baseline justify-between gap-3 border-b border-line/70 pb-1.5', k === 'console.now_outbox' && 'col-span-2')}>
                    <dt className="text-muted">{t(k)}</dt>
                    <dd className="num whitespace-nowrap font-semibold">{val}</dd>
                  </div>
                ))}
              </dl>
              <p className={cx('mt-3 text-xs', health === 'ok' && !serverError ? 'text-faint' : 'text-warn')}>
                {serverError ? t('console.now_unavailable') : health === 'failing' ? t('console.now_outbox_failing') : health === 'backlog' ? t('console.now_outbox_backlog') : t('console.now_outbox_hint')}
              </p>
            </div>
            <Link href="/controls#dispatch-modes" className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm text-accent-text hover:bg-surface-2">
              <IconControls size={16} />
              {t('console.modes_link')}
            </Link>
          </Popover>
        </div>
        <button
          type="button"
          aria-pressed={!muted}
          onClick={() => setMuted(!muted)}
          title={muted ? t('console.sound_off') : blocked ? t('console.sound_blocked') : t('console.sound_on')}
          aria-label={muted ? t('console.sound_off') : blocked ? t('console.sound_blocked') : t('console.sound_on')}
          className={cx(
            'inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-sm',
            muted ? 'text-muted hover:bg-surface-2 hover:text-text' : blocked ? 'bg-warn-tint text-warn' : 'text-text hover:bg-surface-2',
          )}
        >
          <SpeakerIcon muted={muted} />
          <span className="hidden 2xl:inline">{muted ? t('console.sound_muted_short') : blocked ? t('console.sound_blocked_short') : t('console.sound_on_short')}</span>
          <Kbd>M</Kbd>
        </button>
      </div>
    </section>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z" />
      {muted ? <path d="m13.5 7.5 4 5m0-5-4 5" /> : <path d="M13.5 7a4 4 0 0 1 0 6M15.8 5a7 7 0 0 1 0 10" />}
    </svg>
  );
}
