'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { CustomerFilter, CustomerRow } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { formatIqd } from '@/lib/format';
import { zoneName } from '@/lib/labels';
import { CITY_ID, LIVE_POLL_MS, queryRetry } from '@/lib/live';
import { useNames } from '@/lib/names';
import { CUSTOMER_FILTERS, everyText, filterLabel, versus } from '@/lib/people';
import { dayMonth, stamp } from '@/lib/periods';
import { countText } from '@/lib/plural';
import { useRowKeys } from '@/lib/row-keys';
import { useSignedIn } from '@/lib/session';
import { useLinkedFilters } from '@/lib/url-state';
import { useTRPC } from '@/lib/trpc';
import { CopyLinkButton } from '../copy-link';
import { NewTicketDialog } from '../support/new-ticket';
import { Avatar, Button, buttonCls, cx, DataTable, IconClose, IconSearch, Input, KeyboardHint, LiveBadge, NeedLogin, PageHeader, QueryError, Segmented, Skeleton, Sparkline, Stat, StatStrip, useNow, type Column } from '../ui';
import { Bars } from './charts';
import { Block, Facts, RecentOrders, SegmentChip, Signals } from './bits';
import { RevealPhone } from './reveal-phone';

const PAGE = 40;
const POLL_MS = LIVE_POLL_MS * 10;
const LINK_DEFAULTS = { filter: 'all' };
const LINK_ALLOWED = { filter: CUSTOMER_FILTERS };

/**
 * «الزبائن» (Ali 2026-10-21): every customer with how much and how lately they order, as a list
 * with a quick panel beside it (a row click) and the whole profile one step further (Enter, or
 * «افتح الصفحة الكاملة»). The segments and counts come from the last 90 days of the city's orders.
 */
export function CustomersPage() {
  const signedIn = useSignedIn();
  const trpc = useTRPC();
  const router = useRouter();
  const now = new Date(useNow(60_000));
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const q = useDeferredValue(search.trim());
  const searchId = useId();
  useLinkedFilters({ filter }, LINK_DEFAULTS, (got) => (got['filter'] ? setFilter(got['filter'] as CustomerFilter) : undefined), LINK_ALLOWED);

  const list = useInfiniteQuery(
    trpc.people.customers.infiniteQueryOptions(
      { cityId: CITY_ID, filter, limit: PAGE, ...(q.length >= 2 ? { q } : {}) },
      { enabled: signedIn, retry: queryRetry, refetchInterval: POLL_MS, getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
  );
  const first = list.data?.pages[0];
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  const names = useNames({ people: rows.map((r) => r.personId) });
  const open = (r: CustomerRow) => router.push(`/customers/${encodeURIComponent(r.personId)}`);
  const [activeKey, setActiveKey] = useRowKeys(rows, (r) => r.personId, open, signedIn);
  const active = first ? versus(first.active30d, first.activePrev30d) : null;

  const columns: Column<CustomerRow>[] = [
    {
      key: 'who',
      header: t('console.ppl_col_customer'),
      cell: (r) => {
        const p = names.person(r.personId);
        return (
          <span className="flex min-w-0 items-center gap-3">
            <Avatar id={r.personId} name={p?.displayName} />
            <span className="min-w-0 leading-5">
              <Link
                href={`/customers/${encodeURIComponent(r.personId)}`}
                onClick={(e) => e.stopPropagation()}
                className="block truncate font-semibold text-text hover:text-accent-text hover:underline"
                title={r.personId}
              >
                {p?.displayName ?? r.personId}
              </Link>
              <span className="block truncate text-xs text-muted">{t('console.ppl_since', { date: dayMonth(r.joinedAt, now) })}</span>
            </span>
          </span>
        );
      },
    },
    { key: 'seg', header: t('console.ppl_col_segment'), width: '8rem', cell: (r) => <SegmentChip segment={r.segment} /> },
    {
      key: 'orders',
      header: t('console.ppl_col_orders'),
      width: '10rem',
      cell: (r) => (
        <span className="flex items-center gap-3">
          <span className="num w-8 font-medium">{r.orders}</span>
          {r.weekly.some((w) => w > 0) ? <Sparkline values={r.weekly} width={64} height={20} /> : null}
        </span>
      ),
    },
    {
      key: 'spent',
      header: t('console.ppl_col_spent'),
      width: '9rem',
      hideOnPhone: true,
      cell: (r) =>
        r.spentIqd > 0 ? (
          <span className="num whitespace-nowrap">
            {formatIqd(r.spentIqd)} <span className="text-xs text-muted">{t('quote.currency')}</span>
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: 'last',
      header: t('console.ppl_col_last'),
      width: '8.5rem',
      hideOnPhone: true,
      cell: (r) => (r.lastOrderAt ? <span className="whitespace-nowrap">{stamp(r.lastOrderAt, now)}</span> : <span className="text-faint">—</span>),
    },
    { key: 'zone', header: t('console.ppl_col_zone'), width: '8rem', hideOnPhone: true, cell: (r) => (r.zoneKey ? zoneName(r.zoneKey) : <span className="text-faint">—</span>) },
  ];

  const filtersOn = filter !== 'all' || search.trim() !== '';
  const clear = () => {
    setFilter('all');
    setSearch('');
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title={t('console.ppl_customers_title')} subtitle={t('console.ppl_customers_subtitle')}>
        {signedIn && <LiveBadge seconds={POLL_MS / 1000} updatedAt={list.dataUpdatedAt} fetching={list.isFetching} error={Boolean(list.error)} />}
      </PageHeader>

      {!signedIn ? (
        <NeedLogin />
      ) : (
        <>
          <StatStrip className="mb-5">
            <Stat label={t('console.ppl_kpi_total')} value={first?.counts.all ?? "—"} />
            <Stat
              label={t('console.ppl_kpi_active')}
              value={first ? first.active30d : '—'}
              {...(active !== null ? { delta: { value: active, text: t('console.ppl_vs_prev_month', { pct: Math.abs(active) }), goodWhen: 'up' as const } } : {})}
            />
            <Stat label={t('console.ppl_kpi_new')} value={first ? first.counts.new : '—'} tone="accent" />
            <Stat label={t('console.ppl_kpi_lapsed')} value={first ? first.counts.lapsed : '—'} tone={(first?.counts.lapsed ?? 0) > 0 ? 'warn' : 'default'} />
            <Stat label={t('console.ppl_kpi_issue')} value={first ? first.counts.issue : '—'} tone={(first?.counts.issue ?? 0) > 0 ? 'bad' : 'default'} />
          </StatStrip>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-72">
              <label htmlFor={searchId} className="sr-only">
                {t('console.ppl_search')}
              </label>
              <Input id={searchId} type="search" leading={<IconSearch size={16} />} placeholder={t('console.ppl_search')} title={t('console.ppl_search_logged')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Segmented
              label={t('console.ppl_filter_label')}
              value={filter}
              onChange={setFilter}
              className="max-w-full overflow-x-auto"
              options={CUSTOMER_FILTERS.map((f) => ({ value: f, label: filterLabel(f), ...(first ? { count: first.counts[f] } : {}) }))}
            />
            {filtersOn ? (
              <Button variant="ghost" size="sm" onClick={clear}>
                {t('console.orders_filter_clear')}
              </Button>
            ) : null}
            <span className="ms-auto">
              <CopyLinkButton />
            </span>
          </div>

          <div className="mb-2 flex min-h-6 flex-wrap items-center justify-between gap-2 text-dense text-muted">
            <p className="num">{first ? (rows.length < first.total ? t('console.ppl_count', { shown: rows.length, total: first.total }) : countText('console.ppl_customers_n', first.total)) : ''}</p>
            {rows.length > 0 ? <KeyboardHint keys={['J', 'K', '↵']} label={t('console.ppl_keys_hint')} /> : null}
          </div>

          <div className={cx('grid items-start gap-4', picked && 'xl:grid-cols-[minmax(0,1fr)_400px]')}>
            <div className="min-w-0">
              {list.error ? (
                <QueryError error={list.error} onRetry={() => void list.refetch()} />
              ) : (
                <DataTable
                  columns={columns}
                  rows={list.isPending ? undefined : rows}
                  loading={list.isPending}
                  rowKey={(r) => r.personId}
                  onRowClick={(r) => {
                    setActiveKey(r.personId);
                    setPicked(r.personId);
                  }}
                  activeKey={activeKey}
                  caption={t('console.ppl_customers_title')}
                  empty={{
                    title: t('console.ppl_none'),
                    hint: filtersOn ? t('console.ppl_none_hint') : t('console.ppl_none_yet'),
                    action: filtersOn ? (
                      <Button size="sm" onClick={clear}>
                        {t('console.orders_filter_clear')}
                      </Button>
                    ) : undefined,
                  }}
                />
              )}
              {list.hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <Button loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                    {t('console.load_more')}
                  </Button>
                </div>
              )}
            </div>
            {picked ? <QuickPanel personId={picked} name={names.person(picked)?.displayName ?? null} onClose={() => setPicked(null)} /> : null}
          </div>
        </>
      )}
    </div>
  );
}

/** The side panel: who they are, what to know, the last 8 weeks and last orders, and the next step. */
function QuickPanel({ personId, name, onClose }: { personId: string; name: string | null; onClose: () => void }) {
  const trpc = useTRPC();
  const now = new Date(useNow(60_000));
  const [ticket, setTicket] = useState(false);
  const p = useQuery(trpc.people.customer.queryOptions({ cityId: CITY_ID, personId }, { retry: queryRetry, staleTime: 30_000 }));
  const d = p.data;
  const weeks = d ? d.weekly.slice(-8) : [];
  return (
    <aside aria-label={t('console.ppl_panel')} className="rounded-lg border border-line bg-surface shadow-card xl:sticky xl:top-4">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <Avatar id={personId} name={d?.name ?? name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold leading-7">
            <span className="truncate">{d?.name ?? name ?? personId}</span>
            {d ? <SegmentChip segment={d.segment} /> : null}
          </h2>
          {d ? (
            <div className="mt-1">
              <RevealPhone personId={personId} masked={d.phoneMasked} />
            </div>
          ) : null}
        </div>
        <button type="button" onClick={onClose} aria-label={t('console.close')} className="-m-1 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text">
          <IconClose size={18} />
        </button>
      </div>
      <div className="space-y-5 px-5 py-4">
        {p.error ? (
          <QueryError error={p.error} onRetry={() => void p.refetch()} />
        ) : !d ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <Facts
              items={[
                t('console.ppl_since', { date: dayMonth(d.joinedAt, now) }),
                d.lastActiveAt ? t('console.ppl_last_active', { when: stamp(d.lastActiveAt, now) }) : null,
              ]}
            />
            <Signals signals={d.signals.slice(0, 3)} />
            <dl className="grid grid-cols-3 gap-3 rounded-md bg-surface-2 px-3 py-2.5">
              <Mini label={t('console.ppl_stat_orders')} value={String(d.totals.orders)} />
              <Mini label={t('console.ppl_stat_avg')} value={d.totals.avgOrderIqd !== null ? formatIqd(d.totals.avgOrderIqd) : '—'} />
              <Mini label={t('console.ppl_stat_every')} value={d.totals.everyDays !== null ? everyText(d.totals.everyDays) : '—'} />
            </dl>
            {weeks.some((w) => w > 0) ? (
              <Block title={t('console.ppl_chart_weekly_8')}>
                <Bars values={weeks} tips={weeks.map((n) => String(n))} label={t('console.ppl_chart_weekly_8')} height={56} partialLast showValues={false} />
              </Block>
            ) : null}
            <Block title={t('console.ppl_recent')}>
              <RecentOrders orders={d.recent.slice(0, 4)} customerId={personId} compact />
            </Block>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
        <Link href={`/customers/${encodeURIComponent(personId)}`} className={buttonCls('primary', 'lg')}>
          {t('console.ppl_open_full')}
        </Link>
        <Button size="lg" onClick={() => setTicket(true)}>
          {t('console.ppl_open_ticket')}
        </Button>
      </div>
      <NewTicketDialog open={ticket} onClose={() => setTicket(false)} customerId={personId} />
    </aside>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className="num m-0 truncate text-[17px] font-semibold leading-7">{value}</dd>
    </div>
  );
}
