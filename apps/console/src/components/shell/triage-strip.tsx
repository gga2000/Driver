'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { t } from '@driver/i18n';
import { useEffect, useState } from 'react';
import { formatCountdown } from '@/lib/format';
import { useNavCounts } from '@/lib/nav-counts';
import { buttonCls, IconAlert } from '../ui';

const HEIGHT = 44;

/**
 * S-K1 on every page (K-05): while cards wait for a dispatcher, a red strip under the SOS banner says
 * how many and how long the oldest has waited, with "روح للتوزيع". The dispatch page has its own
 * triage bar, the wall its own screen, so it stays off those. Its height is published as
 * `--triage-h` so full-height pages (the desk, the map) shrink by it.
 */
export function GlobalTriageStrip() {
  const pathname = usePathname();
  const counts = useNavCounts()['/dispatch'];
  const [tick, setTick] = useState(0);
  const n = counts?.n ?? 0;
  const show = n > 0 && pathname !== '/dispatch' && pathname !== '/wall' && pathname !== '/login';
  useEffect(() => {
    setTick(0);
    if (!show) return;
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [show, counts?.oldestSec]);
  useEffect(() => {
    const root = document.documentElement;
    if (show) root.style.setProperty('--triage-h', `${HEIGHT}px`);
    else root.style.removeProperty('--triage-h');
    return () => {
      root.style.removeProperty('--triage-h');
    };
  }, [show]);
  if (!show) return null;
  const oldest = counts?.oldestSec === undefined || counts.oldestSec === null ? null : counts.oldestSec + tick;
  return <TriageStripView n={n} oldestSec={oldest} />;
}

/** The strip itself: "طلبين يحتاجون ديسباتشر · أقدم واحد من 2:10" and "روح للتوزيع". */
export function TriageStripView({ n, oldestSec }: { n: number; oldestSec: number | null }) {
  return (
    <div role="status" aria-live="polite" data-testid="global-triage" className="flex h-11 shrink-0 items-center gap-3 border-b border-bad/50 bg-bad-tint px-4 text-bad lg:px-8">
      <IconAlert size={18} />
      <p className="num min-w-0 flex-1 truncate text-sm font-semibold">{oldestSec === null ? t('console.triage_global_short', { count: n }) : t('console.triage_global', { count: n, time: formatCountdown(oldestSec) })}</p>
      <Link href="/dispatch" className={buttonCls('danger', 'sm')}>
        {t('console.triage_go')}
      </Link>
    </div>
  );
}
