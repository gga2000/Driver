'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DISH_PHOTO_RULES, type DishPhotoRow } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { ageLabel, fileUrl } from '@/lib/control-room';
import { isLate, KEEP_TOAST } from '@/lib/dish-photos';
import { formatMoney } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { useSignedIn } from '@/lib/session';
import { API_URL, useTRPC } from '@/lib/trpc';
import { PhotoZoom } from './photo-zoom';
import { Button, Card, Chip, cx, IconCheck, IconZoom, QueryError, Skeleton, useToast } from './ui';

const POLL_MS = 60_000;

/**
 * صور المحلات اليوم (p4, Ali 2026-10-08) on the approvals page: a dish photo the shop put up itself is
 * already on the menu, and the team looks at each one the same day. Oldest first; past 8 hours a tile
 * turns warm. «تمام» keeps the photo and the tile leaves (audited on the server).
 */
export function DishPhotoQueue() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const list = useQuery(trpc.ops.dishPhotos.queue.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));
  const [zoom, setZoom] = useState<DishPhotoRow | null>(null);
  if (!signedIn) return null;
  const now = new Date(list.dataUpdatedAt || Date.now());
  return (
    <Card title={t('console.dp_title')} hint={list.data ? t('console.dp_hint', { n: list.data.length }) : t('console.dp_hint_loading')}>
      <p className="mb-4 max-w-[65ch] text-sm text-muted">{t('console.dp_explain')}</p>
      {list.error ? <QueryError error={list.error} onRetry={() => void list.refetch()} /> : null}
      {!list.data && list.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="aspect-[4/3] rounded-md" />
          <Skeleton className="hidden aspect-[4/3] rounded-md sm:block" />
        </div>
      ) : null}
      {list.data && list.data.length === 0 ? <p className="text-sm text-muted">{t('console.dp_empty')}</p> : null}
      {list.data && list.data.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('console.dp_title')}>
          {list.data.map((row) => (
            <DishPhotoTile key={`${row.itemId}:${row.pendingSince.getTime()}`} row={row} now={now} onZoom={() => setZoom(row)} />
          ))}
        </ul>
      ) : null}
      {zoom?.photoUrl ? <PhotoZoom url={zoom.photoUrl} label={`${zoom.dishName} · ${zoom.storeName}`} onClose={() => setZoom(null)} /> : null}
    </Card>
  );
}

export function DishPhotoTile({ row, now, onZoom }: { row: DishPhotoRow; now: Date; onZoom: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const late = isLate(row, now);
  const keep = useMutation(
    trpc.ops.dishPhotos.keep.mutationOptions({
      onSuccess: (res) => {
        const line = KEEP_TOAST[res.outcome];
        toast({ title: t(line.key, { dish: row.dishName }), tone: line.tone });
        void qc.invalidateQueries({ queryKey: trpc.ops.dishPhotos.queue.pathKey() });
      },
      onError: (err) => toast({ title: errorText(err), tone: 'bad' }),
    }),
  );
  return (
    <li className={cx('flex min-w-0 flex-col overflow-hidden rounded-md border bg-surface', late ? 'border-warn-solid/60' : 'border-line')}>
      {row.photoUrl ? (
        <button type="button" onClick={onZoom} className="group relative block w-full bg-surface-3" aria-label={t('console.dp_zoom', { dish: row.dishName })}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed API URLs, not static assets */}
          <img src={fileUrl(row.photoUrl, API_URL)} alt={row.dishName} loading="lazy" className="aspect-[4/3] w-full object-cover" />
          <span aria-hidden className="absolute bottom-2 end-2 inline-flex h-8 w-8 items-center justify-center rounded-pill bg-inverse/80 text-on-inverse opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100">
            <IconZoom size={16} />
          </span>
        </button>
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-surface-2 px-6 text-center text-sm text-muted">{t('console.dp_no_photo')}</div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="min-w-0">
          <p className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-semibold">{row.dishName}</span>
            <span className="num shrink-0 text-sm text-muted">{formatMoney(row.priceIqd)}</span>
          </p>
          <p className="mt-0.5 flex items-center justify-between gap-3 text-xs text-muted">
            <span className="min-w-0 truncate">{row.storeName}</span>
            <span className="num shrink-0">{ageLabel(row.pendingSince, now)}</span>
          </p>
        </div>
        {late ? (
          <Chip size="sm" dot tone="warn" className="self-start">
            {t('console.dp_late', { h: DISH_PHOTO_RULES.lateAfterHours })}
          </Chip>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          className="mt-auto w-full"
          disabled={keep.isPending}
          aria-label={t('console.dp_keep_label', { dish: row.dishName })}
          onClick={() => keep.mutate({ merchantOrgId: row.merchantOrgId, itemId: row.itemId, pendingSince: row.pendingSince })}
        >
          <IconCheck size={18} />
          {t('console.dp_keep')}
        </Button>
      </div>
    </li>
  );
}
