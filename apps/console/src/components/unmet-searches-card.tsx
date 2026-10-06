'use client';

import { useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { formatDayClock } from '@/lib/format';
import { zoneName } from '@/lib/labels';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useTRPC } from '@/lib/trpc';
import { Card, Chip, QueryError, Skeleton } from './ui';

/**
 * «شنو يدورون وما لگوه» (customer joy h4, discovery D-13): words customers searched for in the last
 * 30 days that no kitchen serves, sent only when they agreed («إي گولولهم»). Anonymous counts by
 * word and zone — the list ops use to decide which kitchen or dish to bring next.
 */
export function UnmetSearchesCard({ signedIn }: { signedIn: boolean }) {
  const trpc = useTRPC();
  const list = useQuery(trpc.search.unmetList.queryOptions({ cityId: CITY_ID, days: 30, limit: 12 }, { enabled: signedIn, refetchInterval: 5 * 60_000, retry: queryRetry }));
  const rows = list.data ?? [];
  return (
    <Card title={t('console.unmet_title')} hint={t('console.unmet_hint')}>
      {list.error ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-9 rounded-md" />
          <Skeleton className="h-9 rounded-md" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{t('console.unmet_empty')}</p>
      ) : (
        <ol className="space-y-2" data-testid="unmet-searches">
          {rows.map((r) => (
            <li key={r.term} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold">«{r.typed}»</p>
                <p className="mt-0.5 text-xs text-muted">
                  {r.zones
                    .slice(0, 3)
                    .map((z) => (z.zoneKey ? `${zoneName(z.zoneKey)} ${z.searches}` : t('console.unmet_no_zone', { n: z.searches })))
                    .join(' · ')}
                  {' · '}
                  {t('console.unmet_last', { when: formatDayClock(r.lastAt) })}
                </p>
              </div>
              <Chip tone="neutral">{t('console.unmet_count', { n: r.searches })}</Chip>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
