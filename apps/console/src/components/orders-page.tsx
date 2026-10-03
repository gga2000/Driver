'use client';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { OrderType as OrderTypeEnum, type OrderSummary, type OrderType } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { formatDayClock, formatIqd, fromLocalInputValue, shortId, toLocalInputValue } from '@/lib/format';
import { orderStateLabel, orderTypeLabel, paymentLabel } from '@/lib/labels';
import { CITY_ID, queryRetry, SLOW_POLL_MS } from '@/lib/live';
import { ORDER_STATE_TONE, searchInput, STATE_FILTERS, type HistoryFilter, type StateFilter } from '@/lib/orders';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Chip, EmptyState, ghostBtn, inputCls, LiveBadge, Mono, NeedLogin, PageHeader, QueryError } from './ui';

const FILTERS = Object.keys(STATE_FILTERS) as StateFilter[];
const filterKey = (f: StateFilter) => `console.filter_${f}` as MessageKey;
const PAGE = 50;

/** Order history (`orders.search`): every state, newest first, filtered on the server, paged by cursor. */
export function OrdersPage() {
  const signedIn = useSignedIn();
  const trpc = useTRPC();
  const [filter, setFilter] = useState<HistoryFilter>({ state: 'all', type: 'all', q: '', from: null, to: null });
  const q = useDeferredValue(filter.q);
  const ids = { q: useId(), type: useId(), from: useId(), to: useId() };

  const orders = useInfiniteQuery(
    trpc.orders.search.infiniteQueryOptions(searchInput(CITY_ID, { ...filter, q }, PAGE), {
      enabled: signedIn,
      retry: queryRetry,
      refetchInterval: SLOW_POLL_MS,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
  const shown = useMemo(() => {
    const seen = new Set<string>();
    const out: OrderSummary[] = [];
    for (const page of orders.data?.pages ?? []) {
      for (const o of page.rows) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        out.push(o);
      }
    }
    return out;
  }, [orders.data]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('console.orders_title')} subtitle={t('console.orders_history_subtitle')}>
        {signedIn && <LiveBadge seconds={SLOW_POLL_MS / 1000} updatedAt={orders.dataUpdatedAt} fetching={orders.isFetching} />}
      </PageHeader>

      {!signedIn ? (
        <NeedLogin />
      ) : (
        <>
          <div className="mb-4 space-y-3">
            <div role="group" aria-label={t('console.col_state')} className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter.state === f}
                  onClick={() => setFilter((p) => ({ ...p, state: f }))}
                  className={`inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-sm transition-colors ${
                    filter.state === f ? 'border-accent bg-accent font-semibold text-on-accent' : 'border-line bg-surface-2 hover:border-muted'
                  }`}
                >
                  {t(filterKey(f))}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_12rem]">
              <div>
                <label htmlFor={ids.q} className="sr-only">
                  {t('console.search')}
                </label>
                <input
                  id={ids.q}
                  type="search"
                  dir="auto"
                  placeholder={t('console.orders_search_history')}
                  className={inputCls}
                  value={filter.q}
                  onChange={(e) => setFilter((p) => ({ ...p, q: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor={ids.type} className="sr-only">
                  {t('console.orders_type')}
                </label>
                <select id={ids.type} className={inputCls} value={filter.type} onChange={(e) => setFilter((p) => ({ ...p, type: e.target.value as OrderType | 'all' }))}>
                  <option value="all">{t('console.orders_type_all')}</option>
                  {OrderTypeEnum.options.map((ty) => (
                    <option key={ty} value={ty}>
                      {orderTypeLabel(ty)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={ids.from} className="mb-1 block text-xs text-muted">
                  {t('console.orders_from')}
                </label>
                <input
                  id={ids.from}
                  type="datetime-local"
                  className={inputCls}
                  value={filter.from ? toLocalInputValue(filter.from) : ''}
                  onChange={(e) => setFilter((p) => ({ ...p, from: fromLocalInputValue(e.target.value) }))}
                />
              </div>
              <div>
                <label htmlFor={ids.to} className="mb-1 block text-xs text-muted">
                  {t('console.orders_to')}
                </label>
                <input
                  id={ids.to}
                  type="datetime-local"
                  className={inputCls}
                  value={filter.to ? toLocalInputValue(filter.to) : ''}
                  onChange={(e) => setFilter((p) => ({ ...p, to: fromLocalInputValue(e.target.value) }))}
                />
              </div>
            </div>
          </div>

          {orders.error && <QueryError error={orders.error} onRetry={() => void orders.refetch()} />}
          {orders.isSuccess && shown.length === 0 && <EmptyState title={t('console.orders_empty')} />}

          {shown.length > 0 && (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-xs text-muted">
                    <tr>
                      {(['console.col_order', 'console.col_type', 'console.col_state', 'console.col_merchant', 'console.col_payment', 'console.col_placed'] as const).map((k) => (
                        <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                          {t(k)}
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2 text-end font-medium">
                        {t('console.col_total')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((o) => (
                      <tr key={o.id} className="border-t border-line hover:bg-surface">
                        <td className="px-3 py-2">
                          <Link href={`/orders/${encodeURIComponent(o.id)}`} className="text-accent underline">
                            <Mono title={o.id}>{shortId(o.id)}</Mono>
                          </Link>
                        </td>
                        <td className="px-3 py-2">{orderTypeLabel(o.type)}</td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1">
                            <Chip tone={ORDER_STATE_TONE[o.state]}>{orderStateLabel(o.state)}</Chip>
                            {o.late && <Chip tone="bad">{t('console.order_late')}</Chip>}
                          </span>
                        </td>
                        <td className="px-3 py-2">{o.merchantOrgId ? <Mono>{shortId(o.merchantOrgId)}</Mono> : '—'}</td>
                        <td className="px-3 py-2">{paymentLabel(o.paymentMethod)}</td>
                        <td className="px-3 py-2 text-muted">{formatDayClock(o.placedAt)}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{formatIqd(o.totalIqd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phone cards */}
              <ul className="space-y-2 md:hidden">
                {shown.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${encodeURIComponent(o.id)}`} className="block rounded-xl border border-line bg-surface p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          {orderTypeLabel(o.type)} · <Mono>{shortId(o.id)}</Mono>
                        </span>
                        <span className="flex gap-1">
                          {o.late && <Chip tone="bad">{t('console.order_late')}</Chip>}
                          <Chip tone={ORDER_STATE_TONE[o.state]}>{orderStateLabel(o.state)}</Chip>
                        </span>
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-muted">
                        <span>{formatDayClock(o.placedAt)}</span>
                        <span className="tabular-nums text-text">
                          {formatIqd(o.totalIqd)} {t('quote.currency')}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              {orders.hasNextPage && (
                <button type="button" className={`${ghostBtn} mt-4 w-full`} disabled={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()}>
                  {orders.isFetchingNextPage ? t('status.loading') : t('console.load_more')}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
