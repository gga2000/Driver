import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { formatIqd, QueryBoundary, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import type { MessageKey } from '@driver/i18n';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { GreenBar } from '@/features/shopping/GreenBar';
import type { Bakery } from '@/features/shopping/model';
import { PackStepper } from '@/features/shopping/PackStepper';
import { useShopping } from '@/features/shopping/palette';
import { ProducePhoto } from '@/features/shopping/ProducePhoto';
import { useBakery } from '@/features/shopping/queries';
import { ShopHeader } from '@/features/shopping/ShopHeader';

/** When the bread should be at the door (Ali 2026-10-11: bakeries bake all day, so it is a time, not a batch). */
const TIMES = [
  { id: 'morning', time: '6:30', part: 'shopping.part_morning' },
  { id: 'noon', time: '1:00', part: 'shopping.part_noon' },
  { id: 'evening', time: '7:00', part: 'shopping.part_evening' },
] as const;

/** The Iraqi week, Saturday first. */
const DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;

/**
 * «صمون كل يوم» (round 1 C2, redrawn 2026-10-11): a standing bread order. The customer picks when it
 * should arrive, which days and how much; we order it from the bakery a little before, and the
 * courier takes it straight from the oven. Paid in cash each day. Delivery is priced by the server
 * when the order is set; the screen shows where it starts.
 */
export default function DailyBread() {
  const { bakery: id } = useLocalSearchParams<{ bakery: string }>();
  const theme = useTheme();
  const t = useT();
  const q = useBakery(id);
  return (
    <QueryBoundary
      style={{ flex: 1 }}
      query={q}
      skeleton={
        <Screen>
          <Skeleton style={{ height: 480, borderRadius: theme.radius.xl }} />
        </Screen>
      }
      isEmpty={(b) => b == null}
      empty={{ icon: 'bag', title: t('shopping.bakery_gone') }}
    >
      {(b) => (b ? <DailyBody bakery={b} /> : null)}
    </QueryBoundary>
  );
}

function DailyBody({ bakery }: { bakery: Bakery }) {
  const theme = useTheme();
  const shop = useShopping();
  const t = useT();
  const toast = useToast();
  const [time, setTime] = useState<(typeof TIMES)[number]['id']>('morning');
  const [itemId, setItemId] = useState(bakery.items[0]?.id ?? '');
  const [packs, setPacks] = useState(5);
  const [days, setDays] = useState<Set<string>>(new Set(DAYS.filter((d) => d !== 'fri')));
  const item = bakery.items.find((i) => i.id === itemId) ?? bakery.items[0];
  if (!item) return null;
  const pieces = packs * item.per;
  const bread = packs * item.priceIqd;
  const chosen = TIMES.find((x) => x.id === time) ?? TIMES[0];

  const chip = (on: boolean) => ({
    flex: 1,
    minHeight: 56,
    borderRadius: theme.radius.lg,
    borderWidth: on ? 2 : 1.5,
    borderColor: on ? shop.fill : theme.colors.border,
    backgroundColor: on ? shop.tint : 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  });

  return (
    <Screen
      testID="shopping-daily-bread"
      edges={['bottom']}
      footer={
        <GreenBar
          label={t('shopping.daily_set', { n: pieces })}
          amountIqd={bread}
          onPress={() => toast.show({ message: t('shopping.checkout_soon') })}
          a11y={t('shopping.daily_set_a11y', { n: pieces, amount: formatIqd(bread), days: days.size })}
        />
      }
    >
      <ShopHeader title={t('shopping.daily_title')} sub={bakery.name} fallback="/shopping/bakeries" />
      <Text variant="body" color="textMuted">
        {t('shopping.daily_body', { name: bakery.name })}
      </Text>

      <Text variant="label" weight={700} color="textMuted">
        {t('shopping.daily_when')}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        {TIMES.map((x) => {
          const on = x.id === time;
          return (
            <Pressable key={x.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setTime(x.id)} style={chip(on)}>
              <Text variant="bodyStrong" weight={700} tabular style={{ color: on ? shop.onTint : theme.colors.text }}>
                {x.time}
              </Text>
              <Text variant="caption" weight={600} style={{ color: on ? shop.onTint : theme.colors.textMuted }}>
                {t(x.part as MessageKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {bakery.items.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {bakery.items.map((i) => {
            const on = i.id === item.id;
            return (
              <Pressable
                key={i.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setItemId(i.id)}
                style={{ minHeight: 44, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, borderWidth: on ? 2 : 1.5, borderColor: on ? shop.fill : theme.colors.border, backgroundColor: on ? shop.tint : 'transparent', justifyContent: 'center' }}
              >
                <Text variant="label" weight={on ? 700 : 600} style={{ color: on ? shop.onTint : theme.colors.text }}>
                  {i.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text variant="bodyStrong" weight={700}>
            {item.name}
          </Text>
          <Text variant="footnote" weight={600} color="textMuted">
            {t('shopping.lot', { n: item.per, amount: formatIqd(item.priceIqd) })}
          </Text>
        </View>
        <PackStepper packs={packs} per={item.per} label={item.name} onChange={(n) => setPacks(Math.max(1, n))} />
      </View>

      <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[3], gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="label" weight={700}>
            {t('shopping.daily_days')}
          </Text>
          <Text variant="caption" weight={600} color="textMuted">
            {t('shopping.daily_days_count', { n: days.size })}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {DAYS.map((d) => {
            const on = days.has(d);
            return (
              <Pressable
                key={d}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() =>
                  setDays((prev) => {
                    const next = new Set(prev);
                    if (next.has(d)) {
                      if (next.size > 1) next.delete(d);
                    } else next.add(d);
                    return next;
                  })
                }
                style={{ flex: 1, minHeight: 44, borderRadius: theme.radius.md, backgroundColor: on ? shop.fill : 'transparent', borderWidth: on ? 0 : 1.5, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text variant="caption" weight={600} numberOfLines={1} style={{ color: on ? shop.on : theme.colors.textMuted }}>
                  {t(`shopping.day_${d}` as MessageKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text variant="caption" color="textMuted">
          {t('shopping.daily_pause_hint')}
        </Text>
      </View>

      <View style={{ gap: 4 }}>
        <Line label={t('shopping.daily_bread_line')} value={formatIqd(bread)} />
        <Line label={t('shopping.delivery')} value={t('shopping.delivery_from', { amount: formatIqd(500) })} />
        <Text variant="footnote" color="textMuted">
          {t('shopping.daily_cash', { time: chosen.time, part: t(chosen.part as MessageKey) })}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.services.food.card.bg }}>
        <ProducePhoto uri="/media/food/shop-door-handover-1.webp" label="" style={{ width: 52, height: 52, borderRadius: theme.radius.md }} />
        <Text variant="footnote" weight={600} style={{ flex: 1 }}>
          {t('shopping.daily_hot_promise')}
        </Text>
      </View>
    </Screen>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant="label" color="textMuted">
        {label}
      </Text>
      <Text variant="label" weight={600} tabular>
        {value}
      </Text>
    </View>
  );
}
