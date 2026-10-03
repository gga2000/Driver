'use client';

import Link from 'next/link';
import { OrderType as OrderTypeEnum, type OrderType } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useId, useMemo, useState } from 'react';
import { formatDayClock, formatIqd, shortId } from '@/lib/format';
import { orderStateLabel, orderTypeLabel, paymentLabel } from '@/lib/labels';
import { SLOW_POLL_MS, useActiveOrders } from '@/lib/live';
import { countByFilter, filterOrders, ORDER_STATE_TONE, STATE_FILTERS, type OrderFilter, type StateFilter } from '@/lib/orders';
import { useSignedIn } from '@/lib/session';
import { Chip, EmptyState, inputCls, LiveBadge, Mono, NeedLogin, PageHeader, QueryError } from './ui';

const FILTERS = Object.keys(STATE_FILTERS) as StateFilter[];
const filterKey = (f: StateFilter) => `console.filter_${f}` as MessageKey;

export function OrdersPage() {
  const signedIn = useSignedIn();
  const orders = useActiveOrders();
  const [filter, setFilter] = useState<OrderFilter>({ state: 'all', type: 'all', q: '' });
  const ids = { q: useId(), type: useId() };

  const all = useMemo(() => orders.data ?? [], [orders.data]);
  const counts = useMemo(() => countByFilter(all), [all]);
  const shown = useMemo(() => filterOrders(all, filter), [all, filter]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('console.orders_title')} subtitle={t('console.orders_subtitle')}>
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
                  <span className="tabular-nums opacity-80">{counts[f]}</span>
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <div>
                <label htmlFor={ids.q} className="sr-only">
                  {t('console.search')}
                </label>
                <input
                  id={ids.q}
                  type="search"
                  dir="auto"
                  placeholder={t('console.orders_search')}
                  className={inputCls}
                  value={filter.q}
                  onChange={(e) => setFilter((p) => ({ ...p, q: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor={ids.type} className="sr-only">
                  {t('console.orders_type')}
                </label>
                <select
                  id={ids.type}
                  className={inputCls}
                  value={filter.type}
                  onChange={(e) => setFilter((p) => ({ ...p, type: e.target.value as OrderType | 'all' }))}
                >
                  <option value="all">{t('console.orders_type_all')}</option>
                  {OrderTypeEnum.options.map((ty) => (
                    <option key={ty} value={ty}>
                      {orderTypeLabel(ty)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-faint">{t('console.orders_active_only')}</p>
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
                          <Chip tone={ORDER_STATE_TONE[o.state]}>{orderStateLabel(o.state)}</Chip>
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
                        <Chip tone={ORDER_STATE_TONE[o.state]}>{orderStateLabel(o.state)}</Chip>
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
            </>
          )}
        </>
      )}
    </div>
  );
}
