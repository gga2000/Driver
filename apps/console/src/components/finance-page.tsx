'use client';

import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CourierCashRow, FinanceDeskView, HandoverRow, MerchantPayableRow, SettlementExportInput } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useMemo, useState } from 'react';
import { arabicDay, CASH_LEVEL_CLS, cashLevel, downloadCsv, merchantWords, netWords, owedWords } from '@/lib/control-room';
import { formatClock, formatDayClock, formatIqd, formatMoney } from '@/lib/format';
import { capTierLabel, settleModeLabel } from '@/lib/labels';
import { CITY_ID, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { PersonName } from './named';
import { RoundMap } from './round-map';
import {
  Button,
  Card,
  Chip,
  cx,
  DataTable,
  EmptyState,
  IconAlert,
  IconCheckCircle,
  IconChevronDown,
  IconDownload,
  LiveBadge,
  NeedLogin,
  PageHeader,
  Popover,
  QueryError,
  Skeleton,
  Stat,
  StatStrip,
  useToast,
  type Column,
} from './ui';

const POLL_MS = 30_000;
const EXPORTS: ReadonlyArray<NonNullable<SettlementExportInput['kind']>> = ['round', 'couriers', 'merchants', 'handovers'];

export function FinancePage() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles } = useMyRoles();
  const desk = useQuery(trpc.finance.desk.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));
  if (!signedIn) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title={t('console.fin_title')} subtitle={t('console.fin_subtitle')} />
        <NeedLogin />
      </div>
    );
  }
  const canExport = hasAny(roles, ['finance', 'admin']);
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title={t('console.fin_title')} subtitle={t('console.fin_subtitle')}>
        <LiveBadge seconds={POLL_MS / 1000} updatedAt={desk.dataUpdatedAt} fetching={desk.isFetching} error={Boolean(desk.error)} />
        {canExport && <ExportMenu />}
      </PageHeader>
      {desk.error && <QueryError error={desk.error} onRetry={() => void desk.refetch()} />}
      {!desk.data && desk.isPending && (
        <div className="space-y-5" aria-busy>
          <Skeleton className="h-28 rounded-lg" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[92px] rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-lg" />
        </div>
      )}
      {desk.data && <FinanceDesk desk={desk.data} />}
    </div>
  );
}

/** One "صدّر CSV" button with the four files in a menu (was four buttons in the header). */
function ExportMenu() {
  const trpc = useTRPC();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const exp = useMutation(
    trpc.finance.exportSettlement.mutationOptions({
      onSuccess: (r) => {
        downloadCsv(r.filename, r.csv);
        toast({ title: t('console.fin_exported', { file: r.filename, n: r.rows }), tone: 'ok' });
      },
      onError: (e) => toast({ title: t('console.fin_export_failed'), body: e.message, tone: 'bad' }),
    }),
  );
  return (
    <div className="relative">
      <Button icon={<IconDownload size={16} />} loading={exp.isPending} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t('console.fin_export')}
        <IconChevronDown size={14} className="text-muted" />
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} align="end">
        <ul role="menu" aria-label={t('console.fin_export')}>
          {EXPORTS.map((k) => (
            <li key={k} role="none">
              <button
                type="button"
                role="menuitem"
                className="flex w-full flex-col items-start rounded-[8px] px-3 py-2 text-start hover:bg-surface-2"
                onClick={() => {
                  setOpen(false);
                  exp.mutate({ cityId: CITY_ID, kind: k });
                }}
              >
                <span className="text-sm font-medium">{t(`console.fin_export_${k}` as MessageKey)}</span>
                <span className="text-xs text-muted">{t(`console.fin_export_${k}_hint` as MessageKey)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}

export function FinanceDesk({ desk }: { desk: FinanceDeskView }) {
  const overCap = desk.couriers.filter((c) => c.overCap);
  return (
    <div className="space-y-5">
      <LedgerCheck desk={desk} />

      <StatStrip className="md:[grid-template-columns:repeat(4,minmax(0,1fr))]">
        <Stat label={t('console.fin_cash_field')} value={formatMoney(desk.totals.cashInFieldIqd)} hint={t('console.fin_couriers_n', { n: desk.couriers.length })} />
        <Stat
          label={t('console.fin_over_cap')}
          value={t('console.fin_over_cap_value', { n: desk.totals.couriersOverCap })}
          tone={desk.totals.couriersOverCap ? 'bad' : 'default'}
          hint={overCap.length ? overCap.map((c) => c.name ?? '—').slice(0, 3).join('، ') : t('console.fin_over_cap_none')}
        />
        <Stat label={t('console.fin_merchants_payable')} value={formatMoney(desk.totals.merchantsPayableIqd)} hint={t('console.fin_merchants_n', { n: desk.merchants.filter((m) => m.payableIqd !== 0).length })} />
        <Stat label={t('console.fin_collected_today')} value={formatMoney(desk.totals.collectedTodayIqd)} hint={t('console.fin_handovers_n', { n: desk.handovers.length })} />
      </StatStrip>

      <CollectionRound desk={desk} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <CouriersTable rows={desk.couriers} />
        <div className="space-y-5">
          <MerchantsCard rows={desk.merchants} />
          <HandoversCard rows={desk.handovers} />
        </div>
      </div>
      <p className="text-xs text-muted">{t('console.fin_updated', { time: formatDayClock(desk.at) })}</p>
    </div>
  );
}

// ───────────────────────── the ledger check ─────────────────────────

function LedgerCheck({ desk }: { desk: FinanceDeskView }) {
  const n = desk.nightly;
  const facts: Array<{ k: string; v: string; bad: boolean }> = [
    { k: t('console.fin_money_net'), v: netWords(n.moneyNet), bad: n.moneyNet !== 0 },
    { k: t('console.fin_points_net'), v: netWords(n.pointsNet), bad: n.pointsNet !== 0 },
    { k: t('console.fin_kind_violations'), v: n.kindViolations === 0 ? t('console.fin_none') : String(n.kindViolations), bad: n.kindViolations > 0 },
  ];
  return (
    <section role="status" aria-live="polite" className={cx('flex flex-wrap items-center justify-between gap-x-10 gap-y-4 rounded-lg border bg-surface px-6 py-5 shadow-card', n.ok ? 'border-ok/40' : 'border-bad/50')}>
      <div className="flex items-center gap-4">
        <span className={cx('inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-pill', n.ok ? 'bg-ok-tint text-ok' : 'bg-bad-tint text-bad')}>
          {n.ok ? <IconCheckCircle size={30} /> : <IconAlert size={30} />}
        </span>
        <div>
          <p className="text-[26px] font-bold leading-9 tracking-[-0.01em]">{n.ok ? t('console.fin_balanced') : t('console.fin_unbalanced')}</p>
          <p className="text-sm text-muted">
            {t('console.fin_nightly_checked', { time: formatClock(n.checkedAt) })}
            {' · '}
            {n.lastClose ? t(n.lastClose.ok ? 'console.fin_last_close_ok' : 'console.fin_last_close_bad', { day: arabicDay(n.lastClose.day), time: formatClock(n.lastClose.runAt) }) : t('console.fin_no_close')}
          </p>
          {!n.ok && (
            <p className="mt-1 text-sm">
              {n.message_ar}{' '}
              <Link href="/system" className="font-semibold text-accent-text underline-offset-4 hover:underline">
                {t('console.fin_go_nightly')}
              </Link>
            </p>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-x-8 gap-y-1">
        {facts.map((f) => (
          <div key={f.k}>
            <dt className="text-xs text-muted">{f.k}</dt>
            <dd className={cx('flex items-center gap-1 text-sm font-semibold', f.bad ? 'text-bad' : 'text-text')}>
              {f.bad ? <IconAlert size={14} /> : <IconCheckCircle size={14} className="text-ok" />}
              {f.v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ───────────────────────── the 23:00 round (S-K5) ─────────────────────────

function CollectionRound({ desk }: { desk: FinanceDeskView }) {
  const r = desk.round;
  const couriers = r.stops.reduce((n, s) => n + s.couriers.length, 0);
  return (
    <Card
      title={t('console.fin_round', { time: formatClock(r.at) })}
      hint={r.stops.length ? t('console.fin_round_summary', { amount: formatMoney(r.totalIqd), n: couriers, stops: r.stops.length }) : undefined}
      flush
    >
      {r.stops.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState icon={<IconCheckCircle size={20} />} title={t('console.fin_round_empty')} hint={t('console.fin_round_empty_hint')} />
        </div>
      ) : (
        <div className="grid border-t border-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ol className="relative max-h-[34rem] overflow-y-auto px-5 py-4" aria-label={t('console.fin_round_list')}>
            {r.stops.map((s, i) => {
              const over = s.couriers.filter((c) => c.overCap).length;
              return (
                <li key={s.zoneKey} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < r.stops.length - 1 && <span aria-hidden className="absolute start-[13px] top-8 h-[calc(100%-28px)] w-0.5 rounded-pill bg-line" />}
                  <span className={cx('num relative mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-dense font-bold', over ? 'bg-bad-solid text-on-bad' : 'bg-accent text-on-accent')}>{s.seq}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-[15px] font-semibold">{s.zone_ar}</span>
                      <span className="num text-sm font-semibold">{formatMoney(s.totalIqd)}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {t('console.fin_stop_couriers', { n: s.couriers.length })}
                      {over > 0 && <span className="font-semibold text-bad"> · {t('console.fin_stop_over', { n: over })}</span>}
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5 text-dense">
                      {s.couriers.slice(0, 8).map((c) => (
                        <li key={c.driverId} className={cx('inline-flex items-baseline gap-1.5 rounded-pill px-2.5 py-0.5', c.overCap ? 'bg-bad-tint text-bad' : 'bg-surface-2')}>
                          <span className={cx('font-medium', c.overCap && 'font-semibold')}>
                            {c.name ?? <PersonName id={c.driverId} copy={false} />}
                            {c.overCap ? ` · ${t('console.fin_over_cap_short')}` : ''}
                          </span>
                          <span className={cx('num', c.overCap ? 'text-bad' : 'text-muted')}>{formatIqd(c.heldIqd)}</span>
                        </li>
                      ))}
                    </ul>
                    {s.couriers.length > 8 && <p className="mt-0.5 text-xs text-muted">{t('console.fin_stop_more', { n: s.couriers.length - 8 })}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-line p-4 lg:border-s lg:border-t-0">
            <RoundMap stops={r.stops} className="aspect-[4/3] w-full overflow-hidden rounded-md border border-line" />
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-text" /> {t('console.fin_round_base')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-pill bg-accent" /> {t('console.fin_legend_stop')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-pill bg-bad-solid" /> {t('console.fin_legend_over')}
              </span>
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

// ───────────────────────── couriers vs cap ─────────────────────────

function CouriersTable({ rows }: { rows: CourierCashRow[] }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => Number(b.overCap) - Number(a.overCap) || b.fill - a.fill), [rows]);
  const columns: Column<CourierCashRow>[] = [
    {
      key: 'name',
      header: t('console.fin_col_courier'),
      cell: (c) => (
        <span className="block min-w-0">
          <Link href={`/drivers/${encodeURIComponent(c.driverId)}/ledger`} className="font-semibold text-text underline-offset-4 hover:text-accent-text hover:underline">
            {c.name ?? <PersonName id={c.driverId} copy={false} />}
          </Link>
          <span className="block text-xs text-muted">
            {capTierLabel(c.tier)} · {c.online ? (c.zone_ar ?? t('console.fin_online')) : t('console.fin_offline')}
          </span>
        </span>
      ),
    },
    { key: 'held', header: t('console.fin_col_held'), cell: (c) => <span className="text-sm">{formatMoney(c.heldIqd)}</span> },
    { key: 'owed', header: t('console.fin_col_owed'), cell: (c) => <span className={cx('text-sm', c.owedIqd < 0 && 'text-ok')}>{owedWords(c.owedIqd)}</span> },
    {
      key: 'cap',
      header: t('console.fin_col_cap'),
      width: '34%',
      cell: (c) => {
        const level = cashLevel(c.fill, c.overCap);
        const pct = Math.round(c.fill * 100);
        return (
          <span className="block">
            <span className="flex items-baseline justify-between gap-2 text-xs">
              <span className={cx('font-semibold', CASH_LEVEL_CLS[level].text)}>
                {level === 'over' || level === 'edge' ? <IconAlert size={12} className="me-1 inline align-[-1px]" /> : null}
                {t(`console.fin_level_${level}` as MessageKey)}
              </span>
              <span className="num text-muted">
                {pct}% · {formatIqd(c.capIqd)}
              </span>
            </span>
            <span
              role="meter"
              aria-valuemin={0}
              aria-valuemax={c.capIqd}
              aria-valuenow={Math.max(0, c.owedIqd)}
              aria-label={t('console.fin_cap_aria', { name: c.name ?? '' })}
              className="relative mt-1 block h-1.5 overflow-hidden rounded-pill bg-surface-3"
            >
              <span className={cx('absolute inset-y-0 start-0 rounded-pill', CASH_LEVEL_CLS[level].bar)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
              {/* 70 % and 90 % ticks: where amber and red start (money spec §4). */}
              <span aria-hidden className="absolute inset-y-0 start-[70%] w-px bg-surface" />
              <span aria-hidden className="absolute inset-y-0 start-[90%] w-px bg-surface" />
            </span>
          </span>
        );
      },
    },
  ];
  return (
    <section aria-labelledby="fin-couriers" className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="fin-couriers" className="text-[15px] font-semibold">
          {t('console.fin_couriers')} <span className="num text-dense font-medium text-muted">{rows.length}</span>
        </h2>
        <p className="text-xs text-muted">{t('console.fin_couriers_hint')}</p>
      </div>
      <DataTable columns={columns} rows={sorted} rowKey={(c) => c.driverId} caption={t('console.fin_couriers')} maxHeight="34rem" empty={{ title: t('console.fin_no_cash'), hint: t('console.fin_no_cash_hint') }} />
    </section>
  );
}

// ───────────────────────── merchants and hand-overs ─────────────────────────

function MerchantsCard({ rows }: { rows: MerchantPayableRow[] }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => Number(b.overExposure) - Number(a.overExposure) || Math.abs(b.payableIqd) - Math.abs(a.payableIqd)), [rows]);
  return (
    <Card title={t('console.fin_merchants')} hint={t('console.fin_merchants_hint')}>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted">{t('console.fin_no_merchants')}</p>
      ) : (
        <ul className="-my-1 max-h-[20rem] divide-y divide-line overflow-y-auto">
          {sorted.map((m) => (
            <li key={m.merchantId} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="flex items-center gap-2 truncate text-sm font-semibold">
                  {m.name}
                  {m.overExposure && (
                    <Chip tone="bad" size="sm">
                      {t('console.fin_over_exposure')}
                    </Chip>
                  )}
                </span>
                <span className="block text-xs text-muted">{settleModeLabel(m.mode)}</span>
              </span>
              <span className={cx('shrink-0 text-sm', m.payableIqd === 0 ? 'text-muted' : m.payableIqd < 0 ? 'text-ok' : 'text-text')}>{merchantWords(m.payableIqd)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HandoversCard({ rows }: { rows: HandoverRow[] }) {
  return (
    <Card title={t('console.fin_handovers')} hint={rows.length ? t('console.fin_handovers_total', { amount: formatMoney(rows.reduce((n, h) => n + h.amountIqd, 0)) }) : undefined}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('console.fin_handovers_empty')}</p>
      ) : (
        <ul className="-my-1 max-h-[22rem] divide-y divide-line overflow-y-auto">
          {rows.map((h, i) => (
            <li key={`${h.reference}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-semibold">{h.courierName ?? <PersonName id={h.courierId} copy={false} />}</span>{' '}
                {h.kind === 'courier_to_ops' ? t('console.fin_handed_ops', { amount: formatMoney(h.amountIqd) }) : t('console.fin_handed_merchant', { amount: formatMoney(h.amountIqd), name: h.counterpart ?? t('console.fin_handover_courier_to_merchant') })}
              </span>
              <span className="num shrink-0 text-xs text-muted">{formatClock(h.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
