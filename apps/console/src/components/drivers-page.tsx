'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { RosterRole, type RosterRole as RosterRoleT } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { formatClock, shortId } from '@/lib/format';
import { capRoleLabel, capTierLabel, pinStateLabel, vehicleLabel, zoneName } from '@/lib/labels';
import { CITY_ID, LIVE_POLL_MS, queryRetry, useMerchants } from '@/lib/live';
import { flattenRoster, merchantOptionLabel, merchantsForPicker, PIN_STATE_TONE, PRESENCE_FILTERS, rosterInput, type PresenceFilter, type RosterFilter } from '@/lib/roster';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { MerchantBalanceCard } from './merchant-balance-card';
import { Card, Chip, EmptyState, ghostBtn, inputCls, LiveBadge, Mono, NeedLogin, PageHeader, QueryError } from './ui';

const presenceKey = (p: PresenceFilter) => `console.presence_${p}` as MessageKey;
const PAGE = 50;

export function DriversPage() {
  const signedIn = useSignedIn();
  const trpc = useTRPC();
  const [filter, setFilter] = useState<RosterFilter>({ presence: 'all', role: 'all', q: '' });
  const ids = { q: useId(), role: useId() };
  const input = rosterInput(CITY_ID, filter, PAGE);
  const roster = useInfiniteQuery(
    trpc.drivers.list.infiniteQueryOptions(input, {
      enabled: signedIn,
      retry: queryRetry,
      refetchInterval: LIVE_POLL_MS * 5,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
  const rows = useMemo(() => flattenRoster(roster.data?.pages), [roster.data]);
  const total = roster.data?.pages[0]?.total ?? 0;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('console.drivers_title')} subtitle={t('console.drivers_roster_subtitle')}>
        {signedIn && <LiveBadge seconds={(LIVE_POLL_MS * 5) / 1000} updatedAt={roster.dataUpdatedAt} fetching={roster.isFetching} />}
      </PageHeader>

      {!signedIn ? (
        <NeedLogin />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <div className="space-y-3">
              <div role="group" aria-label={t('console.presence')} className="flex flex-wrap gap-2">
                {PRESENCE_FILTERS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={filter.presence === p}
                    onClick={() => setFilter((f) => ({ ...f, presence: p }))}
                    className={`rounded-pill border px-3 py-1.5 text-sm transition-colors ${
                      filter.presence === p ? 'border-accent bg-accent font-semibold text-on-accent' : 'border-line bg-surface-2 hover:border-muted'
                    }`}
                  >
                    {t(presenceKey(p))}
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
                    dir="ltr"
                    placeholder={t('console.drivers_search')}
                    className={inputCls}
                    value={filter.q}
                    onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor={ids.role} className="sr-only">
                    {t('console.drivers_role')}
                  </label>
                  <select id={ids.role} className={inputCls} value={filter.role} onChange={(e) => setFilter((f) => ({ ...f, role: e.target.value as RosterRoleT | 'all' }))}>
                    <option value="all">{t('console.drivers_role_all')}</option>
                    {RosterRole.options.map((r) => (
                      <option key={r} value={r}>
                        {capRoleLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {roster.error && <QueryError error={roster.error} onRetry={() => void roster.refetch()} />}
            {roster.isSuccess && rows.length === 0 && <EmptyState title={t('console.drivers_none')} />}

            {rows.length > 0 && (
              <Card title={t('console.drivers_count', { shown: rows.length, total })}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted">
                      <tr className="border-b border-line">
                        <th scope="col" className="py-2 text-start font-medium">
                          {t('console.col_driver')}
                        </th>
                        <th scope="col" className="py-2 text-start font-medium">
                          {t('console.col_state')}
                        </th>
                        <th scope="col" className="hidden py-2 text-start font-medium md:table-cell">
                          {t('console.drivers_role')}
                        </th>
                        <th scope="col" className="hidden py-2 text-start font-medium sm:table-cell">
                          {t('console.driver_tier')}
                        </th>
                        <th scope="col" className="hidden py-2 text-start font-medium md:table-cell">
                          {t('console.driver_where')}
                        </th>
                        <th scope="col" className="py-2 text-end font-medium">
                          <span className="sr-only">{t('console.open_ledger')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d) => (
                        <tr key={d.personId} className="border-b border-line/60 last:border-b-0">
                          <td className="py-2">
                            <Mono title={d.personId}>{shortId(d.personId)}</Mono>
                            {d.frozen && (
                              <span className="ms-2">
                                <Chip tone="bad">{t('console.driver_frozen')}</Chip>
                              </span>
                            )}
                          </td>
                          <td className="py-2">
                            {d.state ? <Chip tone={PIN_STATE_TONE[d.state]}>{pinStateLabel(d.state)}</Chip> : <Chip>{t('console.presence_offline')}</Chip>}
                            {d.vehicleClass && <span className="ms-2 text-xs text-muted">{vehicleLabel(d.vehicleClass)}</span>}
                          </td>
                          <td className="hidden py-2 md:table-cell">{d.roles.map(capRoleLabel).join('، ')}</td>
                          <td className="hidden py-2 sm:table-cell">
                            <span title={t('console.driver_score', { index: d.scoreIndex })}>{capTierLabel(d.tier)}</span>
                            {d.observation && <span className="ms-1 text-xs text-faint">{t('console.driver_observation')}</span>}
                          </td>
                          <td className="hidden py-2 text-xs text-muted md:table-cell">
                            {d.zoneId ? zoneName(d.zoneId) : '—'}
                            {d.lastSeenAt && <span className="block">{t('console.driver_seen_at', { time: formatClock(d.lastSeenAt) })}</span>}
                          </td>
                          <td className="py-2 text-end">
                            <Link href={`/drivers/${encodeURIComponent(d.personId)}/ledger`} className="rounded-md text-accent underline">
                              {t('console.open_ledger')}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {roster.hasNextPage && (
                  <button type="button" className={`${ghostBtn} mt-3 w-full`} disabled={roster.isFetchingNextPage} onClick={() => void roster.fetchNextPage()}>
                    {roster.isFetchingNextPage ? t('status.loading') : t('console.load_more')}
                  </button>
                )}
              </Card>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <OpenById />
            <MerchantPicker />
          </div>
        </div>
      )}
    </div>
  );
}

function OpenById() {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (v) router.push(`/drivers/${encodeURIComponent(v)}/ledger`);
  };
  return (
    <Card title={t('console.drivers_open_by_id')}>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor={id} className="sr-only">
          {t('console.override_driver')}
        </label>
        <input id={id} dir="ltr" className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('console.override_driver')} />
        <button type="submit" className={ghostBtn} disabled={!value.trim()}>
          {t('console.open')}
        </button>
      </form>
    </Card>
  );
}

/** Pick a merchant from `merchants.list` (live balance in the label) instead of typing an id. */
function MerchantPicker() {
  const id = useId();
  const merchants = useMerchants();
  const [merchantId, setMerchantId] = useState('');
  const list = useMemo(() => merchantsForPicker(merchants.data ?? []), [merchants.data]);
  return (
    <div className="space-y-4">
      <Card title={t('console.merchant_balance')}>
        {merchants.error && <QueryError error={merchants.error} onRetry={() => void merchants.refetch()} />}
        {merchants.isSuccess && list.length === 0 && <p className="text-sm text-muted">{t('console.merchants_none')}</p>}
        {list.length > 0 && (
          <>
            <label htmlFor={id} className="mb-1.5 block text-sm text-muted">
              {t('console.merchant_pick')}
            </label>
            <select id={id} className={inputCls} value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
              <option value="">{t('console.merchant_pick_placeholder')}</option>
              {list.map((m) => (
                <option key={m.merchantId} value={m.merchantId}>
                  {m.overExposure ? '⚠ ' : ''}
                  {merchantOptionLabel(m)}
                </option>
              ))}
            </select>
          </>
        )}
      </Card>
      {merchantId && <MerchantBalanceCard key={merchantId} merchantId={merchantId} />}
    </div>
  );
}
