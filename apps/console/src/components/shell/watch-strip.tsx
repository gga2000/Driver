'use client';

import { useMutation } from '@tanstack/react-query';
import { CONSOLE_WATCH_RULES, ON_CALL_READ_ROLES, type ConsoleLiveState } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useRef, useState } from 'react';
import { CITY_ID, useConsoleLiveMode } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { IconAlert, useNow } from '../ui';

const HEIGHT = 44;

/** One id per browser tab, kept while the tab lives (a reload keeps it). */
function tabId(): string {
  const fresh = () => `tab_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  try {
    const kept = window.sessionStorage.getItem('console.tab');
    if (kept && kept.length >= 8) return kept;
    const id = fresh();
    window.sessionStorage.setItem('console.tab', id);
    return id;
  } catch {
    return fresh();
  }
}

/**
 * The Console watching itself (E1 step 3, Ali 2026-10-08). Every open screen tells the server "I'm
 * here" every 30 s with the state of its live updates; when nobody has a screen open during working
 * hours, or live updates are down on every screen, the server tells the people on call.
 *
 * Here: a red strip under the other strips while this screen's live updates have been down for a
 * minute (or the server says they are down everywhere). Its height is published as `--watch-h` so
 * full-height pages shrink by it.
 */
export function LiveDownStrip() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  const allowed = signedIn && loaded && hasAny(roles, ON_CALL_READ_ROLES);
  const mode = useConsoleLiveMode();
  const now = useNow(5_000);
  const present = useMutation(trpc.onCall.present.mutationOptions({ retry: false }));
  const send = useRef(present.mutate);
  send.current = present.mutate;

  // When this screen's live updates last stopped (null while live, or when no page uses them).
  const [downSince, setDownSince] = useState<number | null>(null);
  useEffect(() => {
    const down = mode === 'fallback' || mode === 'connecting';
    setDownSince((was) => (down ? (was ?? Date.now()) : null));
  }, [mode]);

  // The heartbeat: at once, on every change of the live state, then every 30 s.
  useEffect(() => {
    if (!allowed) return;
    const id = tabId();
    const beat = () => send.current({ cityId: CITY_ID, tabId: id, live: mode as ConsoleLiveState });
    beat();
    const timer = window.setInterval(beat, CONSOLE_WATCH_RULES.heartbeatSec * 1000);
    return () => window.clearInterval(timer);
  }, [allowed, mode]);

  const serverDown = present.data?.open.find((a) => a.kind === 'live_down') ?? null;
  const mineFor = downSince === null ? 0 : now - downSince;
  const show =
    allowed && (serverDown !== null || mineFor >= CONSOLE_WATCH_RULES.liveDownAfterSec * 1000);
  const since = serverDown ? new Date(serverDown.openedAt).getTime() - CONSOLE_WATCH_RULES.liveDownAfterSec * 1000 : downSince;
  const minutes = since === null ? 1 : Math.max(1, Math.floor((now - since) / 60_000));

  useEffect(() => {
    const root = document.documentElement;
    if (show) root.style.setProperty('--watch-h', `${HEIGHT}px`);
    else root.style.removeProperty('--watch-h');
    return () => {
      root.style.removeProperty('--watch-h');
    };
  }, [show]);
  if (!show) return null;
  return <LiveDownStripView minutes={minutes} told={serverDown !== null && serverDown.paged > 0} />;
}

/** "التحديث المباشر واقف من 3 دقيقة · الشاشة تتحدث كل كم ثانية بس" (+ "والمناوب انبلغ"). */
export function LiveDownStripView({ minutes, told }: { minutes: number; told: boolean }) {
  return (
    <div role="status" aria-live="polite" data-testid="live-down" className="flex h-11 shrink-0 items-center gap-3 border-b border-bad/50 bg-bad-tint px-4 text-bad lg:px-8">
      <IconAlert size={18} />
      <p className="num min-w-0 flex-1 truncate text-sm font-semibold">
        {t('console.watch.live_down', { minutes })}
        <span className="font-normal"> · {t(told ? 'console.watch.live_down_told' : 'console.watch.live_down_slow')}</span>
      </p>
    </div>
  );
}
