'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { formatDayClock, formatIqd, shortId } from '@/lib/format';
import { channelLabel, settleModeLabel } from '@/lib/labels';
import { queryRetry } from '@/lib/live';
import { useTRPC } from '@/lib/trpc';
import { Card, Chip, Mono, primaryBtn, QueryError, Row } from './ui';

/**
 * A merchant's live balance (ledger.merchantBalance) with the "اطلب فلوسك" button
 * (ledger.requestSettlement). Used on the order page and the drivers/finance page.
 */
export function MerchantBalanceCard({ merchantId }: { merchantId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const balance = useQuery(trpc.ledger.merchantBalance.queryOptions({ merchantId }, { retry: queryRetry, refetchInterval: 10_000 }));
  const request = useMutation(
    trpc.ledger.requestSettlement.mutationOptions({
      onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.ledger.merchantBalance.queryKey({ merchantId }) }),
    }),
  );

  const b = balance.data;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {t('console.merchant_balance')} <Mono title={merchantId}>{shortId(merchantId)}</Mono>
        </span>
      }
      tone={b?.overExposure ? 'bad' : 'default'}
    >
      {balance.error && <QueryError error={balance.error} onRetry={() => void balance.refetch()} />}
      {balance.isPending && <p className="text-sm text-muted">{t('status.loading')}</p>}
      {b && (
        <>
          <p className="text-xs text-muted">{b.balanceIqd >= 0 ? t('console.merchant_owed') : t('console.merchant_owes')}</p>
          <p className={`font-display text-3xl font-bold tabular-nums ${b.balanceIqd < 0 ? 'text-bad' : 'text-accent-strong'}`}>
            {formatIqd(Math.abs(b.balanceIqd))} <span className="text-base font-normal text-muted">{t('quote.currency')}</span>
          </p>
          {b.overExposure && (
            <p className="mt-1">
              <Chip tone="bad">{t('console.merchant_over_exposure')}</Chip>
            </p>
          )}
          <dl className="mt-3">
            <Row k={t('console.merchant_mode')} v={settleModeLabel(b.mode)} />
            <Row k={t('console.ledger_cap')} v={t('console.merchant_exposure', { amount: formatIqd(b.exposureCapIqd) })} />
          </dl>
          <p className="mt-2 text-xs text-muted">
            {b.lastSettledAt ? t('console.merchant_last_settled', { time: formatDayClock(b.lastSettledAt) }) : t('console.merchant_never_settled')}
          </p>
          {b.holders.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted">{t('console.merchant_holders')}</p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {b.holders.map((h) => (
                  <li key={h.courierId} className="flex justify-between gap-2">
                    <Mono>{shortId(h.courierId)}</Mono>
                    <span className="tabular-nums">{formatIqd(h.amountIqd)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className={`${primaryBtn} mt-4 w-full`} disabled={request.isPending || b.balanceIqd <= 0} onClick={() => request.mutate({ merchantId })}>
            {request.isPending ? t('status.loading') : t('merchant.request_money')}
          </button>
          <div role="status" className="mt-2 text-sm">
            {request.data && (
              <p className="text-ok">
                {t('merchant.request_money_sent')}
                <span className="mt-1 block text-xs text-muted">
                  {t('console.merchant_plan', {
                    amount: formatIqd(request.data.amountIqd),
                    channel: channelLabel(request.data.channel),
                    reference: request.data.reference,
                    time: formatDayClock(request.data.targetBy),
                  })}
                </span>
              </p>
            )}
            {request.error && <p className="text-bad">{request.error.message}</p>}
          </div>
        </>
      )}
    </Card>
  );
}
