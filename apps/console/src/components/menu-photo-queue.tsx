'use client';

import { useQuery } from '@tanstack/react-query';
import type { MenuPhotoRequestView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { ageLabel } from '@/lib/control-room';
import { formatDayClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { MENU_PHOTO_STATE_KEY, menuPhotoTone, untakenCount } from '@/lib/menu-photos';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Card, Chip, QueryError, Skeleton } from './ui';

const POLL_MS = 60_000;

/**
 * تصوير المنيو (maps k3) on the approvals page: every restaurant's photo request in the city, open
 * ones first (the longest wait on top), with who has the visit and when. Read only — field ops take
 * requests in the Partner app and owners decide on the photos in the Merchant app.
 */
export function MenuPhotoQueue() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const list = useQuery(trpc.ops.menuPhotos.queue.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));
  if (!signedIn) return null;
  return (
    <Card
      title={t('console.mp_title')}
      hint={list.data ? t('console.mp_hint', { n: untakenCount(list.data) }) : t('console.mp_hint_loading')}
    >
      {list.error ? <QueryError error={list.error} onRetry={() => void list.refetch()} /> : null}
      {!list.data && list.isPending ? <Skeleton className="h-24 rounded-md" /> : null}
      {list.data && list.data.length === 0 ? <p className="text-sm text-muted">{t('console.mp_empty')}</p> : null}
      {list.data && list.data.length > 0 ? <MenuPhotoRows rows={list.data} now={new Date(list.dataUpdatedAt || Date.now())} /> : null}
    </Card>
  );
}

export function MenuPhotoRows({ rows, now }: { rows: readonly MenuPhotoRequestView[]; now: Date }) {
  return (
    <ul className="divide-y divide-line/70" aria-label={t('console.mp_title')}>
      {rows.map((r) => (
        <li key={r.requestId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{r.storeName}</span>
            <span className="block truncate text-xs text-muted">
              {r.wholeMenu ? t('console.mp_whole_menu', { n: r.counts.dishes }) : t('console.mp_dishes', { n: r.counts.dishes })}
              {r.note ? ` · ${r.note}` : ''}
            </span>
          </span>
          <span className="num shrink-0 text-xs text-muted">
            {r.scheduledFor && r.state === 'scheduled'
              ? t('console.mp_visit', { name: r.photographerName ?? t('console.someone'), when: formatDayClock(r.scheduledFor) })
              : r.state === 'shot'
                ? t('console.mp_waiting_owner', { n: r.counts.proposed })
                : r.state === 'done'
                  ? t('console.mp_accepted', { n: r.counts.accepted, of: r.counts.accepted + r.counts.rejected })
                  : ageLabel(r.requestedAt, now)}
          </span>
          <Chip size="sm" dot tone={menuPhotoTone(r.state)}>
            {t(MENU_PHOTO_STATE_KEY[r.state])}
          </Chip>
        </li>
      ))}
    </ul>
  );
}
