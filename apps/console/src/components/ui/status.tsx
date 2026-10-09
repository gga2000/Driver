'use client';

import Link from 'next/link';
import { agoText, connectionBanner, NET_RULES } from '@driver/contracts/net-client';
import { t } from '@driver/i18n';
import { useEffect, useRef, useState } from 'react';
import { formatClock } from '@/lib/format';
import { useConsoleLiveMode } from '@/lib/live';
import { consoleNetwork, errorText, useConsoleNetwork } from '@/lib/network';
import { buttonCls } from './button';
import { StatusDot } from './badge';
import { EmptyState } from './empty';
import { IconAlert, IconLock } from './icons';

/** Live data honesty (K-06), errors in Arabic, the sign-in prompt. Logic unchanged from the first kit. */

interface TrpcLikeError {
  message: string;
  data?: unknown;
}

/** HTTP status tRPC puts on every error shape (`data.httpStatus`), if any. */
export function httpStatusOf(error: unknown): number | undefined {
  const data = (error as { data?: { httpStatus?: unknown } | null } | null)?.data;
  return typeof data?.httpStatus === 'number' ? data.httpStatus : undefined;
}

/** 401 → sign-in prompt, 403 → no access, else the server's Arabic message with a retry. */
export function QueryError({ error, onRetry }: { error: TrpcLikeError; onRetry?: () => void }) {
  const status = httpStatusOf(error);
  if (status === 401) {
    return (
      <EmptyState title={t('console.need_login')} icon={<IconLock size={20} />}>
        <Link href="/login" className={buttonCls('primary')}>
          {t('console.login')}
        </Link>
      </EmptyState>
    );
  }
  if (status === 403)
    return <EmptyState title={t('console.need_role')} icon={<IconLock size={20} />} />;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bad/30 bg-bad-tint px-4 py-3 text-sm text-text"
    >
      <p className="flex items-center gap-2">
        <IconAlert size={18} className="shrink-0 text-bad" />
        {t('console.load_failed', { message: errorText(error) })}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={buttonCls('secondary', 'sm')}>
          {t('console.retry')}
        </button>
      )}
    </div>
  );
}

/** Shown instead of a page body while signed out (protected procedures would only 401). */
export function NeedLogin() {
  return <QueryError error={{ message: '', data: { httpStatus: 401 } }} />;
}

/** `Date.now()`, re-rendering every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * When data on a page counts as stale: well past its own refresh interval (3 polls, at least 45 s);
 * with the live stream up, past the 60-s safety refetch.
 */
export function staleAfterMs(seconds: number, live: boolean): number {
  return live ? 90_000 : Math.max(NET_RULES.staleAfterMs, seconds * 3_000);
}

/** Past this age data is "very old" (red), whatever the page's own refresh rate. */
export const VERY_OLD_MS = 120_000;

/** fresh → stale (amber, past the page's own threshold) → old (red, past 2 minutes). */
export function staleLevel(ageMs: number | null, seconds: number, live: boolean): 'fresh' | 'stale' | 'old' {
  if (ageMs === null) return 'fresh';
  const amber = staleAfterMs(seconds, live);
  if (ageMs > Math.max(VERY_OLD_MS, amber)) return 'old';
  return ageMs > amber ? 'stale' : 'fresh';
}

/**
 * "يتحدّث كل 2 ثانية · آخر تحديث 7:05 م" with a pulsing dot while fetching — and honest when it isn't
 * (K-06): a red dot and "مقطوع" when the API can't be reached, an amber "البيانات قديمة" when stale.
 */
export function LiveBadge({
  seconds,
  updatedAt,
  fetching,
  error,
  compact = false,
}: {
  seconds: number;
  updatedAt?: number;
  fetching?: boolean;
  error?: boolean;
  compact?: boolean;
}) {
  const net = useConsoleNetwork();
  const live = useConsoleLiveMode() === 'live';
  const now = useNow(1000);
  const age = updatedAt ? now - updatedAt : null;
  const down = net.state !== 'online';
  const level = staleLevel(age, seconds, live);
  const old = !down && level === 'old';
  const stale = !down && !old && (Boolean(error) || level === 'stale');
  const ago = age !== null ? agoText(age / 1000, (k, p) => t(k, p)) : null;
  if (down || stale || old) {
    const red = down || old;
    return (
      <p
        data-testid="live-badge"
        data-state={down ? 'down' : old ? 'old' : 'stale'}
        className={`inline-flex items-center gap-2 rounded-pill px-2.5 py-1 text-xs font-semibold ${red ? 'bg-bad-tint text-bad' : 'bg-warn-tint text-warn'}`}
        role="status"
      >
        <StatusDot tone={red ? 'bad' : 'warn'} />
        {down
          ? t('console.live_down')
          : old
            ? t('console.live_very_old', { ago: ago ?? '—' })
            : t('console.live_stale', { ago: ago ?? '—' })}
        {down && ago ? (
          <span className="font-normal text-muted">· {t('console.updated_at', { time: ago })}</span>
        ) : null}
      </p>
    );
  }
  if (compact) {
    const label = `${t('console.live_every', { seconds })}${updatedAt ? ` · ${t('console.updated_at', { time: formatClock(new Date(updatedAt)) })}` : ''}`;
    return (
      <span
        data-testid="live-badge"
        data-state="live"
        title={label}
        className="inline-flex h-8 w-8 items-center justify-center"
      >
        <StatusDot tone="ok" pulse={fetching} />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <p
      data-testid="live-badge"
      data-state="live"
      className="inline-flex items-center gap-2 text-xs text-muted"
      aria-live="off"
    >
      <StatusDot tone="ok" pulse={fetching} />
      {t('console.live_every', { seconds })}
      {updatedAt ? (
        <span className="num">
          · {t('console.updated_at', { time: formatClock(new Date(updatedAt)) })}
        </span>
      ) : null}
    </p>
  );
}

/**
 * The connection strip at the top of every page: "النت مقطوع. نحاول نرجع…" / "ما نگدر نوصل للسيرفر.
 * نحاول كل 5 ثواني" (with "جرّب مرة ثانية"), then "رجع الاتصال" for a moment.
 */
export function NetworkBanner() {
  const net = useConsoleNetwork();
  const now = useNow(1000);
  const kind = connectionBanner({ net, now });
  if (!kind || kind === 'stale') return null;
  const tone = kind === 'back' ? 'border-ok/30 bg-ok-tint' : 'border-bad/30 bg-bad-tint';
  return (
    <div
      role="status"
      data-testid={`net-banner-${kind}`}
      className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm font-semibold text-text ${tone}`}
    >
      <span className="flex items-center gap-2">
        <StatusDot tone={kind === 'back' ? 'ok' : 'bad'} pulse={kind !== 'back'} />
        {kind === 'offline'
          ? t('console.net_offline')
          : kind === 'unreachable'
            ? t('console.net_unreachable')
            : t('console.live_back')}
        {kind !== 'back' ? (
          <span className="font-normal text-muted">· {t('console.offline_frozen')}</span>
        ) : null}
      </span>
      {kind === 'unreachable' ? (
        <button
          type="button"
          className={buttonCls('secondary', 'sm')}
          onClick={() => consoleNetwork().retryNow()}
        >
          {t('console.retry')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * In a dialog's footer while offline: why the send button is greyed. Nothing is queued, so it says
 * plainly that it won't go by itself later.
 */
export function OfflineNote({ className }: { className?: string }) {
  const net = useConsoleNetwork();
  if (net.state === 'online') return null;
  return (
    <p role="status" className={`flex max-w-[46ch] items-start gap-2 text-xs font-medium text-bad ${className ?? ''}`}>
      <StatusDot tone="bad" />
      {t('console.offline_not_sent')}
    </p>
  );
}

/** Seconds since mount, ticking once a second (used to count countdowns down between polls). */
export function useSecondsSince(resetKey: unknown): number {
  const [n, setN] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => {
    start.current = Date.now();
    setN(0);
    const id = window.setInterval(
      () => setN(Math.floor((Date.now() - start.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [resetKey]);
  return n;
}
