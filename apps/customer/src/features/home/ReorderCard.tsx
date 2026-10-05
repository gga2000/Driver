import { View } from 'react-native';
import type { OrderHistoryRow } from '@driver/contracts';
import { Card, formatClock, IconButton, Text, useTheme } from '@driver/ui';
import { dayKey } from '@/features/orders/history';
import { dayLabel, OrderArt } from '@/features/orders/OrderRow';
import { itemsSummary } from '@/features/orders/reorder';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * "اطلب نفس الطلب" on home (audit C-15): the last meal that reached the door, by restaurant and
 * dishes, one tap to put it back in the cart at today's prices (the reorder sheet explains changes).
 */
export function ReorderCard({ row, now, busy, onReorder }: { row: OrderHistoryRow; now: Date; busy: boolean; onReorder: () => void }) {
  const theme = useTheme();
  const t = useT();
  const day = dayKey(row.order.placedAt, now);
  const when = day.kind === 'today' ? `${dayLabel(t, day)} ${formatClock(row.order.placedAt)}` : dayLabel(t, day);
  const summary = itemsSummary(row.items, 2);
  return (
    <Card testID="home-reorder" padding={3} onPress={onReorder} accessibilityLabel={`${t('home.reorder')}: ${row.merchantName ?? ''}، ${summary}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <OrderArt row={row} size={52} />
        <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
          <Text variant="caption" weight={600} color="accentText">
            {t('home.reorder')}
          </Text>
          <Text variant="bodyStrong" numberOfLines={1}>
            {row.merchantName}
          </Text>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {summary}
          </Text>
          <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
            {t('home.reorder_meta', { when, amount: amountParam(row.order.totalIqd) })}
          </Text>
        </View>
        <IconButton testID="home-reorder-go" icon="refresh" variant="tonal" accessibilityLabel={t('orders.reorder')} onPress={onReorder} disabled={busy} />
      </View>
    </Card>
  );
}
