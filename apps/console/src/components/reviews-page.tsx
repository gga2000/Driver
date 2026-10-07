'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReviewHideReason, ReviewOpsView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { formatDayClock } from '@/lib/format';
import { queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { HIDE_REASON_KEY, HIDE_REASONS, hiddenParam, nextBefore, starsTone, tripKey, type ReviewFilter } from '@/lib/reviews';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, cx, Dialog, EmptyState, IconChat, NeedLogin, PageHeader, QueryError, Segmented, Skeleton, useToast } from './ui';

const PAGE = 50;

/**
 * Console › كلام الركاب (Baghdad/Kut idea x14, Ali 2026-10-07): the lines riders write about الرجعة
 * drivers, newest first. They show on the driver's profile without the rider's name; support hides
 * one that insults, names or numbers someone, isn't about the trip, or isn't true. Hiding keeps the
 * text, asks for a reason and is logged; «رجّعها» puts it back.
 */
export function ReviewsPage() {
  const signedIn = useSignedIn();
  const [filter, setFilter] = useState<ReviewFilter>('all');
  return (
    <div className="mx-auto max-w-[920px]">
      <PageHeader title={t('console.reviews.title')} subtitle={t('console.reviews.subtitle')} />
      {!signedIn ? (
        <NeedLogin />
      ) : (
        <div className="space-y-4">
          <Segmented
            label={t('console.reviews.filter')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('console.reviews.filter_all') },
              { value: 'shown', label: t('console.reviews.filter_shown') },
              { value: 'hidden', label: t('console.reviews.filter_hidden') },
            ]}
          />
          <ReviewList key={filter} filter={filter} />
        </div>
      )}
    </div>
  );
}

function ReviewList({ filter }: { filter: ReviewFilter }) {
  const trpc = useTRPC();
  const hidden = hiddenParam(filter);
  const [acting, setActing] = useState<{ review: ReviewOpsView; mode: 'hide' | 'unhide' } | null>(null);
  const list = useInfiniteQuery(
    trpc.routes.ops.reviews.infiniteQueryOptions(
      { limit: PAGE, ...(hidden === undefined ? {} : { hidden }) },
      { retry: queryRetry, getNextPageParam: (last) => (last.length === PAGE ? nextBefore(last) : null) },
    ),
  );
  const rows = list.data?.pages.flat() ?? [];

  if (list.error && !list.data) return <QueryError error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data) {
    return (
      <Card>
        <div className="space-y-3" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-md" />
          ))}
        </div>
      </Card>
    );
  }
  if (rows.length === 0) {
    return <EmptyState icon={<IconChat size={20} />} title={t(filter === 'hidden' ? 'console.reviews.empty_hidden' : 'console.reviews.empty')} hint={t('console.reviews.empty_hint')} />;
  }
  return (
    <>
      <Card flush>
        <ul className="divide-y divide-line/70" aria-label={t('console.reviews.title')}>
          {rows.map((r) => (
            <li key={r.bookingId}>
              <ReviewRow review={r} onAct={(mode) => setActing({ review: r, mode })} />
            </li>
          ))}
        </ul>
      </Card>
      {list.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {t('console.reviews.older')}
          </Button>
        </div>
      ) : null}
      <ActDialog acting={acting} onClose={() => setActing(null)} />
    </>
  );
}

function ReviewRow({ review: r, onAct }: { review: ReviewOpsView; onAct: (mode: 'hide' | 'unhide') => void }) {
  const trip = tripKey(r.corridorId, r.direction);
  const hidden = r.hiddenAt !== null;
  return (
    <div className={cx('flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4', hidden && 'bg-surface-2')}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" tone={starsTone(r.stars)}>
            {t('console.reviews.stars', { n: r.stars })}
          </Chip>
          {hidden ? (
            <Chip size="sm" tone="warn" dot>
              {t('console.reviews.hidden_because', { reason: r.hiddenReason ? t(HIDE_REASON_KEY[r.hiddenReason]) : t('console.reviews.reason_unknown') })}
            </Chip>
          ) : null}
        </div>
        <p className={cx('text-base', hidden ? 'text-muted' : 'text-text')}>«{r.text}»</p>
        <p className="text-xs text-muted">
          {[
            t('console.reviews.about', { name: r.driverFirstName ?? t('console.someone') }),
            t('rajaa.route', { from: t(trip.from), to: t(trip.to) }),
            r.tags.length ? r.tags.map((x) => t(`rajaa.rate_tag.${x}`)).join('، ') : null,
          ]
            .filter(Boolean)
            .join(' · ')}{' '}
          · <span className="num">{formatDayClock(r.at)}</span>
        </p>
      </div>
      <Button size="sm" variant={hidden ? 'secondary' : 'danger-soft'} onClick={() => onAct(hidden ? 'unhide' : 'hide')}>
        {t(hidden ? 'console.reviews.unhide' : 'console.reviews.hide')}
      </Button>
    </div>
  );
}

function ActDialog({ acting, onClose }: { acting: { review: ReviewOpsView; mode: 'hide' | 'unhide' } | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState<ReviewHideReason | null>(null);
  const done = {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trpc.routes.ops.reviews.queryKey() });
      toast({ title: t(acting?.mode === 'hide' ? 'console.reviews.hidden_toast' : 'console.reviews.unhidden_toast'), tone: 'ok' });
      setReason(null);
      onClose();
    },
  };
  const hide = useMutation(trpc.routes.ops.hideReview.mutationOptions(done));
  const unhide = useMutation(trpc.routes.ops.unhideReview.mutationOptions(done));
  const busy = hide.isPending || unhide.isPending;
  const error = hide.error ?? unhide.error;
  const close = () => {
    setReason(null);
    hide.reset();
    unhide.reset();
    onClose();
  };
  const confirm = () => {
    if (!acting) return;
    if (acting.mode === 'unhide') unhide.mutate({ bookingId: acting.review.bookingId });
    else if (reason) hide.mutate({ bookingId: acting.review.bookingId, reason });
  };
  return (
    <Dialog
      open={acting !== null}
      onClose={close}
      width="sm"
      labelledBy="review-act-title"
      title={t(acting?.mode === 'unhide' ? 'console.reviews.unhide_title' : 'console.reviews.hide_title')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('console.cancel')}
          </Button>
          <Button variant={acting?.mode === 'unhide' ? 'primary' : 'danger'} loading={busy} disabled={acting?.mode === 'hide' && !reason} onClick={confirm}>
            {t(acting?.mode === 'unhide' ? 'console.reviews.unhide_do' : 'console.reviews.hide_do')}
          </Button>
        </>
      }
    >
      {acting ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-md border border-line bg-surface-2 px-3 py-2.5">«{acting.review.text}»</p>
          {acting.mode === 'hide' ? (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 font-semibold">{t('console.reviews.reason')}</legend>
              {HIDE_REASONS.map((r) => (
                <label key={r} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 hover:bg-surface-2">
                  <input type="radio" name="hide-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-4 accent-accent" />
                  {t(HIDE_REASON_KEY[r])}
                </label>
              ))}
            </fieldset>
          ) : null}
          <p className="text-xs text-muted">{t(acting.mode === 'hide' ? 'console.reviews.hide_note' : 'console.reviews.unhide_note')}</p>
          <div role="status" className="min-h-[1.25rem]">
            {error ? <p className="text-bad">{errorText(error)}</p> : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
