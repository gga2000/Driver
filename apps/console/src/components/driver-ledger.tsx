'use client';

import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Statement, StatementLine } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useMemo, useState, type ReactNode } from 'react';
import { owedWords } from '@/lib/control-room';
import { formatClock, formatIqd } from '@/lib/format';
import { capRoleLabel, capTierLabel, vehicleLabel } from '@/lib/labels';
import { balanceWords, groupByDay, isHandover, lineSide, memoWords, newestFirst, type StatementTab } from '@/lib/ledger';
import { queryRetry } from '@/lib/live';
import { useNames } from '@/lib/names';
import { dayHeading, dayKey, dayStart, periodRange, rangeWords, type Period, type PeriodPreset } from '@/lib/periods';
import { countText } from '@/lib/plural';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { CashCapBar } from './cash-cap';
import { PeriodPicker } from './period-picker';
import { AccountName, CopyId, OrderRef } from './named';
import { Avatar, cx, EmptyState, IconBack, IconCheckCircle, Mono, NeedLogin, QueryError, Skeleton, Tabs, useNow } from './ui';

const PRESETS: readonly PeriodPreset[] = ['today', 'yesterday', 'week', 'month', 'custom'];

/**
 * A driver's book, read like a bank statement in words (K-16): what he holds and owes now with the
 * cap bar, then the cash or the earnings statement for a period, grouped by day, each line with the
 * running balance said as "بيده" / "له" / "عليه", and every hand-over (to the company or a restaurant)
 * marked so the 23:00 round can be checked by eye.
 */
export function DriverLedger({ driverId }: { driverId: string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const now = new Date(useNow(60_000));
  const [tab, setTab] = useState<StatementTab>('cash');
  const [period, setPeriod] = useState<Period>({ preset: 'week' });
  const range = useMemo(() => periodRange(period, now), [period, dayKey(now)]); // eslint-disable-line react-hooks/exhaustive-deps

  const ledger = useQuery(
    trpc.ledger.driverLedger.queryOptions(
      { driverId, ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) },
      { enabled: signedIn, retry: queryRetry, refetchInterval: 10_000, placeholderData: keepPreviousData },
    ),
  );
  const v = ledger.data;
  const names = useNames({ people: [driverId] });
  const p = names.person(driverId);

  return (
    <div className="mx-auto max-w-[1180px]">
      <Link href="/drivers" className="mb-3 inline-flex items-center gap-1 rounded-md text-dense text-muted hover:text-accent-text">
        <IconBack size={16} />
        {t('console.ledger_back')}
      </Link>

      <header className="mb-5 flex flex-wrap items-center gap-4">
        <Avatar id={driverId} name={p?.displayName} size="lg" />
        <div className="min-w-0">
          <h1 className="group/id flex items-center gap-2 text-2xl font-bold tracking-[-0.01em]">
            <span title={driverId}>{p?.displayName ?? t('console.ledger_title')}</span>
            <CopyId id={driverId} />
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {[p?.vehicleClass ? vehicleLabel(p.vehicleClass) : null, p?.plate, v ? capRoleLabel(v.role) : null, v ? capTierLabel(v.tier) : null].filter(Boolean).join(' · ')}
            {!p?.displayName ? (
              <>
                {' '}
                <Mono title={driverId}>{driverId}</Mono>
              </>
            ) : null}
          </p>
        </div>
      </header>

      {!signedIn ? <NeedLogin /> : null}
      {ledger.error ? <QueryError error={ledger.error} onRetry={() => void ledger.refetch()} /> : null}
      {signedIn && !v && ledger.isPending ? (
        <div className="space-y-5" aria-busy>
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      ) : null}

      {v ? (
        <div className="space-y-5">
          {/* Now: cash in his hands against the cap, and what we owe him. */}
          <section className="grid overflow-hidden rounded-lg border border-line bg-surface shadow-card md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="p-6">
              <p className="text-dense text-muted">{t('console.ledger_cash_now')}</p>
              <p className="num mt-1 text-[28px] font-bold leading-10 tracking-[-0.01em]">{balanceText('cash', v.cashBalanceIqd)}</p>
              <p className="num mt-0.5 text-sm text-muted">
                {v.cashBalanceIqd < 0 && v.earningsBalanceIqd > 0 ? (
                  <>
                    {t('console.ledger_of_which_earnings', { amount: formatIqd(Math.min(-v.cashBalanceIqd, v.earningsBalanceIqd)) })}
                    <span aria-hidden className="mx-1.5 text-faint">
                      ·
                    </span>
                  </>
                ) : null}
                <span className={cx(v.overCap ? 'font-semibold text-bad' : v.owedIqd > 0 ? 'font-medium text-text' : '')}>{owedWords(v.owedIqd)}</span>
              </p>
              <div className="mt-5 max-w-md">
                <CashCapBar owedIqd={v.owedIqd} capIqd={v.capIqd} overCap={v.overCap} label={t('console.ledger_cap')} />
                {!v.overCap && v.capRemainingIqd > 0 ? <p className="num mt-1.5 text-xs text-muted">{t('console.ledger_cap_left', { amount: formatIqd(v.capRemainingIqd) })}</p> : null}
                {v.overCap ? (
                  <p role="status" className="mt-2 text-sm font-semibold text-bad">
                    {t('console.ledger_over_cap')}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="border-t border-line bg-surface-2/50 p-6 md:border-s md:border-t-0">
              <p className="text-dense text-muted">{t('console.ledger_earnings_now')}</p>
              <p className={cx('num mt-1 text-[28px] font-bold leading-10 tracking-[-0.01em]', v.earningsBalanceIqd === 0 && 'text-muted')}>{balanceText('earnings', v.earningsBalanceIqd)}</p>
              <p className={cx('num mt-0.5 text-sm', v.payoutDueIqd > 0 ? 'font-semibold text-accent-text' : 'text-muted')}>
                {v.payoutDueIqd > 0 ? t('console.ledger_payout_now', { amount: formatIqd(v.payoutDueIqd) }) : t('console.ledger_payout_none')}
              </p>
            </div>
          </section>

          <section aria-labelledby="statement" className="rounded-lg border border-line bg-surface shadow-card">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line px-6 pt-5">
              <div className="min-w-0">
                <h2 id="statement" className="text-[15px] font-semibold">
                  {t('console.ledger_statement')}
                </h2>
                <p className="text-dense text-muted">{tab === 'cash' ? t('console.ledger_cash_hint') : t('console.ledger_earnings_hint')}</p>
                <Tabs
                  className="mt-2 border-b-0"
                  label={t('console.ledger_tabs')}
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: 'cash', label: t('console.ledger_cash'), count: v.cash.lines.length },
                    { value: 'earnings', label: t('console.ledger_earnings'), count: v.earnings.lines.length },
                  ]}
                />
              </div>
              <PeriodPicker className="mb-3" presets={PRESETS} value={period} onChange={setPeriod} now={now} />
            </div>
            <div role="tabpanel" aria-busy={ledger.isFetching}>
              <StatementView statement={tab === 'cash' ? v.cash : v.earnings} tab={tab} now={now} period={rangeWords(period, now)} />
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function balanceText(tab: StatementTab, amount: number): string {
  const w = balanceWords(tab, amount);
  return w.key === 'square' ? t('console.ledger_square') : t(`console.ledger_${w.key}` as MessageKey, { amount: formatIqd(w.amountIqd) });
}

function StatementView({ statement, tab, now, period }: { statement: Statement; tab: StatementTab; now: Date; period: string }) {
  const days = useMemo(() => groupByDay(newestFirst(statement.lines), dayKey), [statement.lines]);
  const cash = tab === 'cash';
  // Cash: "استلم" is money into his hands (the statement's out), "سلّم" money out of them (its in).
  const inSum = cash ? statement.outIqd : statement.inIqd;
  const outSum = cash ? statement.inIqd : statement.outIqd;
  return (
    <>
      <dl className="grid grid-cols-2 border-b border-line text-sm md:grid-cols-4 [&>div+div]:border-s [&>div]:border-line">
        <Summary label={t('console.ledger_opening_words')} value={balanceText(tab, statement.openingIqd)} />
        <Summary label={cash ? t('console.col_received') : t('console.col_credit')} value={`${formatIqd(inSum)} ${t('quote.currency')}`} />
        <Summary label={cash ? t('console.col_handed') : t('console.col_debit')} value={`${formatIqd(outSum)} ${t('quote.currency')}`} />
        <Summary label={t('console.ledger_closing_words')} value={balanceText(tab, statement.closingIqd)} strong />
      </dl>
      {statement.lines.length === 0 ? (
        <div className="p-6">
          <EmptyState bare title={t('console.ledger_empty_period', { period })} hint={t('console.ledger_empty_hint')} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-dense">
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" className="w-24 border-b border-line px-6 py-2 text-start font-medium">
                  {t('console.col_date')}
                </th>
                <th scope="col" className="border-b border-line px-3 py-2 text-start font-medium">
                  {t('console.col_what')}
                </th>
                <th scope="col" className="w-32 border-b border-line px-3 py-2 text-end font-medium">
                  {cash ? t('console.col_received') : t('console.col_credit')}
                </th>
                <th scope="col" className="w-32 border-b border-line px-3 py-2 text-end font-medium">
                  {cash ? t('console.col_handed') : t('console.col_debit')}
                </th>
                <th scope="col" className="w-40 border-b border-line px-6 py-2 text-end font-medium">
                  {cash ? t('console.col_held_after') : t('console.col_running')}
                </th>
              </tr>
            </thead>
            {days.map((day) => (
              <tbody key={day.key}>
                <tr>
                  <th colSpan={5} scope="colgroup" className="border-b border-line bg-surface-2/70 px-6 py-1.5 text-start text-xs font-semibold text-muted">
                    {dayHeading(dayStart(day.key), now)}
                    <span className="num ms-2 font-normal text-faint">{countText('console.ledger_lines', day.lines.length)}</span>
                  </th>
                </tr>
                {day.lines.map((l) => (
                  <Line key={l.id} line={l} tab={tab} />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </>
  );
}

function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="px-6 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cx('num mt-0.5', strong ? 'font-semibold text-text' : 'text-text')}>{value}</dd>
    </div>
  );
}

function Line({ line: l, tab }: { line: StatementLine; tab: StatementTab }) {
  const side = lineSide(tab, l.amountIqd);
  const amount = formatIqd(Math.abs(l.amountIqd));
  const handover = tab === 'cash' && isHandover(l);
  const bal = balanceWords(tab, l.balanceAfterIqd);
  const memo = memoWords(l.memo);
  const who: ReactNode = (
    <>
      {side === 'in' ? t('console.ledger_from_who') : t('console.ledger_to_who')} <AccountName account={l.counterparty} />
    </>
  );
  return (
    <tr title={l.memo ?? undefined} className={cx('transition-colors duration-fast', handover ? 'bg-ok-tint/60' : 'hover:bg-surface-2')}>
      <td className="num whitespace-nowrap border-b border-line/70 px-6 py-2.5 align-top text-muted">{formatClock(l.occurredAt)}</td>
      <td className="border-b border-line/70 px-3 py-2.5 align-top">
        {handover ? (
          <span className="flex items-start gap-2">
            <IconCheckCircle size={16} className="mt-0.5 shrink-0 text-ok" />
            <span>
              <span className="font-semibold">
                {t(l.type === 'merchant_paid_by_courier' ? 'console.ledger_handover_merchant' : l.type === 'debt_settled' ? 'console.ledger_handover_debt' : 'console.ledger_handover_company', { amount })}
              </span>
              <span className="block text-xs text-muted">
                {who}
                {memo ? <span className="ms-1">· {memo}</span> : null}
              </span>
            </span>
          </span>
        ) : (
          <span>
            <span className="font-medium">{l.label_ar}</span>
            {l.orderId ? (
              <span className="ms-2">
                <OrderRef id={l.orderId} copy={false} />
              </span>
            ) : null}
            <span className="block text-xs text-muted">
              {who}
              {memo ? <span className="ms-1">· {memo}</span> : null}
            </span>
          </span>
        )}
      </td>
      <td className="num border-b border-line/70 px-3 py-2.5 text-end align-top">{side === 'in' ? <span className="font-medium">{amount}</span> : null}</td>
      <td className="num border-b border-line/70 px-3 py-2.5 text-end align-top">{side === 'out' ? <span className={cx('font-medium', handover && 'text-ok')}>{amount}</span> : null}</td>
      <td className="num whitespace-nowrap border-b border-line/70 px-6 py-2.5 text-end align-top text-muted">
        {bal.key === 'square' ? t('console.ledger_square') : t(`console.ledger_${bal.key}` as MessageKey, { amount: formatIqd(bal.amountIqd) })}
      </td>
    </tr>
  );
}
