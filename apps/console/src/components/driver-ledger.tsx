'use client';

import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Statement } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useId, useMemo, useState } from 'react';
import { formatDayClock, formatIqd, formatSigned, shortId } from '@/lib/format';
import { capRoleLabel, capTierLabel } from '@/lib/labels';
import { capUsage, newestFirst } from '@/lib/ledger';
import { queryRetry } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { AccountName, CopyId, OrderRef, PersonName } from './named';
import { Card, EmptyState, ghostBtn, inputCls, Mono, NeedLogin, PageHeader, QueryError, Stat } from './ui';

type Tab = 'cash' | 'earnings';

/** `YYYY-MM-DD` from `<input type="date">` → local start/end of that day. */
function dayBound(value: string, end: boolean): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function DriverLedger({ driverId }: { driverId: string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const [tab, setTab] = useState<Tab>('cash');
  const [range, setRange] = useState({ from: '', to: '' });
  const ids = { from: useId(), to: useId() };
  const from = dayBound(range.from, false);
  const to = dayBound(range.to, true);

  const ledger = useQuery(
    trpc.ledger.driverLedger.queryOptions(
      { driverId, ...(from ? { from } : {}), ...(to ? { to } : {}) },
      { enabled: signedIn, retry: queryRetry, refetchInterval: 10_000, placeholderData: keepPreviousData },
    ),
  );
  const v = ledger.data;
  const cap = v ? capUsage(v.owedIqd, v.capIqd, v.overCap) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/drivers" className="rounded-md text-sm text-muted hover:text-accent">
        ← {t('console.ledger_back')}
      </Link>
      <div className="mt-3">
        <PageHeader
          title={t('console.ledger_title')}
          subtitle={v ? t('console.ledger_role_tier', { role: capRoleLabel(v.role), tier: capTierLabel(v.tier) }) : undefined}
        >
          <span className="inline-flex items-center gap-2 text-lg">
            <PersonName id={driverId} vehicle copy={false} strong />
            <Mono title={driverId}>{shortId(driverId, 8, 4)}</Mono>
            <CopyId id={driverId} />
          </span>
        </PageHeader>
      </div>

      {!signedIn && <NeedLogin />}
      {ledger.error && <QueryError error={ledger.error} onRetry={() => void ledger.refetch()} />}
      {signedIn && ledger.isPending && <p className="text-sm text-muted">{t('status.loading')}</p>}

      {v && cap && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t('console.ledger_cash_held')} value={formatIqd(v.cashBalanceIqd)} />
            <Stat label={t('console.ledger_owed')} value={formatIqd(v.owedIqd)} tone={cap.over ? 'bad' : 'default'} />
            <Stat label={t('console.ledger_earnings')} value={formatIqd(v.earningsBalanceIqd)} />
            <Stat label={t('console.ledger_payout_due')} value={formatIqd(v.payoutDueIqd)} tone="accent" />
          </dl>

          <Card title={t('console.ledger_cap')} tone={cap.over ? 'bad' : 'default'}>
            <div
              role="meter"
              aria-label={t('console.ledger_cap')}
              aria-valuemin={0}
              aria-valuemax={v.capIqd}
              aria-valuenow={Math.max(0, v.owedIqd)}
              aria-valuetext={t('console.ledger_cap_detail', { owed: formatIqd(Math.max(0, v.owedIqd)), cap: formatIqd(v.capIqd), percent: cap.percent })}
              className="h-4 w-full overflow-hidden rounded-pill bg-surface-2"
            >
              <div
                className={`h-full rounded-pill transition-[width] ${cap.over ? 'bg-bad' : cap.warn ? 'bg-accent' : 'bg-ok'}`}
                style={{ width: `${cap.barPercent}%` }}
              />
            </div>
            <p className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
              <span className="tabular-nums">
                {t('console.ledger_cap_detail', { owed: formatIqd(Math.max(0, v.owedIqd)), cap: formatIqd(v.capIqd), percent: cap.percent })}
              </span>
              {!cap.over && <span className="text-muted">{t('console.ledger_cap_remaining', { amount: formatIqd(Math.max(0, v.capRemainingIqd)) })}</span>}
            </p>
            {cap.over && (
              <p role="status" className="mt-2 font-semibold text-bad">
                {t('console.ledger_over_cap')}
              </p>
            )}
            {cap.warn && <p className="mt-2 text-accent">{t('console.ledger_near_cap')}</p>}
          </Card>

          <Card
            title={t('console.ledger_statement')}
            actions={
              <div role="tablist" aria-label={t('console.ledger_statement')} className="flex gap-1">
                {(['cash', 'earnings'] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`${ghostBtn} aria-selected:border-accent aria-selected:text-accent`}>
                    {k === 'cash' ? t('console.ledger_cash') : t('console.ledger_earnings')}
                  </button>
                ))}
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor={ids.from} className="mb-1 block text-xs text-muted">
                  {t('console.ledger_from')}
                </label>
                <input id={ids.from} type="date" dir="ltr" className={inputCls} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
              </div>
              <div>
                <label htmlFor={ids.to} className="mb-1 block text-xs text-muted">
                  {t('console.ledger_to')}
                </label>
                <input id={ids.to} type="date" dir="ltr" className={inputCls} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
              </div>
              {(range.from || range.to) && (
                <button type="button" className={ghostBtn} onClick={() => setRange({ from: '', to: '' })}>
                  {t('console.ledger_clear_range')}
                </button>
              )}
            </div>
            <div role="tabpanel" aria-busy={ledger.isFetching}>
              <StatementView statement={tab === 'cash' ? v.cash : v.earnings} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatementView({ statement }: { statement: Statement }) {
  const lines = useMemo(() => newestFirst(statement.lines), [statement.lines]);
  return (
    <>
      <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('console.ledger_opening')} value={formatIqd(statement.openingIqd)} />
        <Stat label={t('console.ledger_in')} value={formatSigned(statement.inIqd)} tone="ok" />
        <Stat label={t('console.ledger_out')} value={formatSigned(-Math.abs(statement.outIqd))} />
        <Stat label={t('console.ledger_closing')} value={formatIqd(statement.closingIqd)} tone="accent" />
      </dl>
      {lines.length === 0 ? (
        <EmptyState title={t('console.ledger_empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 text-start font-medium">
                  {t('console.col_date')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('console.col_line')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t('console.col_ref')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('console.col_amount')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('console.col_balance')}
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-line/60">
                  <td className="whitespace-nowrap py-2 text-muted">{formatDayClock(l.occurredAt)}</td>
                  <td className="py-2">
                    {l.label_ar}
                    {l.memo && <span className="block text-xs text-faint">{l.memo}</span>}
                  </td>
                  <td className="py-2">
                    {l.orderId ? (
                      <OrderRef id={l.orderId} />
                    ) : l.tripId ? (
                      <Mono title={l.tripId}>{shortId(l.tripId, 4, 3)}</Mono>
                    ) : (
                      <span className="text-muted">
                        <AccountName account={l.counterparty} />
                      </span>
                    )}
                  </td>
                  <td className={`py-2 text-end tabular-nums ${l.amountIqd < 0 ? 'text-bad' : 'text-ok'}`}>{formatSigned(l.amountIqd)}</td>
                  <td className="py-2 text-end tabular-nums">{formatIqd(l.balanceAfterIqd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
