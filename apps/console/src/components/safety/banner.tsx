'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { t } from '@driver/i18n';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ageText, bannerOrder, personName, roleText, shouldRing } from '@/lib/safety';
import { withBdi } from './bdi';
import { useSafetyAlarm, useSafetyAlerts } from '@/lib/safety-live';
import { buttonCls, cx, IconMute, IconSiren, IconVolume, useNow } from '../ui';

// Muted alerts (per tab, by id): muting stops the sound for the alerts on screen now; a new one rings.
const muted = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
function setMuted(ids: readonly string[], on: boolean) {
  for (const id of ids) {
    if (on) muted.add(id);
    else muted.delete(id);
  }
  version += 1;
  for (const l of listeners) l();
}

/**
 * The SOS banner (scoring & safety §3): a red bar at the top of every Console page while any alert
 * is open or taken but not closed, with the alarm while nobody has taken one. It names the person,
 * their role, the trip and how long ago, says when nobody took it for over a minute, and opens the
 * alert in one click. Sound can be muted for the alerts on screen; a new alert rings again. Its
 * height is published as `--sos-h` so full-height pages (the desk, dispatch, the map) shrink by it.
 */
export function SafetyBanner() {
  const { rows } = useSafetyAlerts();
  const pathname = usePathname();
  const live = bannerOrder(rows);
  const now = useNow(1000);
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  const ringing = shouldRing(live, muted);
  const { blocked } = useSafetyAlarm(ringing);
  const ref = useRef<HTMLDivElement>(null);

  // Full-height pages subtract the banner (it can wrap to two lines on narrow screens).
  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!el) {
      root.style.setProperty('--sos-h', '0px');
      return;
    }
    const set = () => root.style.setProperty('--sos-h', `${el.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.setProperty('--sos-h', '0px');
    };
  }, [live.length]);

  if (live.length === 0) return null;
  const first = live[0]!;
  const open = live.filter((r) => r.state === 'open');
  const oldest = live.reduce((a, r) => (r.raisedAt < a.raisedAt ? r : a), first);
  const overdue = open.find((r) => now - r.raisedAt.getTime() >= 60_000);
  const allMuted = open.length > 0 && open.every((r) => muted.has(r.id));
  const href = live.length === 1 ? `/safety/${encodeURIComponent(first.id)}` : '/safety';
  const here = pathname === href;
  const text =
    live.length === 1
      ? t('console.safety.banner_one', { name: personName(first.raiser), role: roleText(first.raiser.role), what: first.subject.label, ago: ageText(now - first.raisedAt.getTime()) })
      : t('console.safety.banner_many', { count: live.length, ago: ageText(now - oldest.raisedAt.getTime()) });

  return (
    <div
      ref={ref}
      role="alert"
      aria-live="assertive"
      data-testid="sos-banner"
      className={cx('relative z-40 flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-6', open.length > 0 ? 'bg-bad-solid text-on-bad' : 'bg-bad-tint text-bad')}
    >
      <span aria-hidden className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-surface/20">
        {open.length > 0 ? <span className="absolute inset-0 animate-ping rounded-pill bg-surface/30 motion-reduce:hidden" /> : null}
        <IconSiren size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold leading-6">{withBdi(text)}</p>
        <p className="text-dense opacity-90">
          {overdue
            ? t('console.safety.overdue', { ago: ageText(now - overdue.raisedAt.getTime()) })
            : first.state === 'acknowledged' && first.acknowledgedByName
              ? t('console.safety.banner_taken', { name: first.acknowledgedByName })
              : [first.state === 'open' ? t('console.safety.state_open') : null, first.subject.vehicle].filter(Boolean).join(' · ')}
          {blocked && !allMuted ? ` · ${t('console.sound_blocked_short')}` : ''}
        </p>
      </div>
      {open.length > 0 ? (
        <button
          type="button"
          onClick={() => setMuted(open.map((r) => r.id), !allMuted)}
          aria-pressed={allMuted}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-on-bad/50 px-3 text-dense font-medium hover:bg-surface/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {allMuted ? <IconMute size={16} /> : <IconVolume size={16} />}
          {allMuted ? t('console.safety.sound_on') : t('console.safety.sound_off')}
        </button>
      ) : null}
      {here ? null : (
        <Link href={href} className={cx(buttonCls('secondary', 'md'), 'font-semibold')} data-testid="sos-banner-open">
          {t('console.safety.banner_open')}
        </Link>
      )}
    </div>
  );
}
