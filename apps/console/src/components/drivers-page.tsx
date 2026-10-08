'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { DriverTier as DriverTierEnum, RosterRole, type DriverRosterRow, type DriverTier, type RosterRole as RosterRoleT } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { formatIqd } from '@/lib/format';
import { capRoleLabel, capTierLabel, pinStateLabel, vehicleLabel, zoneName } from '@/lib/labels';
import { CITY_ID, LIVE_POLL_MS, queryRetry } from '@/lib/live';
import { markerStateForPin } from '@/lib/live-map';
import { useNames } from '@/lib/names';
import { dayMonth, stamp } from '@/lib/periods';
import { countText } from '@/lib/plural';
import { flattenRoster, PRESENCE_FILTERS, rosterInput, sortRoster, type PresenceFilter, type RosterFilter } from '@/lib/roster';
import { useRowKeys } from '@/lib/row-keys';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { CashCapBar } from './cash-cap';
import { StateGlyph } from './map-cards';
import { Avatar, Button, Chip, cx, DataTable, IconAlert, IconSearch, Input, KeyboardHint, LiveBadge, NeedLogin, PageHeader, QueryError, Segmented, Select, useNow, type Column } from './ui';

const PAGE = 50;
const POLL_MS = LIVE_POLL_MS * 5;
const EMPTY: Required<RosterFilter> = { presence: 'all', role: 'all', q: '', tier: 'all', docsExpiring: false };

/**
 * Everyone with a driving role (`drivers.list`): search by name (a logged vault match on the API),
 * filters for the service, presence, tier and papers that are running out; each row says who he is
 * (initials, name, vehicle and plate), his state as the map draws it, today's jobs and earnings, his
 * cash against the cap and his tier. A row opens his ledger.
 */
export function DriversPage() {
  const signedIn = useSignedIn();
  const trpc = useTRPC();
  const router = useRouter();
  const now = new Date(useNow(60_000));
  const [filter, setFilter] = useState<Required<RosterFilter>>(EMPTY);
  const q = useDeferredValue(filter.q);
  const ids = { q: useId(), role: useId(), tier: useId() };
  const set = (patch: Partial<RosterFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const input = rosterInput(CITY_ID, { ...filter, q: q.trim().length === 1 ? '' : q }, PAGE);

  const roster = useInfiniteQuery(
    trpc.drivers.list.infiniteQueryOptions(input, {
      enabled: signedIn,
      retry: queryRetry,
      refetchInterval: POLL_MS,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
  // Counts beside the filters: who is online, and whose papers run out (one light read each).
  const online = useQuery(trpc.drivers.list.queryOptions({ cityId: CITY_ID, filter: { presence: 'online' }, limit: 1 }, { enabled: signedIn, retry: queryRetry, refetchInterval: POLL_MS * 2 }));
  const docs = useQuery(trpc.drivers.list.queryOptions({ cityId: CITY_ID, filter: { presence: 'all', docsExpiring: true }, limit: 1 }, { enabled: signedIn, retry: queryRetry, refetchInterval: POLL_MS * 6 }));
  const rows = useMemo(() => sortRoster(flattenRoster(roster.data?.pages)), [roster.data]);
  const total = roster.data?.pages[0]?.total ?? 0;
  const names = useNames({ people: rows.map((r) => r.personId) });
  const docsCount = docs.data?.total ?? 0;
  const onlineCount = online.data?.total ?? 0;
  const open = (d: DriverRosterRow) => router.push(`/drivers/${encodeURIComponent(d.personId)}/ledger`);
  const [activeKey, setActiveKey] = useRowKeys(rows, (d) => d.personId, open, signedIn);

  const columns: Column<DriverRosterRow>[] = [
    {
      key: 'driver',
      header: t('console.col_driver'),
      cell: (d) => {
        const p = names.person(d.personId);
        const vehicle = [d.vehicleClass ?? p?.vehicleClass ? vehicleLabel((d.vehicleClass ?? p?.vehicleClass)!) : null, p?.plate].filter(Boolean).join(' · ');
        return (
          <span className="flex min-w-0 items-center gap-3">
            <Avatar id={d.personId} name={p?.displayName} />
            <span className="min-w-0 leading-5">
              <Link
                href={`/drivers/${encodeURIComponent(d.personId)}/ledger`}
                onClick={(e) => e.stopPropagation()}
                className="block truncate font-semibold text-text hover:text-accent-text hover:underline"
                title={d.personId}
              >
                {p?.displayName ?? d.personId}
              </Link>
              <span className="block truncate text-xs text-muted">
                {[vehicle || null, d.roles.map(capRoleLabel).join(t('console.list_sep'))].filter(Boolean).join(' · ')}
              </span>
            </span>
            {d.frozen ? (
              <Chip tone="bad" size="sm">
                {t('console.driver_frozen')}
              </Chip>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'state',
      header: t('console.col_state'),
      width: '9.5rem',
      cell: (d) => {
        const state = d.state ? markerStateForPin(d.state) : 'offline';
        return (
          <span className="leading-5">
            <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap', d.state ? 'font-medium text-text' : 'text-muted')}>
              <StateGlyph state={state} size={14} />
              {d.state ? pinStateLabel(d.state) : t('console.presence_offline')}
            </span>
            <span className="block truncate text-xs text-faint">
              {d.zoneId ? zoneName(d.zoneId) : d.lastSeenAt ? stamp(d.lastSeenAt, now) : ''}
            </span>
          </span>
        );
      },
    },
    {
      key: 'today',
      header: t('console.col_today'),
      width: '8.5rem',
      cell: (d) =>
        d.today && (d.today.jobs > 0 || d.today.earningsIqd !== 0) ? (
          <span className="leading-5">
            <span className="num block font-medium">
              {formatIqd(d.today.earningsIqd)} <span className="text-xs font-normal text-muted">{t('quote.currency')}</span>
            </span>
            <span className="num block text-xs text-muted">{countText('console.driver_jobs', d.today.jobs)}</span>
          </span>
        ) : (
          <span className="text-xs text-faint">{d.today ? countText('console.driver_jobs', 0) : '—'}</span>
        ),
    },
    {
      key: 'cash',
      header: t('console.col_cash_cap'),
      width: '11rem',
      cell: (d) => (d.cash ? <CashCapBar compact owedIqd={d.cash.owedIqd} capIqd={d.cash.capIqd} overCap={d.cash.overCap} label={t('console.driver_cash_vs_cap')} /> : <span className="text-faint">—</span>),
    },
    {
      key: 'tier',
      header: t('console.driver_tier'),
      width: '10rem',
      cell: (d) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={t('console.driver_score', { index: d.scoreIndex })}>
          <TierMark tier={d.tier} />
          <span>{capTierLabel(d.tier)}</span>
          <span className="num text-xs text-muted">{d.scoreIndex}</span>
          {d.observation ? (
            <span className="text-xs text-faint" title={t('console.driver_observation_hint')}>
              {t('console.driver_observation_short')}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'docs',
      header: t('console.col_docs'),
      width: '9rem',
      cell: (d) =>
        d.docs ? (
          <Chip tone={d.docs.state === 'expired' ? 'bad' : 'warn'} size="sm">
            <IconAlert size={12} />
            {t(d.docs.state === 'expired' ? 'console.driver_docs_expired' : 'console.driver_docs_expiring', { day: dayMonth(d.docs.expiresAt, now) })}
          </Chip>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];

  const filtersOn = filter.role !== 'all' || filter.tier !== 'all' || filter.docsExpiring || filter.presence !== 'all' || filter.q.trim() !== '';

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title={t('console.drivers_title')} subtitle={t('console.drivers_roster_subtitle')}>
        {signedIn && <LiveBadge seconds={POLL_MS / 1000} updatedAt={roster.dataUpdatedAt} fetching={roster.isFetching} error={Boolean(roster.error)} />}
      </PageHeader>

      {!signedIn ? (
        <NeedLogin />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-72">
              <label htmlFor={ids.q} className="sr-only">
                {t('console.drivers_search_name')}
              </label>
              <Input id={ids.q} type="search" leading={<IconSearch size={16} />} placeholder={t('console.drivers_search_name')} title={t('console.drivers_search_logged')} value={filter.q} onChange={(e) => set({ q: e.target.value })} />
            </div>
            <Segmented
              label={t('console.presence')}
              value={filter.presence}
              onChange={(presence: PresenceFilter) => set({ presence })}
              options={PRESENCE_FILTERS.map((p) => ({ value: p, label: t(`console.presence_${p}` as MessageKey), ...(p === 'online' && online.isSuccess ? { count: onlineCount } : {}) }))}
            />
            <div className="w-40">
              <label htmlFor={ids.role} className="sr-only">
                {t('console.drivers_role')}
              </label>
              <Select id={ids.role} className={cx('text-dense', filter.role !== 'all' && 'border-accent-text/60 bg-accent-wash font-medium')} value={filter.role} onChange={(e) => set({ role: e.target.value as RosterRoleT | 'all' })}>
                <option value="all">{t('console.drivers_role_all')}</option>
                {RosterRole.options.map((r) => (
                  <option key={r} value={r}>
                    {capRoleLabel(r)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-36">
              <label htmlFor={ids.tier} className="sr-only">
                {t('console.driver_tier')}
              </label>
              <Select id={ids.tier} className={cx('text-dense', filter.tier !== 'all' && 'border-accent-text/60 bg-accent-wash font-medium')} value={filter.tier} onChange={(e) => set({ tier: e.target.value as DriverTier | 'all' })}>
                <option value="all">{t('console.drivers_tier_all')}</option>
                {DriverTierEnum.options.map((tier) => (
                  <option key={tier} value={tier}>
                    {capTierLabel(tier)}
                  </option>
                ))}
              </Select>
            </div>
            <Button aria-pressed={filter.docsExpiring} onClick={() => set({ docsExpiring: !filter.docsExpiring })} icon={<IconAlert size={15} className={docsCount > 0 ? 'text-warn' : undefined} />}>
              {t('console.drivers_docs_expiring')}
              {docs.isSuccess ? <span className="num text-xs text-muted">{docsCount}</span> : null}
            </Button>
            {filtersOn ? (
              <Button variant="ghost" size="sm" onClick={() => setFilter(EMPTY)}>
                {t('console.orders_filter_clear')}
              </Button>
            ) : null}
          </div>

          <div className="mb-2 flex min-h-6 flex-wrap items-center justify-between gap-2 text-dense text-muted">
            <p className="num">{roster.isSuccess ? (rows.length < total ? t('console.drivers_count', { shown: rows.length, total }) : countText('console.drivers_n', total)) : ''}</p>
            {rows.length > 0 ? <KeyboardHint keys={['J', 'K', '↵']} label={t('console.list_keys_hint')} /> : null}
          </div>

          {roster.error ? (
            <QueryError error={roster.error} onRetry={() => void roster.refetch()} />
          ) : (
            <DataTable
              columns={columns}
              rows={roster.isPending ? undefined : rows}
              loading={roster.isPending}
              rowKey={(d) => d.personId}
              onRowClick={(d) => {
                setActiveKey(d.personId);
                open(d);
              }}
              activeKey={activeKey}
              caption={t('console.drivers_title')}
              empty={{
                title: t('console.drivers_none'),
                hint: t('console.drivers_empty_hint'),
                action: filtersOn ? (
                  <Button size="sm" onClick={() => setFilter(EMPTY)}>
                    {t('console.orders_filter_clear')}
                  </Button>
                ) : undefined,
              }}
            />
          )}
          {roster.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button loading={roster.isFetchingNextPage} onClick={() => void roster.fetchNextPage()}>
                {t('console.load_more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Bronze, silver, gold as one to three filled pips (a shape, so the word is never alone in colour). */
function TierMark({ tier }: { tier: DriverTier }) {
  const n = tier === 'gold' ? 3 : tier === 'silver' ? 2 : 1;
  return (
    <span aria-hidden className="inline-flex gap-0.5" dir="ltr">
      {[0, 1, 2].map((i) => (
        <span key={i} className={cx('h-2 w-1 rounded-pill', i < n ? 'bg-accent-text' : 'bg-surface-3')} />
      ))}
    </span>
  );
}
