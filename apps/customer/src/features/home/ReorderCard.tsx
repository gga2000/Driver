import type { OrderHistoryRow } from '@driver/contracts';
import { formatClock } from '@driver/ui';
import { dayKey } from '@/features/orders/history';
import { dayLabel } from '@/features/orders/OrderRow';
import { itemsSummary } from '@/features/orders/reorder';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { SlotCard } from './SlotCard';

/**
 * "اطلب نفس الطلب" on home (audit C-15): the last meal that reached the door, by restaurant and
 * dishes, one tap to put it back in the cart at today's prices (the reorder sheet explains changes).
 */
export function ReorderCard({ row, now, photo, busy, onReorder }: { row: OrderHistoryRow; now: Date; photo: number | string | null; busy: boolean; onReorder: () => void }) {
  const t = useT();
  const day = dayKey(row.order.placedAt, now);
  const when = day.kind === 'today' ? `${dayLabel(t, day)} ${formatClock(row.order.placedAt)}` : dayLabel(t, day);
  const summary = itemsSummary(row.items, 2);
  return (
    <SlotCard
      testID="home-reorder"
      kicker={t('home.reorder_kicker')}
      row={row}
      dishes={summary}
      meta={t('home.reorder_meta', { when, amount: amountParam(row.order.totalIqd) })}
      photo={photo}
      action={t('home.again')}
      actionIcon="refresh"
      busy={busy}
      onPress={onReorder}
      accessibilityLabel={`${t('home.reorder')}: ${row.merchantName ?? ''}، ${summary}`}
    />
  );
}
