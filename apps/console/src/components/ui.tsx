'use client';

import Link from 'next/link';
import { agoText, connectionBanner, NET_RULES } from '@driver/contracts/net-client';
import { t } from '@driver/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatClock } from '@/lib/format';
import { useConsoleLiveMode } from '@/lib/live';
import { consoleNetwork, errorText, useConsoleNetwork } from '@/lib/network';

/** Shared building blocks for the console pages (dark theme roles from globals.css). */

export const inputCls =
  'w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint disabled:opacity-50';
export const ghostBtn =
  'inline-flex items-center justify-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm hover:border-muted disabled:opacity-50 aria-pressed:border-accent aria-pressed:text-accent';
export const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-50';
export const dangerBtn =
  'inline-flex items-center justify-center gap-2 rounded-md border border-danger-500 bg-danger-500/15 px-3 py-2 text-sm font-semibold text-text hover:bg-danger-500/30 disabled:opacity-50';

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </header>
  );
}

export function Card({
  title,
  children,
  className = '',
  actions,
  tone = 'default',
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  tone?: 'default' | 'bad' | 'ok';
}) {
  const border = tone === 'bad' ? 'border-bad' : tone === 'ok' ? 'border-ok' : 'border-line';
  return (
    <section className={`rounded-xl border ${border} bg-surface p-4 shadow-card md:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'bad' | 'ok' | 'accent' }) {
  const color = tone === 'bad' ? 'text-bad' : tone === 'ok' ? 'text-ok' : tone === 'accent' ? 'text-accent-strong' : 'text-text';
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 font-display text-xl font-bold tabular-nums ${color}`}>{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-faint">{hint}</dd>}
    </div>
  );
}

export type ChipTone = 'neutral' | 'live' | 'ready' | 'done' | 'bad' | 'warn' | 'accent';

const CHIP: Record<ChipTone, string> = {
  neutral: 'border-line bg-surface-2 text-muted',
  live: 'border-info-500 bg-info-500/15 text-info-100',
  ready: 'border-primary-500 bg-primary-500/15 text-primary-300',
  done: 'border-success-500 bg-success-500/15 text-success-100',
  bad: 'border-danger-500 bg-danger-500/15 text-danger-100',
  warn: 'border-primary-500/60 bg-primary-500/10 text-accent',
  accent: 'border-accent bg-accent text-on-accent',
};

export function Chip({ tone = 'neutral', children, title }: { tone?: ChipTone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-pill border px-2 py-0.5 text-xs font-medium ${CHIP[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

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
      <EmptyState title={t('console.need_login')}>
        <Link href="/login" className={primaryBtn}>
          {t('console.login')}
        </Link>
      </EmptyState>
    );
  }
  if (status === 403) return <EmptyState title={t('console.need_role')} />;
  return (
    <div role="alert" className="rounded-xl border border-danger-500 bg-danger-500/10 px-4 py-3 text-sm">
      <p>{t('console.load_failed', { message: errorText(error) })}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={`${ghostBtn} mt-2`}>
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

/**
 * "يتحدّث كل 2 ثانية · آخر تحديث 7:05 م" with a pulsing dot while fetching — and honest when it isn't
 * (K-06): a red dot and "مقطوع" when the API can't be reached, an amber "البيانات قديمة: آخر تحديث قبل
 * 40 ثانية" when the data is older than it should be.
 */
export function LiveBadge({ seconds, updatedAt, fetching, error }: { seconds: number; updatedAt?: number; fetching?: boolean; error?: boolean }) {
  const net = useConsoleNetwork();
  const live = useConsoleLiveMode() === 'live';
  const now = useNow(1000);
  const age = updatedAt ? now - updatedAt : null;
  const down = net.state !== 'online';
  const stale = !down && (Boolean(error) || (age !== null && age > staleAfterMs(seconds, live)));
  const ago = age !== null ? agoText(age / 1000, (k, p) => t(k, p)) : null;
  if (down || stale) {
    return (
      <p data-testid="live-badge" data-state={down ? 'down' : 'stale'} className={`flex items-center gap-2 text-xs font-semibold ${down ? 'text-bad' : 'text-accent'}`} role="status">
        <span aria-hidden className={`inline-block h-2 w-2 rounded-pill ${down ? 'bg-bad' : 'bg-accent'}`} />
        {down ? t('console.live_down') : t('console.live_stale', { ago: ago ?? '—' })}
        {down && ago ? <span className="font-normal text-muted">· {t('console.updated_at', { time: ago })}</span> : null}
      </p>
    );
  }
  return (
    <p data-testid="live-badge" data-state="live" className="flex items-center gap-2 text-xs text-muted" aria-live="off">
      <span aria-hidden className={`inline-block h-2 w-2 rounded-pill bg-ok ${fetching ? 'animate-pulse' : ''}`} />
      {t('console.live_every', { seconds })}
      {updatedAt ? <span>· {t('console.updated_at', { time: formatClock(new Date(updatedAt)) })}</span> : null}
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
  const tone =
    kind === 'back' ? 'border-success-500 bg-success-500/15 text-success-100' : 'border-danger-500 bg-danger-500/15 text-danger-100';
  return (
    <div role="status" data-testid={`net-banner-${kind}`} className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-semibold ${tone}`}>
      <span>{kind === 'offline' ? t('console.net_offline') : kind === 'unreachable' ? t('console.net_unreachable') : t('console.live_back')}</span>
      {kind === 'unreachable' ? (
        <button type="button" className={ghostBtn} onClick={() => consoleNetwork().retryNow()}>
          {t('console.retry')}
        </button>
      ) : null}
    </div>
  );
}

/** Loading placeholder: a pulsing block sized by `className` (first load only; refetches keep data). */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}

/** Seconds since mount, ticking once a second (used to count countdowns down between polls). */
export function useSecondsSince(resetKey: unknown): number {
  const [n, setN] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => {
    start.current = Date.now();
    setN(0);
    const id = window.setInterval(() => setN(Math.floor((Date.now() - start.current) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [resetKey]);
  return n;
}

/**
 * Side drawer: from the end edge (left in RTL) on desktop, a bottom sheet on phones. Escape closes;
 * focus moves into the drawer when it opens.
 */
export function Drawer({ open, title, onClose, children }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={typeof title === 'string' ? title : undefined}
      className="absolute inset-x-0 bottom-0 z-20 max-h-[70%] overflow-y-auto rounded-t-xl border border-line bg-surface p-4 shadow-card md:inset-x-auto md:bottom-auto md:end-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-96 md:rounded-xl"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className={ghostBtn} aria-label={t('console.close')}>
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

/** A definition row for drawers and detail cards. */
export function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-1.5 text-sm last:border-b-0">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 text-end">{v}</dd>
    </div>
  );
}

/** Monospace id that stays LTR inside Arabic text. */
export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <bdi dir="ltr" title={title} className="font-mono text-xs">
      {children}
    </bdi>
  );
}
