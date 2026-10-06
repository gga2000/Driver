'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { SAFETY_DESK_ROLES, type KhatSweepAlert } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useRef } from 'react';
import { CITY_ID, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { SAFETY_POLL_MS } from '@/lib/safety-live';
import { useSignedIn } from '@/lib/session';
import { sweepDetail, sweepDriverName, sweepOrder, sweepTitle } from '@/lib/sweep';
import { useTRPC } from '@/lib/trpc';
import { withBdi } from './bdi';
import { Button, cx, IconAlert, IconCheckCircle, IconPhone, useNow, useToast } from '../ui';

const NONE: KhatSweepAlert[] = [];

/** The city's sweep alerts for the roles that answer safety items (polled like the SOS banner). */
export function useSweepAlerts() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  const allowed = loaded && hasAny(roles, SAFETY_DESK_ROLES);
  const q = useQuery(trpc.khat.sweepAlerts.queryOptions({ cityId: CITY_ID }, { enabled: signedIn && allowed, refetchInterval: SAFETY_POLL_MS, retry: queryRetry }));
  return { rows: q.data ?? NONE, allowed };
}

/**
 * The خطوط "car is empty" alert (partner S-6; Ali 2026-10-06) under the SOS banner on every page: a
 * run ended `KHAT_RULES.sweepAlertAfterMin` ago and the driver has not confirmed nobody is left in
 * the car. Each row names the driver, the run, where and when the last child got out, and calls him
 * through the masked line. When he confirms late the row turns calm ("تأكد متأخر 7 دقيقة") and goes
 * away after `sweepClearedShowMin`. Its height is published as `--sweep-h` for full-height pages.
 */
export function SweepAlertStrip() {
  const { rows } = useSweepAlerts();
  const now = useNow(1000);
  const ordered = sweepOrder(rows);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!el) {
      root.style.setProperty('--sweep-h', '0px');
      return;
    }
    const set = () => root.style.setProperty('--sweep-h', `${el.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.setProperty('--sweep-h', '0px');
    };
  }, [ordered.length]);

  if (ordered.length === 0) return null;
  return (
    <section ref={ref} aria-label={t('console.safety.sweep_region')} data-testid="sweep-strip" className="relative z-30 flex flex-col">
      {ordered.map((a) => (
        <SweepRow key={a.alertId} alert={a} now={now} />
      ))}
    </section>
  );
}

function SweepRow({ alert, now }: { alert: KhatSweepAlert; now: number }) {
  const open = !alert.confirmedAt;
  return (
    <div
      role={open ? 'alert' : 'status'}
      data-testid={`sweep-alert-${alert.alertId}`}
      className={cx('flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 lg:px-6', open ? 'border-bad/50 bg-bad-tint text-bad' : 'border-line bg-ok-tint text-text')}
    >
      <span aria-hidden className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-pill', open ? 'bg-bad-solid text-on-bad' : 'bg-surface text-ok')}>
        {open ? <IconAlert size={20} /> : <IconCheckCircle size={20} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold leading-6">{withBdi(sweepTitle(alert))}</p>
        <p className={cx('num text-dense', open ? 'opacity-90' : 'text-muted')}>
          {withBdi(sweepDetail(alert, now))}
          {open ? ` · ${t('console.safety.sweep_reminded')}` : ''}
        </p>
      </div>
      {open ? <SweepCallButton alert={alert} /> : null}
    </div>
  );
}

function SweepCallButton({ alert }: { alert: KhatSweepAlert }) {
  const trpc = useTRPC();
  const toast = useToast();
  const label = t('console.safety.call_raiser', { name: sweepDriverName(alert) });
  const call = useMutation(
    trpc.khat.callSweepDriver.mutationOptions({
      onSuccess: (s) =>
        toast({
          title: t('console.safety.call_dial', { number: s.dial }),
          body: s.mode === 'dev_direct' ? t('console.safety.call_dev') : t('console.safety.call_proxy'),
          action: { label, onClick: () => window.open(`tel:${s.dial}`, '_self') },
        }),
      onError: (e) => toast({ title: e.message, tone: 'bad' }),
    }),
  );
  return (
    <Button variant="danger" size="lg" loading={call.isPending} icon={<IconPhone size={16} />} onClick={() => call.mutate({ alertId: alert.alertId })} data-testid={`sweep-call-${alert.alertId}`}>
      {label}
    </Button>
  );
}
