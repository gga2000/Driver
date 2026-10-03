'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { t, type MessageKey } from '@driver/i18n';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { driversFromBoard, type BoardDriverState } from '@/lib/board';
import { shortId } from '@/lib/format';
import { LIVE_POLL_MS, useActiveTrips, useDispatchBoard } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { MerchantBalanceCard } from './merchant-balance-card';
import { Card, Chip, EmptyState, ghostBtn, inputCls, LiveBadge, Mono, NeedLogin, PageHeader, QueryError, type ChipTone } from './ui';

const STATE_TONE: Record<BoardDriverState, ChipTone> = { on_job: 'live', offered: 'ready', suggested: 'neutral' };
const stateKey = (s: BoardDriverState) => `console.driver_state_${s}` as MessageKey;

export function DriversPage() {
  const signedIn = useSignedIn();
  const board = useDispatchBoard();
  const trips = useActiveTrips();
  const drivers = useMemo(() => driversFromBoard(board.data, trips.data ?? []), [board.data, trips.data]);
  const error = board.error ?? trips.error;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('console.drivers_title')} subtitle={t('console.drivers_subtitle')}>
        {signedIn && <LiveBadge seconds={LIVE_POLL_MS / 1000} updatedAt={board.dataUpdatedAt} fetching={board.isFetching} />}
      </PageHeader>

      {!signedIn ? (
        <NeedLogin />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {error && <QueryError error={error} onRetry={() => void Promise.all([board.refetch(), trips.refetch()])} />}
            {board.isSuccess && drivers.length === 0 && <EmptyState title={t('console.drivers_empty')} hint={t('console.drivers_roster_missing')} />}
            {drivers.length > 0 && (
              <Card>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-line">
                      <th scope="col" className="py-2 text-start font-medium">
                        {t('console.col_driver')}
                      </th>
                      <th scope="col" className="py-2 text-start font-medium">
                        {t('console.col_state')}
                      </th>
                      <th scope="col" className="hidden py-2 text-start font-medium sm:table-cell">
                        {t('console.col_trips')}
                      </th>
                      <th scope="col" className="py-2 text-end font-medium">
                        <span className="sr-only">{t('console.open_ledger')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((d) => (
                      <tr key={d.driverId} className="border-b border-line/60 last:border-b-0">
                        <td className="py-2">
                          <Mono title={d.driverId}>{shortId(d.driverId)}</Mono>
                        </td>
                        <td className="py-2">
                          <Chip tone={STATE_TONE[d.state]}>{t(stateKey(d.state))}</Chip>
                        </td>
                        <td className="hidden py-2 sm:table-cell">
                          <span className="flex flex-wrap gap-1">
                            {d.tripIds.slice(0, 3).map((id) => (
                              <Mono key={id} title={id}>
                                {shortId(id, 4, 3)}
                              </Mono>
                            ))}
                          </span>
                        </td>
                        <td className="py-2 text-end">
                          <Link href={`/drivers/${encodeURIComponent(d.driverId)}/ledger`} className="rounded-md text-accent underline">
                            {t('console.open_ledger')}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-faint">{t('console.drivers_roster_missing')}</p>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <OpenById />
            <MerchantLookup />
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

function MerchantLookup() {
  const id = useId();
  const [value, setValue] = useState('');
  const [merchantId, setMerchantId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Card title={t('console.merchant_balance')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setMerchantId(value.trim() || null);
          }}
          className="flex gap-2"
        >
          <label htmlFor={id} className="sr-only">
            {t('console.merchant_id')}
          </label>
          <input id={id} dir="ltr" className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('console.merchant_id')} />
          <button type="submit" className={ghostBtn} disabled={!value.trim()}>
            {t('console.merchant_lookup')}
          </button>
        </form>
      </Card>
      {merchantId && <MerchantBalanceCard key={merchantId} merchantId={merchantId} />}
    </div>
  );
}
