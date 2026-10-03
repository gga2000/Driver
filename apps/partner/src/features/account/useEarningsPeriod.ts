import { useMemo, useState } from 'react';
import type { EarningsPeriod } from '@driver/contracts';
import { useT } from '@/lib/i18n';
import { chartBuckets, isCurrentPeriod, nextAnchor, periodContainsNow, prevAnchor, rangeLabel } from './logic';
import { useEarnings } from './queries';

/**
 * The period on screen (day / week / month + which one), its earnings, the previous period's net for
 * the "+12% أكثر من أمس" chip, the label and the chart buckets. Shared by the tab and the statement.
 */
export function useEarningsPeriod(initial: { period?: EarningsPeriod; anchor?: Date | null } = {}) {
  const t = useT();
  const [period, setPeriodState] = useState<EarningsPeriod>(initial.period ?? 'day');
  const [anchor, setAnchor] = useState<Date | null>(initial.anchor ?? null);
  const query = useEarnings(period, anchor);
  const view = query.data && query.data.period === period ? query.data : undefined;
  const prevQuery = useEarnings(period, view ? prevAnchor(view) : null, { enabled: Boolean(view) });
  const prev = prevQuery.data && view && prevQuery.data.to.getTime() === view.from.getTime() ? prevQuery.data : undefined;
  const now = new Date();

  const label = view ? rangeLabel(period, view, now, t) : t(`partner.earn_range_${period === 'day' ? 'today' : period === 'week' ? 'this_week' : 'this_month'}`);
  const prevLabel = prev ? rangeLabel(period, prev, now, t) : '';
  const buckets = useMemo(() => (view ? chartBuckets(period, view, view.jobs, t) : []), [view, period, t]);

  return {
    period,
    anchor,
    view,
    loading: !view || query.isPlaceholderData,
    error: query.error,
    refetch: () => Promise.all([query.refetch(), prevQuery.refetch()]),
    label,
    prevLabel,
    prevNetIqd: prev ? prev.totals.netIqd : null,
    buckets,
    canNext: view ? !isCurrentPeriod(view, now) : false,
    setPeriod: (p: EarningsPeriod) => {
      setPeriodState(p);
      setAnchor(null);
    },
    goPrev: () => view && setAnchor(prevAnchor(view)),
    goNext: () => view && setAnchor(periodContainsNow(period, nextAnchor(view), new Date()) ? null : nextAnchor(view)),
  };
}
