'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { sosSystemAlerts, sweepSystemAlerts } from '@/lib/alert-notify';
import { useSafetyAlerts } from '@/lib/safety-live';
import { useSweepAlerts } from './sweep-strip';

// The browser part (notifications, title flash, the sound button) loads after the page.
const AlarmGate = dynamic(() => import('./alarm-gate').then((m) => m.AlarmGate), { ssr: false });

/**
 * The alarm away from the tab (scoring & safety §3), for the roles that answer alerts: the open SOS and
 * خطوط sweep alerts, read from the same queries as the banner and the strip (no extra requests), handed
 * to the alarm gate.
 */
export function SafetyAlarm() {
  const sos = useSafetyAlerts();
  const sweeps = useSweepAlerts();
  const sosRows = sos.rows;
  const sweepRows = sweeps.rows;
  const urgent = useMemo(() => [...sosSystemAlerts(sosRows), ...sweepSystemAlerts(sweepRows, Date.now())], [sosRows, sweepRows]);
  if (!sos.allowed && !sweeps.allowed) return null;
  return <AlarmGate urgent={urgent} />;
}
