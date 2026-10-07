import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { orderTicketNumber, type OrderHistoryRow } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { formatClock, Icon, StatusPill, Text, toneFor, useTheme, type IconName, type StatusTone } from '@driver/ui';
import { HERO, monogram } from '@/features/home/RestaurantRail';
import { isBookedRide } from '@/features/ride-habits/logic';
import type { TFn } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { zoneName, type AppLocale } from '@/lib/profile';
import { dayKey, isRunning, shortStatus, type DayKey, type ShortStatus } from './history';
import { itemsSummary } from './reorder';

const STATUS_TONE: Record<ShortStatus, StatusTone> = {
  waiting: 'accent',
  accepted: 'accent',
  preparing: 'accent',
  on_the_way: 'accent',
  searching: 'accent',
  driver_coming: 'accent',
  delivered: 'success',
  done: 'success',
  rejected: 'neutral',
  cancelled: 'neutral',
  refunded: 'info',
  disputed: 'warning',
  failed: 'neutral',
};

/** "مطعم خالد" · "مشوار لـ شارع 30" · "الرجعة" — what the row is called. */
export function orderTitle(t: TFn, row: OrderHistoryRow, locale: AppLocale): string {
  if (row.merchantName) return row.merchantName;
  if (row.order.type === 'seat') return t('orders.seat_title');
  if (row.order.type === 'ride') return row.dropoffZoneKey ? t('orders.ride_to', { zone: zoneName(row.dropoffZoneKey, locale) }) : t('orders.ride_title');
  return t(`order.type.${row.order.type}` as MessageKey);
}

/** "اليوم" · "أمس" · "الجمعة 2/10" (· the year when it isn't this one). */
export function dayLabel(t: TFn, day: DayKey): string {
  if (day.kind === 'today') return t('orders.day_today');
  if (day.kind === 'yesterday') return t('orders.day_yesterday');
  if (!day.thisYear) return t('orders.day_date_year', { day: day.day, month: day.month, year: day.year });
  return t('orders.day_date', { weekday: t(`orders.weekday_${day.weekday}` as MessageKey), day: day.day, month: day.month });
}

/** The row's leading tile: the restaurant's initial on its tone, or the service icon. */
export function OrderArt({ row, size = 48 }: { row: OrderHistoryRow; size?: number }) {
  const theme = useTheme();
  if (row.merchantName) {
    const tone = HERO[toneFor(row.merchantName)];
    return (
      <View style={{ width: size, height: size, borderRadius: theme.radius.lg, backgroundColor: theme.colors[tone.bg], alignItems: 'center', justifyContent: 'center' }}>
        <Text weight={700} color={tone.fg} style={{ fontSize: Math.round(size * 0.46), lineHeight: Math.round(size * 0.66) }}>
          {monogram(row.merchantName)}
        </Text>
      </View>
    );
  }
  const icon: IconName = row.order.type === 'seat' ? 'seat' : row.order.type === 'ride' ? 'car' : row.order.type === 'parcel' ? 'parcel' : 'food';
  return (
    <View style={{ width: size, height: size, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={Math.round(size * 0.5)} color="textMuted" strokeWidth={1.8} />
    </View>
  );
}

/**
 * One order in طلباتي (audit C-15 / C-44): restaurant (title, never squeezed by the pill), the dishes,
 * time · total · ticket number, a one-word status, and "اطلبه مرة ثانية" on food that reached the door.
 */
export function OrderRow({ row, now, showDay, divider, action }: { row: OrderHistoryRow; now: Date; showDay?: boolean; divider?: boolean; action?: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const o = row.order;
  const status = shortStatus(o);
  const running = isRunning(o);
  const title = orderTitle(t, row, locale);
  const summary = itemsSummary(row.items);
  const time = showDay ? `${dayLabel(t, dayKey(o.placedAt, now))} ${formatClock(o.placedAt)}` : formatClock(o.placedAt);
  const meta = [t('orders.row_meta', { time, amount: amountParam(o.totalIqd) }), `#${orderTicketNumber(o.id)}`].join(' · ');
  return (
    <View style={{ borderBottomWidth: divider ? 1 : 0, borderColor: theme.colors.border }}>
      <Pressable
        testID={`order-${o.id}`}
        accessibilityRole="button"
        accessibilityLabel={[title, summary, t(`orders.short.${status}` as MessageKey), meta].filter(Boolean).join('، ')}
        onPress={() => router.push({ pathname: isBookedRide(o, now) ? '/ride/booked/[id]' : '/order/[id]', params: { id: o.id } })}
        style={({ pressed }) => ({ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], paddingBottom: action ? theme.space[2] : theme.space[4], backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent' })}
      >
        <OrderArt row={row} />
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {title}
            </Text>
            <StatusPill size="sm" tone={STATUS_TONE[status]} live={running} label={t(`orders.short.${status}` as MessageKey)} />
          </View>
          {summary ? (
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
          <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </Pressable>
      {action ? <View style={{ flexDirection: 'row', paddingHorizontal: theme.space[4], paddingBottom: theme.space[3], paddingStart: theme.space[4] + 48 + theme.space[3] }}>{action}</View> : null}
    </View>
  );
}
