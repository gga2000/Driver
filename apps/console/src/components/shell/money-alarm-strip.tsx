'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MONEY_ALARM_ROLES } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect } from 'react';
import { queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { buttonCls, cx, IconAlert, IconForward } from '../ui';

const HEIGHT = 56;
const POLL_MS = 30_000;

/**
 * The money alarm, on every page for finance and admin: a ledger posting failed for good in the
 * outbox, or a message has waited longer than 2 minutes (`system.moneyAlarm`; the server also logs it
 * to Sentry). It links to the System page, where an admin puts the failed rows back on the queue.
 * Its height is published as `--money-h` so full-height pages shrink by it.
 */
export function MoneyAlarmStrip() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  const allowed = signedIn && loaded && hasAny(roles, MONEY_ALARM_ROLES);
  const q = useQuery(trpc.system.moneyAlarm.queryOptions(undefined, { enabled: allowed, refetchInterval: POLL_MS, retry: queryRetry }));
  const a = q.data;
  const show = allowed && Boolean(a?.alarm);

  useEffect(() => {
    const root = document.documentElement;
    if (show) root.style.setProperty('--money-h', `${HEIGHT}px`);
    else root.style.removeProperty('--money-h');
    return () => {
      root.style.removeProperty('--money-h');
    };
  }, [show]);

  if (!show || !a) return null;
  return <MoneyAlarmStripView ledgerFailed={a.ledgerFailed} oldestPendingSec={a.oldestPendingSec} />;
}

/** «فلوس ما انسجلت بالدفتر · 2 تسجيل فشل · أقدم رسالة تنتظر من 4 دقيقة» and the way to the System page. */
export function MoneyAlarmStripView({ ledgerFailed, oldestPendingSec }: { ledgerFailed: number; oldestPendingSec: number }) {
  const parts = [
    ...(ledgerFailed > 0 ? [t('console.money_alarm.failed', { n: ledgerFailed })] : []),
    ...(oldestPendingSec >= 60 ? [t('console.money_alarm.waiting', { minutes: Math.floor(oldestPendingSec / 60) })] : []),
  ];
  return (
    <div role="alert" data-testid="money-alarm" className="shrink-0 border-b border-bad/50 bg-bad-tint text-bad">
      {/* The whole strip opens the System page (the label shows from tablet width up). */}
      <Link href="/system" className="flex h-14 items-center gap-3 px-4 hover:bg-bad/10 lg:px-8">
        <IconAlert size={18} className="shrink-0" />
        <p className="num min-w-0 flex-1 truncate text-sm font-semibold">
          {t('console.money_alarm.title')}
          {parts.length > 0 && <span className="font-normal"> · {parts.join(' · ')}</span>}
        </p>
        <span className={cx(buttonCls('secondary', 'lg'), 'hidden shrink-0 font-semibold sm:inline-flex')}>{t('console.money_alarm.open')}</span>
        <IconForward size={18} className="shrink-0 sm:hidden" title={t('console.money_alarm.open')} />
      </Link>
    </div>
  );
}
