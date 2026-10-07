import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { orderTicketNumber, type OrderHistoryRow } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { AnimatedPressable, formatClock, Icon, StatusPill, Text, useNow, usePressScale, useTheme } from '@driver/ui';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { liveEta } from '@/features/track/eta';
import { newerRead, stageEtaKey, liveStage } from '@/features/home/live-card';
import { useTracking } from '@/features/track/queries';
import { roadDots } from '@/features/track/track-v2';
import { RoadDots } from '@/features/track/TrackParts';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { dayKey, shortStatus } from './history';
import { dayLabel, orderTitle } from './OrderRow';
import { rowDish, rowOpens, rowWord } from './orders-v2';
import { itemsSummary } from './reorder';

/**
 * The rows of the redesigned «طلباتي» (after-order design Step 4, switch `orders_v2`): kitchen orders
 * only. A running one is a live card with the same four-dot road as its live screen (o2); a finished
 * one shows its dish (o1) and a saffron «اطلبه مرة ثانية» (o3), and opens as its receipt (o7).
 */

/** The dish on its cream plate (o1): the merchant's photo when there is one, else the drawn dish. */
export function DishThumb({ row, size = 56 }: { row: OrderHistoryRow; size?: number }) {
  const theme = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.accentTint }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <FoodArt {...artOf(rowDish(row))} stage={theme.colors.accentTint} />
    </View>
  );
}

/** «اطلبه مرة ثانية» (o3): saffron-brown on saffron tint, the one warm action on a row. */
export function AgainPill({ onPress, loading, testID, label }: { onPress: () => void; loading: boolean; testID?: string; label?: string }) {
  const theme = useTheme();
  const t = useT();
  const text = label ?? t('orders.reorder');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ busy: loading, disabled: loading }}
      disabled={loading}
      onPress={() => {
        theme.haptic('light');
        onPress();
      }}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[1],
        minHeight: 36,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.accentTint,
        opacity: pressed ? 0.7 : 1,
        alignSelf: 'flex-start',
      })}
    >
      {loading ? <ActivityIndicator size="small" color={theme.colors.accentText} /> : <Icon name="refresh" size={16} color="accentText" strokeWidth={2.4} />}
      <Text variant="label" weight={700} color="accentText" numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
}

/**
 * A finished (or not yet live) kitchen order (o1): the dish, the kitchen, the dishes, «8:40 م · 9,750
 * دينار · #4821», one word only when it did not arrive, and «اطلبه مرة ثانية». Tapping opens the
 * receipt; a running order (one in «طلباتي» before its live card loads) opens its live screen.
 */
export function FoodOrderRow({ row, divider, again }: { row: OrderHistoryRow; divider?: boolean; again?: { onPress: () => void; loading: boolean } }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const o = row.order;
  const title = orderTitle(t, row, locale);
  const summary = itemsSummary(row.items);
  const word = rowWord(o);
  const meta = [t('orders.row_meta', { time: formatClock(o.placedAt), amount: amountParam(o.totalIqd) }), `#${orderTicketNumber(o.id)}`].join(' · ');
  const opens = rowOpens(o);
  const open = () => router.push({ pathname: '/order/[id]', params: opens === 'receipt' ? { id: o.id, view: 'receipt' } : { id: o.id } });
  return (
    <View testID={`order-${o.id}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3], padding: theme.space[4], borderBottomWidth: divider ? 1 : 0, borderColor: theme.colors.border }}>
      <Pressable
        testID={`order-open-${o.id}`}
        accessibilityRole="button"
        accessibilityLabel={[title, summary, word ? t(`orders.short.${word}` as MessageKey) : null, meta, opens === 'receipt' ? t('orders2.receipt_hint') : null].filter(Boolean).join('، ')}
        onPress={open}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', gap: theme.space[3], opacity: pressed ? 0.7 : 1, minWidth: 0 })}
      >
        <DishThumb row={row} />
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {title}
            </Text>
            {word ? <StatusPill size="sm" tone={word === 'disputed' ? 'warning' : word === 'refunded' ? 'info' : 'neutral'} label={t(`orders.short.${word}` as MessageKey)} /> : null}
          </View>
          {summary ? (
            <Text variant="footnote" color="textMuted" numberOfLines={2}>
              {summary}
            </Text>
          ) : null}
          <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
            {meta}
          </Text>
          {again ? (
            <View style={{ marginTop: theme.space[2] }}>
              <AgainPill testID={`reorder-${o.id}`} loading={again.loading} onPress={again.onPress} />
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

/**
 * The running kitchen order on top (o2): its dish, «مطعم خالد · بالطريق», «يوصل 5:38», and the same
 * four-dot road as its live screen and home's card (one helper, so they never disagree).
 */
export function LiveOrderCard({ row }: { row: OrderHistoryRow }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const press = usePressScale(0.985);
  const track = useTracking(row.order.id);
  const tick = useNow(true, 30_000);
  const v = track.data;
  // The list and the tracking read refresh on their own clocks: follow whichever is further along.
  const o = newerRead(row.order, v?.order.id === row.order.id ? v.order : null);
  const refetch = track.refetch;
  useEffect(() => {
    void refetch();
  }, [row.order.state, refetch]);
  const stage = liveStage(o);
  const eta = v ? (liveEta(v, null, new Date(tick)) ?? v.promisedAt) : null;
  const name = orderTitle(t, row, locale);
  const status = t(`orders.short.${shortStatus(o)}` as MessageKey);
  const minutes = eta ? Math.max(1, Math.round((eta.getTime() - tick) / 60_000)) : null;
  return (
      <AnimatedPressable
        testID={`order-live-${row.order.id}`}
        accessibilityRole="button"
        accessibilityLabel={[name, status, eta ? `${t(stageEtaKey(stage))} ${formatClock(eta)}` : null].filter(Boolean).join('، ')}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => router.push({ pathname: '/order/[id]', params: { id: row.order.id } })}
        style={[{ gap: theme.space[4], padding: theme.space[4], borderRadius: theme.radius['2xl'], backgroundColor: theme.colors.accentTint }, press.style]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, overflow: 'hidden', backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.accent }}>
            <FoodArt {...artOf(rowDish(row))} stage={theme.colors.surface} />
          </View>
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {t('orders2.live_title', { merchant: name, status })}
            </Text>
            {eta ? (
              <Text variant="footnote" color="textMuted" tabular numberOfLines={1} testID="orders-live-eta">
                {`${t(stageEtaKey(stage))} ${formatClock(eta)}`}
              </Text>
            ) : (
              <Text variant="footnote" color="textMuted" numberOfLines={1}>
                {itemsSummary(row.items)}
              </Text>
            )}
          </View>
          {minutes !== null ? (
            <View style={{ paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderRadius: theme.radius.pill, backgroundColor: theme.colors.inverse }}>
              <Text variant="label" weight={700} color="onInverseAccent" tabular>
                {t('track.eta_minutes', { minutes })}
              </Text>
            </View>
          ) : null}
        </View>
        <RoadDots dots={roadDots(o)} testID={`orders-road-${row.order.id}`} />
      </AnimatedPressable>
  );
}

/** The heading over a day of orders: «اليوم», «أمس», «الخميس 2/10». */
export function dayHeading(t: ReturnType<typeof useT>, at: Date, now: Date): string {
  return dayLabel(t, dayKey(at, now));
}
