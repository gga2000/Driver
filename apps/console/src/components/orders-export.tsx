'use client';

import type { OrderSearchInput, OrderSummary } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { csvTime, downloadCsv, toCsv } from '@/lib/csv';
import { orderStateLabel, orderTypeLabel, paymentLabel, zoneName } from '@/lib/labels';
import { useMerchants } from '@/lib/live';
import { orderLabel } from '@/lib/names';
import { errorText } from '@/lib/network';
import { useTRPCClient } from '@/lib/trpc';
import { Button, IconDownload, useToast } from './ui';

/** Past this many rows the file stops and says so: a day at launch is ~1,800 orders. */
const MAX_ROWS = 5_000;
const PAGE = 100;

/**
 * «نزّل CSV» on Orders (v6): every order the current filters find, not just the loaded pages. No
 * customer names or phones: the file leaves the Console, so it carries what finance needs only.
 */
export function OrdersExportButton({ input, fileTag }: { input: OrderSearchInput; fileTag: string }) {
  const client = useTRPCClient();
  const toast = useToast();
  const merchants = useMerchants();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const rows: OrderSummary[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.orders.search.query({ ...input, limit: PAGE, ...(cursor ? { cursor } : {}) });
        rows.push(...page.rows);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && rows.length < MAX_ROWS);
      const shop = new Map((merchants.data ?? []).map((m) => [m.merchantId, m.name]));
      const text = toCsv([
        [
          t('console.col_order'),
          t('console.csv_service'),
          t('console.col_state'),
          t('console.col_merchant'),
          t('console.col_zone'),
          t('console.col_payment'),
          t('console.col_total_iqd'),
          t('console.col_placed'),
          t('console.csv_delivered'),
          t('console.csv_cancelled'),
          t('console.csv_late_min'),
        ],
        ...rows.slice(0, MAX_ROWS).map((o) => [
          orderLabel(o.id),
          orderTypeLabel(o.type),
          orderStateLabel(o.state),
          o.merchantOrgId ? (shop.get(o.merchantOrgId) ?? '') : '',
          o.zoneKey ? zoneName(o.zoneKey) : '',
          paymentLabel(o.paymentMethod),
          o.totalIqd,
          csvTime(o.placedAt),
          csvTime(o.deliveredAt),
          csvTime(o.cancelledAt),
          o.lateMin,
        ]),
      ]);
      downloadCsv(`driver-orders-${fileTag}.csv`, text);
      toast({
        title: cursor ? t('console.csv_capped', { n: MAX_ROWS }) : t('console.csv_done', { n: rows.length }),
      });
    } catch (e) {
      toast({ title: t('console.csv_failed', { message: errorText(e as Parameters<typeof errorText>[0]) }), tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" icon={<IconDownload size={15} />} loading={busy} onClick={() => void run()} needsNet>
      {t('console.csv_download')}
    </Button>
  );
}
