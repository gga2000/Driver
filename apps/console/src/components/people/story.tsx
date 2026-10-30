'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type { StoryItem } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useMemo, useState, type ReactNode } from 'react';
import { formatClock, formatIqd } from '@/lib/format';
import { orderTypeLabel } from '@/lib/labels';
import { CITY_ID, queryRetry } from '@/lib/live';
import { storyKindLabel } from '@/lib/people';
import { dayHeading, dayKey } from '@/lib/periods';
import { useTRPC } from '@/lib/trpc';
import { OrderRef, OrgName } from '../named';
import { OrderStatus } from '../order-status';
import { Button, Card, Chip, cx, EmptyState, QueryError, Skeleton, useNow, type ChipTone } from '../ui';

type Kind = StoryItem['kind'];
const KINDS: readonly Kind[] = ['order', 'money', 'ticket', 'rating'];
const MARK: Record<Kind, string> = {
  order: 'bg-accent-tint text-accent-text',
  money: 'bg-ok-tint text-ok',
  ticket: 'bg-bad-tint text-bad',
  rating: 'bg-surface-3 text-text',
};
const TICKET_TONE: Record<string, ChipTone> = { open: 'bad', waiting: 'warn', escalated: 'bad', resolved: 'done' };

/**
 * «القصة»: everything that happened to one person, newest first and grouped by day — orders and
 * rides (a driver's jobs with his net), money that reached them, tickets and ratings — with chips to
 * keep one kind. Pseudonymous: order numbers, places and amounts.
 */
export function Story({ personId, who }: { personId: string; who: 'customer' | 'driver' }) {
  const trpc = useTRPC();
  const now = new Date(useNow(60_000));
  const [kinds, setKinds] = useState<Kind[]>([]);
  const q = useInfiniteQuery(
    trpc.people.story.infiniteQueryOptions(
      { cityId: CITY_ID, personId, who, kinds, limit: 40 },
      { retry: queryRetry, staleTime: 30_000, getNextPageParam: (last) => last.nextBefore ?? undefined },
    ),
  );
  const items = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const days = useMemo(() => {
    const out: Array<{ key: string; at: Date; items: StoryItem[] }> = [];
    for (const i of items) {
      const k = dayKey(i.at);
      if (out.at(-1)?.key !== k) out.push({ key: k, at: i.at, items: [] });
      out.at(-1)!.items.push(i);
    }
    return out;
  }, [items]);
  const toggle = (k: Kind) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return (
    <Card flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <Button size="sm" variant="ghost" aria-pressed={kinds.length === 0} onClick={() => setKinds([])}>
          {t('console.ppl_story_all')}
        </Button>
        {KINDS.map((k) => (
          <Button key={k} size="sm" variant="ghost" aria-pressed={kinds.includes(k)} onClick={() => toggle(k)}>
            {storyKindLabel(k)}
          </Button>
        ))}
      </div>
      <div className="px-5 pb-4">
        {q.error ? (
          <div className="pt-4">
            <QueryError error={q.error} onRetry={() => void q.refetch()} />
          </div>
        ) : q.isPending ? (
          <div className="space-y-3 pt-4" aria-busy="true">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title={t('console.ppl_story_none')} hint={t('console.ppl_story_none_hint')} />
        ) : (
          days.map((d) => (
            <section key={d.key} className="pt-4">
              <h3 className="mb-1 text-dense font-semibold text-text">{dayHeading(d.at, now)}</h3>
              <ol className="m-0 list-none p-0">
                {d.items.map((i) => (
                  <li key={i.id} className="flex gap-3">
                    <span className="flex w-9 shrink-0 flex-col items-center">
                      <span className={cx('flex h-9 w-9 items-center justify-center rounded-pill text-[11px] font-semibold', MARK[i.kind])}>{storyKindLabel(i.kind)}</span>
                      <span aria-hidden className="w-0.5 flex-1 bg-surface-3" />
                    </span>
                    <div className="min-w-0 flex-1 pb-3 pt-1.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="m-0 min-w-0 font-medium">
                          <Title item={i} who={who} />
                        </p>
                        <time className="num text-xs text-faint">{formatClock(i.at)}</time>
                      </div>
                      <Detail item={i} />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
        {q.hasNextPage ? (
          <div className="mt-2 flex justify-center">
            <Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {t('console.load_more')}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Title({ item: i, who }: { item: StoryItem; who: 'customer' | 'driver' }) {
  switch (i.kind) {
    case 'order':
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {i.orderType ? orderTypeLabel(i.orderType) : who === 'driver' ? t('console.ppl_story_job') : null}
          {i.orderId ? <OrderRef id={i.orderId} copy={false} /> : null}
          {i.merchantOrgId ? (
            <>
              <span className="text-faint">·</span>
              <OrgName id={i.merchantOrgId} copy={false} />
            </>
          ) : null}
        </span>
      );
    case 'money':
      return <span>{i.label ?? t('console.ppl_story_money')}</span>;
    case 'ticket':
      return <span>{t('console.ppl_story_ticket', { subject: i.label ?? '' })}</span>;
    case 'rating':
      return (
        <span className="inline-flex items-center gap-1.5">
          {t('console.ppl_story_rating', { n: i.score ?? 0 })}
          {i.orderId ? <OrderRef id={i.orderId} copy={false} /> : null}
        </span>
      );
  }
}

function Detail({ item: i }: { item: StoryItem }) {
  const parts: ReactNode[] = [];
  if (i.state) parts.push(<OrderStatus key="s" state={i.state} size="sm" />);
  if (i.ticketStatus) parts.push(<Chip key="t" size="sm" tone={TICKET_TONE[i.ticketStatus] ?? 'neutral'}>{t(`console.ppl_ticket_${i.ticketStatus}` as 'console.ppl_ticket_open')}</Chip>);
  if (i.amountIqd !== null && i.amountIqd !== 0) {
    parts.push(
      <span key="a" className="num text-dense text-muted">
        {formatIqd(i.amountIqd)} {t('quote.currency')}
      </span>,
    );
  }
  if (i.kind === 'money' && i.orderId) parts.push(<OrderRef key="o" id={i.orderId} copy={false} className="text-xs" />);
  return parts.length ? <div className="mt-1 flex flex-wrap items-center gap-2">{parts}</div> : null;
}
