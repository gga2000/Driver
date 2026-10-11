'use client';

import { t } from '@driver/i18n';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { askNotifyPermission, freshAlerts, notifyPermission, showSystemAlert, sosSystemAlerts, sweepSystemAlerts, titleFrame, type NotifyPermission } from '@/lib/alert-notify';
import { useAlarmSound, useSafetyAlerts } from '@/lib/safety-live';
import { Button, IconVolume } from '../ui';
import { useSweepAlerts } from './sweep-strip';

/**
 * The alarm away from the tab (scoring & safety §3): an open SOS or خطوط sweep alert becomes a desktop
 * notification that stays until clicked and the tab title flashes while the tab is hidden, so a staff
 * member in another tab or app still sees it. After sign-in or a reload, one button «شغّل صوت الإنذار»
 * gives the browser the click it needs for the alarm sound and asks for notifications; it goes away
 * once both are settled. Only for the roles that answer alerts; it reads the same queries as the
 * banner and the strip (no extra requests).
 */
export function AlarmGate() {
  const router = useRouter();
  const sos = useSafetyAlerts();
  const sweeps = useSweepAlerts();
  const sound = useAlarmSound();
  const [perm, setPerm] = useState<NotifyPermission>('unsupported');
  const [done, setDone] = useState(false);
  const seen = useRef(new Set<string>());

  useEffect(() => setPerm(notifyPermission()), []);

  const sosRows = sos.rows;
  const sweepRows = sweeps.rows;
  const urgent = useMemo(() => [...sosSystemAlerts(sosRows), ...sweepSystemAlerts(sweepRows, Date.now())], [sosRows, sweepRows]);

  // A desktop notification for each alert this tab has not shown yet (once allowed, the ones already open too).
  useEffect(() => {
    if (perm !== 'granted') return;
    for (const a of freshAlerts(urgent, seen.current)) showSystemAlert(a, (href) => router.push(href));
  }, [urgent, perm, router]);

  // Flash the tab title while an alert is open and the tab is hidden; put it back when seen or done.
  const count = urgent.length;
  useEffect(() => {
    if (count === 0) return;
    const base = document.title;
    let tick = 0;
    let id: number | null = null;
    const stop = () => {
      if (id !== null) window.clearInterval(id);
      id = null;
      document.title = base;
    };
    const sync = () => {
      if (!document.hidden) return stop();
      if (id !== null) return;
      id = window.setInterval(() => {
        document.title = titleFrame(base, count, tick++);
      }, 1_000);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      stop();
    };
  }, [count]);

  const allowed = sos.allowed || sweeps.allowed;
  if (!allowed || done || (!sound.blocked && perm !== 'default')) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 end-4 start-4 z-50 flex justify-end sm:start-auto" data-testid="alarm-gate">
      <div className="pointer-events-auto flex w-full flex-col items-stretch gap-3 rounded-lg border border-line bg-surface p-3 shadow-pop sm:w-auto sm:max-w-md sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-dense text-muted">{t('console.alarm.enable_hint')}</p>
        <Button
          variant="primary"
          size="lg"
          icon={<IconVolume size={18} />}
          data-testid="alarm-gate-enable"
          onClick={async () => {
            await sound.unlock();
            setPerm(await askNotifyPermission());
            setDone(true);
          }}
        >
          {t('console.alarm.enable')}
        </Button>
      </div>
    </div>
  );
}
