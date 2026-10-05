'use client';

import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AZIZIYAH_ZONES, OrderType as OrderTypeEnum, parseOrderTicket, PaymentMethod as PaymentEnum, type OrderSummary, type OrderType, type PaymentMethod } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useDeferredValue, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { formatIqd } from '@/lib/format';
import { orderTypeLabel, paymentLabel, zoneName } from '@/lib/labels';
import { CITY_ID, queryRetry, SLOW_POLL_MS, useMerchants } from '@/lib/live';
import { activeFilterCount, EMPTY_FILTER, listInput, ORDER_VIEW_KEYS, sortSummaries, type ListFilter, type ListSort, type OrderView } from '@/lib/orders';
import { PERIOD_PRESETS, rangeWords, stamp, type PeriodPreset } from '@/lib/periods';
import { countText } from '@/lib/plural';
import { useRowKeys } from '@/lib/row-keys';
import { useSignedIn } from '@/lib/session';
import { compactDuration } from '@/lib/support-views';
import { useTRPC } from '@/lib/trpc';
import { useNames } from '@/lib/names';
import { OrderRef, OrgName, PersonName } from './named';
import { OrderStatus } from './order-status';
import { PeriodPicker } from './period-picker';
import {
  Button,
  CountBadge,
  cx,
  DataTable,
  IconClock,
  IconSearch,
  Input,
  KeyboardHint,
  LiveBadge,
  NeedLogin,
  PageHeader,
  QueryError,
  Select,
  Tabs,
  useNow,
  type Column,
} from './ui';

const PAGE = 50;
const PRESETS: readonly PeriodPreset[] = PERIOD_PRESETS.filter((p) => p !== 'month');
const VIEW_PARAM = 'view';

/**
 * Order history (`orders.search`): saved views (الكل، شغّالة، متأخرة، ملغية، نزاعات) over every state,
 * a period on the city's clock, and the narrowing filters, all on the server; newest first or the
 * latest first; a row opens the order. "#1284" finds the order over today and yesterday whatever the
 * period says.
 */
export function OrdersPage() {
  const signedIn = useSignedIn();
  const trpc = useTRPC();
  const router = useRouter();
  const now = new Date(useNow(60_000));
  const [filter, setFilter] = useState<ListFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<ListSort | null>(null);
  const q = useDeferredValue(filter.q);
  const ticket = parseOrderTicket(q);
  const set = (patch: Partial<ListFilter>) => setFilter((f) => ({ ...f, ...patch }));

  // The view lives in the URL so a view can be linked ("/orders?view=late").
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get(VIEW_PARAM);
    if (v && (ORDER_VIEW_KEYS as readonly string[]).includes(v)) set({ view: v as OrderView });
  }, []);
  const setView = (view: OrderView) => {
    set({ view });
    setSort(null);
    const url = new URL(window.location.href);
    if (view === 'all') url.searchParams.delete(VIEW_PARAM);
    else url.searchParams.set(VIEW_PARAM, view);
    window.history.replaceState(null, '', url);
  };

  const dayKey = now.toISOString().slice(0, 13);
  const input = useMemo(() => listInput(CITY_ID, { ...filter, q }, now, Boolean(ticket), PAGE), [filter, q, ticket, dayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const orders = useInfiniteQuery(
    trpc.orders.search.infiniteQueryOptions(input, {
      enabled: signedIn,
      retry: queryRetry,
      refetchInterval: SLOW_POLL_MS,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
  // The late view's count rides on the tab (one light read, whatever view is open).
  const late = useQuery(trpc.orders.search.queryOptions({ cityId: CITY_ID, late: true, limit: 100 }, { enabled: signedIn, retry: queryRetry, refetchInterval: SLOW_POLL_MS * 2 }));
  const lateCount = late.data?.rows.length ?? 0;

  const loaded = useMemo(() => {
    const seen = new Set<string>();
    const out: OrderSummary[] = [];
    for (const page of orders.data?.pages ?? [])
      for (const o of page.rows) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        out.push(o);
      }
    return out;
  }, [orders.data]);
  const effectiveSort: ListSort = sort ?? (filter.view === 'late' || filter.view === 'active' ? 'late' : 'newest');
  const rows = useMemo(() => sortSummaries(loaded, effectiveSort), [loaded, effectiveSort]);
  // One batched name read for the page (K-01): customers and restaurants.
  useNames({ people: rows.map((o) => o.ordererId), orgs: rows.flatMap((o) => (o.merchantOrgId ? [o.merchantOrgId] : [])) });
  const open = (o: OrderSummary) => router.push(`/orders/${encodeURIComponent(o.id)}`);
  const [activeKey, setActiveKey] = useRowKeys(rows, (o) => o.id, open, signedIn);

  const columns: Column<OrderSummary>[] = [
    {
      key: 'order',
      header: t('console.col_order'),
      width: '9.5rem',
      cell: (o) => (
        <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
          <OrderRef id={o.id} strong />
          <span className="text-xs text-muted">{orderTypeLabel(o.type)}</span>
        </span>
      ),
    },
    {
      key: 'state',
      header: t('console.col_state'),
      width: '9rem',
      cell: (o) => <OrderStatus state={o.state} />,
    },
    {
      key: 'late',
      header: (
        <button
          type="button"
          onClick={() => setSort(effectiveSort === 'late' ? 'newest' : 'late')}
          aria-pressed={effectiveSort === 'late'}
          title={effectiveSort === 'late' ? t('console.orders_sort_newest') : t('console.orders_sort_late')}
          className={cx('-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-text', effectiveSort === 'late' && 'font-semibold text-text')}
        >
          {t('console.col_late')}
          <span aria-hidden className="text-[10px]">
            {effectiveSort === 'late' ? '▼' : '↕'}
          </span>
        </button>
      ),
      width: '7rem',
      cell: (o) =>
        o.lateMin !== null ? (
          <span className="num inline-flex items-center gap-1 whitespace-nowrap font-semibold text-bad" title={t('console.orders_late_by', { time: compactDuration(o.lateMin * 60_000) })}>
            <IconClock size={14} className="shrink-0" />
            {compactDuration(o.lateMin * 60_000)}
          </span>
        ) : null,
    },
    {
      key: 'merchant',
      header: t('console.col_merchant'),
      cell: (o) => (o.merchantOrgId ? <OrgName id={o.merchantOrgId} copy={false} /> : <span className="text-faint">—</span>),
    },
    { key: 'customer', header: t('console.col_customer'), cell: (o) => <PersonName id={o.ordererId} copy={false} /> },
    { key: 'zone', header: t('console.col_zone'), cell: (o) => (o.zoneKey ? <span className="block max-w-[11rem] truncate text-muted" title={zoneName(o.zoneKey)}>{zoneName(o.zoneKey)}</span> : <span className="text-faint">—</span>) },
    { key: 'payment', header: t('console.col_payment'), width: '6rem', cell: (o) => <span className="text-muted">{paymentLabel(o.paymentMethod)}</span> },
    { key: 'placed', header: t('console.col_placed'), width: '10rem', cell: (o) => <span className="num whitespace-nowrap text-muted">{stamp(o.placedAt, now)}</span> },
    { key: 'total', header: <span className="whitespace-nowrap">{t('console.col_total_iqd')}</span>, numeric: true, width: '8rem', cell: (o) => <span className="font-medium">{formatIqd(o.totalIqd)}</span> },
  ];

  const filtersOn = activeFilterCount(filter);
  const empty =
    filter.view === 'late'
      ? { title: t('console.orders_empty_late'), hint: t('console.orders_empty_late_hint') }
      : {
          title: t('console.orders_empty'),
          hint: t('console.orders_empty_hint'),
          action: filtersOn ? (
            <Button size="sm" onClick={() => setFilter((f) => ({ ...EMPTY_FILTER, view: f.view, period: { preset: 'all' } }))}>
              {t('console.orders_filter_clear')}
            </Button>
          ) : undefined,
        };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title={t('console.orders_title')} subtitle={t('console.orders_history_subtitle')}>
        {signedIn && <LiveBadge seconds={SLOW_POLL_MS / 1000} updatedAt={orders.dataUpdatedAt} fetching={orders.isFetching} error={Boolean(orders.error)} />}
      </PageHeader>

      {!signedIn ? (
        <NeedLogin />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line">
            <Tabs
              label={t('console.orders_views')}
              value={filter.view}
              onChange={setView}
              className="border-b-0"
              options={ORDER_VIEW_KEYS.map((v) => ({
                value: v,
                label:
                  v === 'late' ? (
                    <span className="inline-flex items-center gap-1.5">
                      {t('console.orders_view_late')}
                      <CountBadge n={lateCount} alert />
                    </span>
                  ) : (
                    t(`console.orders_view_${v}` as MessageKey)
                  ),
              }))}
            />
            <PeriodPicker className="mb-2" presets={PRESETS} value={filter.period} onChange={(period) => set({ period })} now={now} disabled={Boolean(ticket) || filter.view === 'late'} />
          </div>

          <FilterBar filter={filter} set={set} onClear={() => setFilter((f) => ({ ...EMPTY_FILTER, view: f.view, period: f.period, q: f.q }))} count={filtersOn} />

          <div className="mb-2 flex min-h-6 flex-wrap items-center justify-between gap-2 text-dense text-muted">
            {ticket ? (
              <p role="status">{t('console.orders_ticket_hint', { ticket: `⁦#${ticket}⁩` })}</p>
            ) : (
              <p>
                <span className="font-medium text-text">{filter.view === 'late' ? t('console.orders_late_now') : rangeWords(filter.period, now)}</span>
                {orders.isSuccess ? (
                  <span className="num">
                    {' · '}
                    {orders.hasNextPage ? t('console.orders_count_more', { n: rows.length }) : countText('console.orders_count', rows.length)}
                  </span>
                ) : null}
              </p>
            )}
            {rows.length > 0 ? <KeyboardHint keys={['J', 'K', '↵']} label={t('console.list_keys_hint')} /> : null}
          </div>

          {orders.error ? (
            <QueryError error={orders.error} onRetry={() => void orders.refetch()} />
          ) : (
            <DataTable
              columns={columns}
              rows={orders.isPending ? undefined : rows}
              loading={orders.isPending}
              rowKey={(o) => o.id}
              onRowClick={(o) => {
                setActiveKey(o.id);
                open(o);
              }}
              activeKey={activeKey}
              caption={t('console.orders_title')}
              empty={empty}
            />
          )}

          {orders.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button loading={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()}>
                {t('console.load_more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterBar({ filter, set, onClear, count }: { filter: ListFilter; set: (p: Partial<ListFilter>) => void; onClear: () => void; count: number }) {
  const merchants = useMerchants();
  const ids = { q: useId(), type: useId(), merchant: useId(), zone: useId(), payment: useId() };
  const zones = useMemo(() => [...AZIZIYAH_ZONES].map((z) => ({ id: z.id, name: zoneName(z.id) })).sort((a, b) => a.name.localeCompare(b.name, 'ar')), []);
  const merchantList = useMemo(() => [...(merchants.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'ar')), [merchants.data]);
  const on = 'border-accent-text/60 bg-accent-wash font-medium';
  return (
    <div role="group" aria-label={t('console.orders_filters')} className="mb-3 flex flex-wrap items-center gap-2">
      <div className="w-full sm:w-60 2xl:w-72">
        <label htmlFor={ids.q} className="sr-only">
          {t('console.search')}
        </label>
        <Input id={ids.q} type="search" leading={<IconSearch size={16} />} placeholder={t('console.orders_search_history')} value={filter.q} onChange={(e) => set({ q: e.target.value })} />
      </div>
      <FilterSelect id={ids.type} label={t('console.orders_label_type')} active={filter.type !== 'all'} onCls={on} value={filter.type} onChange={(v) => set({ type: v as OrderType | 'all' })}>
        <option value="all">{t('console.orders_filter_type')}</option>
        {OrderTypeEnum.options.map((ty) => (
          <option key={ty} value={ty}>
            {orderTypeLabel(ty)}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect id={ids.merchant} label={t('console.orders_label_merchant')} active={Boolean(filter.merchantOrgId)} onCls={on} value={filter.merchantOrgId} onChange={(v) => set({ merchantOrgId: v })} wide>
        <option value="">{t('console.orders_filter_merchant')}</option>
        {merchantList.map((m) => (
          <option key={m.merchantId} value={m.merchantId}>
            {m.name}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect id={ids.zone} label={t('console.orders_label_zone')} active={Boolean(filter.zoneKey)} onCls={on} value={filter.zoneKey} onChange={(v) => set({ zoneKey: v })}>
        <option value="">{t('console.orders_filter_zone')}</option>
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect id={ids.payment} label={t('console.orders_label_payment')} active={filter.payment !== 'all'} onCls={on} value={filter.payment} onChange={(v) => set({ payment: v as PaymentMethod | 'all' })}>
        <option value="all">{t('console.orders_filter_payment')}</option>
        {PaymentEnum.options.map((p) => (
          <option key={p} value={p}>
            {paymentLabel(p)}
          </option>
        ))}
      </FilterSelect>
      {count > 0 && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t('console.orders_filter_clear')}
          <span className="num text-xs text-faint">{count}</span>
        </Button>
      )}
    </div>
  );
}

function FilterSelect({ id, label, active, onCls, value, onChange, children, wide }: { id: string; label: string; active: boolean; onCls: string; value: string; onChange: (v: string) => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'w-44 2xl:w-52' : 'w-36 2xl:w-40'}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} title={label} className={cx('text-dense', active && onCls)} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </div>
  );
}
