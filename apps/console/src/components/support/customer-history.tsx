'use client';

import { useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { formatDayClock, formatIqd } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useTRPC } from '@/lib/trpc';
import { OrderRef, OrgName } from '../named';
import { OrderStatus } from '../order-status';
import { Skeleton } from '../ui';

/**
 * s5: under the customer card, the customer's last orders and the credits that reached their wallet
 * this month, so support sees the whole story before answering (the card keeps the counts).
 */
export function CustomerHistory({ customerId }: { customerId: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.console.customerHistory.queryOptions({ cityId: CITY_ID, customerId }, { retry: queryRetry, staleTime: 30_000 }));

  if (q.isPending) {
    return (
      <div className="mt-4 space-y-2" aria-busy="true">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (q.isError || !q.data) return <p className="mt-4 text-xs text-bad">{t('console.sup_hist_failed')}</p>;

  const { recentOrders, credits } = q.data;
  return (
    <>
      <h4 className="mb-1.5 mt-4 text-xs font-medium text-muted">{t('console.sup_hist_orders')}</h4>
      {recentOrders.length === 0 ? (
        <p className="text-dense text-faint">{t('console.sup_hist_orders_none')}</p>
      ) : (
        <ul className="-mx-2">
          {recentOrders.map((o) => (
            <li key={o.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
              <OrderRef id={o.id} copy={false} className="shrink-0 text-dense" />
              <span className="min-w-0 flex-1 truncate text-dense">{o.merchantOrgId ? <OrgName id={o.merchantOrgId} copy={false} /> : null}</span>
              <OrderStatus state={o.state} size="sm" />
              <span className="num shrink-0 text-xs text-faint">{formatDayClock(o.placedAt).split(' · ')[0]}</span>
            </li>
          ))}
        </ul>
      )}

      <h4 className="mb-1.5 mt-4 flex items-baseline justify-between gap-2 text-xs font-medium text-muted">
        <span>{t('console.sup_hist_credits')}</span>
        {credits.totalIqd > 0 ? <span className="num text-warn">{formatIqd(credits.totalIqd)}</span> : null}
      </h4>
      {credits.lines.length === 0 ? (
        <p className="text-dense text-faint">{t('console.sup_hist_credits_none')}</p>
      ) : (
        <ul className="-mx-2">
          {credits.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-dense">{l.label_ar}</span>
              {l.orderId ? <OrderRef id={l.orderId} copy={false} className="shrink-0 text-xs" /> : null}
              <span className="num shrink-0 text-dense font-medium">{formatIqd(l.amountIqd)}</span>
              <span className="num shrink-0 text-xs text-faint">{formatDayClock(l.at).split(' · ')[0]}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
