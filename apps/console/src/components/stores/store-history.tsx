'use client';

import { useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { formatDayClock } from '@/lib/format';
import { queryRetry } from '@/lib/live';
import { useTRPC } from '@/lib/trpc';
import { Avatar, Card, EmptyState, IconClock, QueryError, Skeleton } from '../ui';

/**
 * «السجل»: every change our team made to this store, newest first, with who made it — the same rows
 * the owner's «فريقنا عدّل بمحلك» card reads. The pickup spot and kitchen moves are here too.
 */
export function StoreHistory({ storeId }: { storeId: string }) {
  const trpc = useTRPC();
  const rows = useQuery(trpc.ops.stores.history.queryOptions({ merchantOrgId: storeId, limit: 100 }, { retry: queryRetry }));
  if (rows.error) return <QueryError error={rows.error} onRetry={() => void rows.refetch()} />;
  return (
    <Card title={t('console.stores.tab_log')} hint={t('console.stores.log_hint')}>
      {!rows.data ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      ) : rows.data.length === 0 ? (
        <EmptyState icon={<IconClock size={20} />} title={t('console.stores.log_empty')} hint={t('console.stores.log_empty_hint')} />
      ) : (
        <ol className="divide-y divide-line/70">
          {rows.data.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-3" data-testid="history-row">
              <Avatar name={r.actorName ?? t('console.someone')} id={r.actorId} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text">{r.summaryAr}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {r.actorName ?? t('console.someone')} · {formatDayClock(r.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
