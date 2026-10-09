'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DISH_PHOTO_RULES, DISH_PHOTO_TAKEDOWN_REASONS, type DishPhotoRow, type DishPhotoTakedownReason } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { ageLabel, fileUrl } from '@/lib/control-room';
import { isLate, KEEP_TOAST, TAKEDOWN_REASON_KEY, TAKEDOWN_TOAST } from '@/lib/dish-photos';
import { formatMoney } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { useSignedIn } from '@/lib/session';
import { API_URL, useTRPC } from '@/lib/trpc';
import { PhotoZoom } from './photo-zoom';
import { Button, Card, Chip, cx, Dialog, IconCheck, IconZoom, QueryError, Skeleton, useToast } from './ui';

const POLL_MS = 60_000;

/**
 * صور المحلات اليوم (p4, Ali 2026-10-08) on the approvals page: a dish photo the shop put up itself is
 * already on the menu, and the team looks at each one the same day. Oldest first; past 8 hours a tile
 * turns warm. «تمام» keeps the photo; «انزّلها» takes a bad one off the menu with a reason the shop
 * gets. Either way the tile leaves (both audited on the server).
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
  const [asking, setAsking] = useState(false);
  const done = (line: { key: Parameters<typeof t>[0]; tone: 'ok' | 'default' }) => {
    toast({ title: t(line.key, { dish: row.dishName }), tone: line.tone });
    void qc.invalidateQueries({ queryKey: trpc.ops.dishPhotos.queue.pathKey() });
  };
  const onError = (err: Parameters<typeof errorText>[0]) => toast({ title: errorText(err), tone: 'bad' });
  const keep = useMutation(trpc.ops.dishPhotos.keep.mutationOptions({ onSuccess: (res) => done(KEEP_TOAST[res.outcome]), onError }));
  const takeDown = useMutation(
    trpc.ops.dishPhotos.takeDown.mutationOptions({
      onSuccess: (res) => {
        setAsking(false);
        done(TAKEDOWN_TOAST[res.outcome]);
      },
      onError,
    }),
  );
  const busy = keep.isPending || takeDown.isPending;
  const version = { merchantOrgId: row.merchantOrgId, itemId: row.itemId, pendingSince: row.pendingSince };
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
        <div className="mt-auto flex gap-2">
          <Button variant="primary" size="lg" className="flex-1" disabled={busy} aria-label={t('console.dp_keep_label', { dish: row.dishName })} onClick={() => keep.mutate(version)}>
            <IconCheck size={18} />
            {t('console.dp_keep')}
          </Button>
          <Button variant="danger-soft" size="lg" disabled={busy} aria-label={t('console.dp_takedown_label', { dish: row.dishName })} onClick={() => setAsking(true)}>
            {t('console.dp_takedown')}
          </Button>
        </div>
      </div>
      {asking ? <TakeDownDialog dish={row.dishName} busy={takeDown.isPending} onClose={() => setAsking(false)} onConfirm={(reason) => takeDown.mutate({ ...version, reason })} /> : null}
    </li>
  );
}

/** «انزّلها»: one reason (the shop is told it), then confirm. */
function TakeDownDialog({ dish, busy, onClose, onConfirm }: { dish: string; busy: boolean; onClose: () => void; onConfirm: (reason: DishPhotoTakedownReason) => void }) {
  const [reason, setReason] = useState<DishPhotoTakedownReason | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('console.dp_takedown_title', { dish })}
      description={t('console.dp_takedown_body')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button variant="danger" disabled={!reason || busy} onClick={() => reason && onConfirm(reason)}>
            {t('console.dp_takedown')}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label={t('console.dp_reason_title')} className="grid gap-2">
        <p className="text-sm font-semibold">{t('console.dp_reason_title')}</p>
        {DISH_PHOTO_TAKEDOWN_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={cx(
              'flex min-h-11 items-center gap-3 rounded-md border px-3 text-start text-sm transition-colors duration-fast',
              reason === r ? 'border-accent bg-accent-tint font-semibold' : 'border-line bg-surface hover:bg-surface-2',
            )}
          >
            <span aria-hidden className={cx('h-4 w-4 shrink-0 rounded-pill border-2', reason === r ? 'border-accent bg-accent' : 'border-line-strong')} />
            {t(TAKEDOWN_REASON_KEY[r])}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
