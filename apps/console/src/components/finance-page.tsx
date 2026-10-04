'use client';

import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FinanceDeskView, SettlementExportInput } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { downloadCsv } from '@/lib/control-room';
import { formatClock, formatDayClock, formatIqd, formatMoney } from '@/lib/format';
import { capTierLabel, settleModeLabel } from '@/lib/labels';
import { CITY_ID, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { PersonName } from './named';
import { RoundMap } from './round-map';
import { Card, Chip, EmptyState, ghostBtn, LiveBadge, NeedLogin, PageHeader, QueryError, Stat } from './ui';

const POLL_MS = 30_000;
const EXPORTS: ReadonlyArray<NonNullable<SettlementExportInput['kind']>> = ['round', 'couriers', 'merchants', 'handovers'];

export function FinancePage() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles } = useMyRoles();
  const desk = useQuery(trpc.finance.desk.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry }));
  const exp = useMutation(trpc.finance.exportSettlement.mutationOptions({ onSuccess: (r) => downloadCsv(r.filename, r.csv) }));
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
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t('console.fin_title')} subtitle={t('console.fin_subtitle')}>
        <LiveBadge seconds={POLL_MS / 1000} updatedAt={desk.dataUpdatedAt} fetching={desk.isFetching} />
        {canExport &&
          EXPORTS.map((k) => (
            <button key={k} type="button" className={ghostBtn} disabled={exp.isPending} onClick={() => exp.mutate({ cityId: CITY_ID, kind: k })}>
              {t(`console.fin_export_${k}` as MessageKey)}
            </button>
          ))}
      </PageHeader>
      {exp.error && <QueryError error={exp.error} />}
      {desk.error && <QueryError error={desk.error} onRetry={() => void desk.refetch()} />}
      {desk.data && <FinanceDesk desk={desk.data} />}
    </div>
  );
}

export function FinanceDesk({ desk }: { desk: FinanceDeskView }) {
  const n = desk.nightly;
  return (
    <div className="space-y-4">
      <section
        role="status"
        className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4 ${n.ok ? 'border-success-500 bg-success-500/10' : 'border-danger-500 bg-danger-500/15'}`}
      >
        <div>
          <p className={`font-display text-2xl font-bold ${n.ok ? 'text-ok' : 'text-bad'}`}>{n.message_ar}</p>
          <p className="mt-1 text-sm text-muted">
            {t('console.fin_nightly_checked', { time: formatClock(n.checkedAt) })}
            {' · '}
            {n.lastClose ? t(n.lastClose.ok ? 'console.fin_last_close_ok' : 'console.fin_last_close_bad', { day: n.lastClose.day, time: formatClock(n.lastClose.runAt) }) : t('console.fin_no_close')}
          </p>
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-muted">{t('console.fin_money_net')}</dt>
            <dd className="font-display text-lg font-bold tabular-nums">{formatIqd(n.moneyNet)}</dd>
          </div>
          <div>
            <dt className="text-muted">{t('console.fin_points_net')}</dt>
            <dd className="font-display text-lg font-bold tabular-nums">{formatIqd(n.pointsNet)}</dd>
          </div>
        </dl>
      </section>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('console.fin_cash_field')} value={formatMoney(desk.totals.cashInFieldIqd)} hint={t('console.fin_couriers_n', { n: desk.couriers.length })} />
        <Stat label={t('console.fin_over_cap')} value={desk.totals.couriersOverCap} tone={desk.totals.couriersOverCap ? 'bad' : 'ok'} />
        <Stat label={t('console.fin_merchants_payable')} value={formatMoney(desk.totals.merchantsPayableIqd)} />
        <Stat label={t('console.fin_collected_today')} value={formatMoney(desk.totals.collectedTodayIqd)} tone="ok" hint={t('console.fin_handovers_n', { n: desk.handovers.length })} />
      </dl>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card title={t('console.fin_round', { time: formatClock(desk.round.at) })} className="xl:col-span-3" actions={<Chip tone="warn">{formatMoney(desk.round.totalIqd)}</Chip>}>
          {desk.round.stops.length === 0 ? (
            <EmptyState title={t('console.fin_round_empty')} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <RoundMap stops={desk.round.stops} className="w-full rounded-lg border border-line" />
              <ol className="space-y-2">
                {desk.round.stops.map((s) => (
                  <li key={s.zoneKey} className="rounded-lg border border-line bg-surface-2/50 px-3 py-2">
                    <p className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-pill bg-accent text-xs font-bold text-on-accent">{s.seq}</span>
                        {s.zone_ar}
                      </span>
                      <span className="tabular-nums">{formatIqd(s.totalIqd)}</span>
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted">
                      {s.couriers.map((c) => (
                        <li key={c.driverId} className="flex justify-between gap-2">
                          <span className={c.overCap ? 'text-bad' : ''}>
                            {c.name ?? <PersonName id={c.driverId} copy={false} />}
                            {c.overCap ? ` · ${t('console.fin_over_cap_short')}` : ''}
                          </span>
                          <span className="tabular-nums">{formatIqd(c.heldIqd)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>

        <Card title={t('console.fin_handovers')} className="xl:col-span-2">
          {desk.handovers.length === 0 ? (
            <p className="text-sm text-faint">{t('console.fin_handovers_empty')}</p>
          ) : (
            <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto text-sm">
              {desk.handovers.map((h, i) => (
                <li key={`${h.reference}-${i}`} className="flex items-baseline justify-between gap-3 border-b border-line/50 pb-1.5">
                  <span className="min-w-0">
                    <span className="font-semibold">{h.courierName ?? <PersonName id={h.courierId} copy={false} />}</span> ← {h.counterpart ?? '—'}
                    <span className="block text-xs text-faint">
                      {t(`console.fin_handover_${h.kind}` as MessageKey)} · {formatClock(h.at)}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatIqd(h.amountIqd)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={t('console.fin_couriers')}>
          {desk.couriers.length === 0 ? (
            <p className="text-sm text-faint">{t('console.fin_no_cash')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-1 text-start font-medium">{t('console.fin_col_courier')}</th>
                  <th className="py-1 text-start font-medium">{t('console.fin_col_zone')}</th>
                  <th className="py-1 text-end font-medium">{t('console.fin_col_held')}</th>
                  <th className="w-40 py-1 ps-4 text-start font-medium">{t('console.fin_col_cap')}</th>
                </tr>
              </thead>
              <tbody>
                {desk.couriers.map((c) => (
                  <tr key={c.driverId} className="border-t border-line/50">
                    <td className="py-1.5">
                      <Link href={`/drivers/${encodeURIComponent(c.driverId)}/ledger`} className="hover:text-accent">
                        {c.name ?? <PersonName id={c.driverId} copy={false} />}
                      </Link>
                      <span className="ms-2 text-xs text-faint">{capTierLabel(c.tier)}</span>
                    </td>
                    <td className="py-1.5 text-muted">
                      {c.zone_ar ?? t('console.fin_offline')}
                      {c.online && <span aria-hidden className="ms-1 inline-block h-1.5 w-1.5 rounded-pill bg-ok" />}
                    </td>
                    <td className="py-1.5 text-end tabular-nums">{formatIqd(c.heldIqd)}</td>
                    <td className="py-1.5 ps-4">
                      <div className="h-1.5 overflow-hidden rounded-pill bg-surface-2">
                        <div className={`h-full ${c.overCap ? 'bg-bad' : c.fill >= 0.8 ? 'bg-accent' : 'bg-ok'}`} style={{ width: `${Math.min(100, Math.round(c.fill * 100))}%` }} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-faint tabular-nums">
                        {formatIqd(c.owedIqd)} / {formatIqd(c.capIqd)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title={t('console.fin_merchants')}>
          {desk.merchants.length === 0 ? (
            <p className="text-sm text-faint">{t('console.fin_no_merchants')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-1 text-start font-medium">{t('console.fin_col_merchant')}</th>
                  <th className="py-1 text-start font-medium">{t('console.fin_col_mode')}</th>
                  <th className="py-1 text-end font-medium">{t('console.fin_col_payable')}</th>
                </tr>
              </thead>
              <tbody>
                {desk.merchants.map((m) => (
                  <tr key={m.merchantId} className="border-t border-line/50">
                    <td className="py-1.5">
                      {m.name}
                      {m.overExposure && (
                        <span className="ms-2">
                          <Chip tone="bad">{t('console.fin_over_exposure')}</Chip>
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-muted">{settleModeLabel(m.mode)}</td>
                    <td className={`py-1.5 text-end tabular-nums ${m.payableIqd > 0 ? '' : 'text-faint'}`}>{formatIqd(m.payableIqd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-faint">{t('console.fin_updated', { time: formatDayClock(desk.at) })}</p>
        </Card>
      </div>
    </div>
  );
}
