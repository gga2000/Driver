import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatIqd,
  Icon,
  IconButton,
  QueryBoundary,
  Skeleton,
  Text,
  useTheme,
  type IconName,
} from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { BakeryStatePill, useBakeryStateText } from '@/features/shopping/BakeryState';
import { breadCart, useBreadCart } from '@/features/shopping/basket';
import { goCheckout } from '@/features/shopping/checkout';
import { GreenBar } from '@/features/shopping/GreenBar';
import type { Bakery } from '@/features/shopping/model';
import { PackStepper } from '@/features/shopping/PackStepper';
import { useShopping } from '@/features/shopping/palette';
import { ProducePhoto } from '@/features/shopping/ProducePhoto';
import { useBakery } from '@/features/shopping/queries';

/**
 * A bakery (round 2, redrawn after Ali 2026-10-11 21:26Z: "there is no وجبة, they make bread and samoon
 * all the time"): the oven photo with the bakery's state (open, paused for a bit, closed), three honest
 * facts (straight from the oven, about how long, until when), its breads in its own lots, and the way
 * to «صمون كل يوم». Ordering waits while it is paused or closed.
 */
export default function BakeryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const q = useBakery(id);
  return (
    <QueryBoundary
      style={{ flex: 1 }}
      query={q}
      skeleton={
        <Screen padded={false} edges={[]}>
          <Skeleton style={{ height: 262 }} />
        </Screen>
      }
      isEmpty={(b) => b == null}
      empty={{
        icon: 'bag',
        title: t('shopping.bakery_gone'),
        action: {
          label: t('shopping.door_bakeries'),
          onPress: () => router.replace('/shopping/bakeries'),
        },
      }}
    >
      {(b) => (b ? <BakeryBody bakery={b} /> : null)}
    </QueryBoundary>
  );
}

function BakeryBody({ bakery }: { bakery: Bakery }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const stateText = useBakeryStateText()(bakery);
  const cart = useBreadCart();
  const packs = useMemo(() => (cart.bakeryId === bakery.id ? cart.packs : {}), [cart, bakery.id]);
  const total = useMemo(
    () => bakery.items.reduce((sum, i) => sum + (packs[i.id] ?? 0) * i.priceIqd, 0),
    [bakery.items, packs],
  );
  const open = bakery.state === 'open';

  const footer = !open ? (
    <View
      style={{
        minHeight: 58,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.surfaceSunken,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: theme.space[4],
      }}
    >
      <Text variant="label" weight={600} color="textMuted" align="center">
        {t('shopping.bakery_wait', { state: stateText })}
      </Text>
    </View>
  ) : total > 0 ? (
    <GreenBar
      label={t('shopping.bakery_order')}
      amountIqd={total}
      onPress={() => void goCheckout('bakery')}
    />
  ) : undefined;

  return (
    <Screen
      testID="shopping-bakery"
      padded={false}
      edges={['bottom']}
      footer={
        footer ? <View style={{ paddingHorizontal: theme.space[5] }}>{footer}</View> : undefined
      }
      contentStyle={{ paddingTop: 0 }}
    >
      <View style={{ height: 262 + insets.top }}>
        <ProducePhoto
          uri={bakery.photo}
          label={t('shopping.bakery_photo_a11y', { name: bakery.name })}
          style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 }}
        />
        <Svg
          pointerEvents="none"
          style={{ position: 'absolute', start: 0, end: 0, bottom: 0, height: 200, width: '100%' }}
        >
          <Defs>
            <LinearGradient id="bakery-veil" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={theme.colors.photoBackdrop} stopOpacity={0} />
              <Stop offset="1" stopColor={theme.colors.photoBackdrop} stopOpacity={0.8} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#bakery-veil)" />
        </Svg>
        <View
          style={{ position: 'absolute', top: insets.top + theme.space[3], start: theme.space[4] }}
        >
          <IconButton
            icon="arrow-back"
            variant="tonal"
            accessibilityLabel={t('action.back')}
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace('/shopping/bakeries')
            }
          />
        </View>
        <View
          style={{
            position: 'absolute',
            start: theme.space[5],
            end: theme.space[5],
            bottom: theme.space[4],
            gap: 4,
          }}
        >
          <BakeryStatePill bakery={bakery} onPhoto />
          <Text
            variant="display"
            accessibilityRole="header"
            style={{ color: theme.colors.onPhotoBackdrop }}
          >
            {bakery.name}
          </Text>
          <Text variant="label" style={{ color: theme.colors.onPhotoBackdrop }}>
            {bakery.street}
          </Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: theme.space[5], gap: theme.space[3] }}>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.xl,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingVertical: theme.space[3],
          }}
        >
          <Fact icon="flame" big={t('shopping.fact_hot')} small={t('shopping.fact_hot_sub')} />
          <View style={{ width: 1, backgroundColor: theme.colors.border }} />
          <Fact
            icon="bike"
            big={t('shopping.fact_minutes', { min: bakery.minutes })}
            small={t('shopping.fact_minutes_sub')}
          />
          {bakery.closesAt ? (
            <>
              <View style={{ width: 1, backgroundColor: theme.colors.border }} />
              <Fact
                icon="clock"
                big={t('shopping.fact_until', { time: bakery.closesAt })}
                small={t('shopping.fact_until_sub')}
              />
            </>
          ) : null}
        </View>

        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.xl,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: theme.space[4],
          }}
        >
          {bakery.items.map((item, i) => (
            <View
              key={item.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space[3],
                paddingVertical: theme.space[3],
                borderTopWidth: i ? 1 : 0,
                borderTopColor: theme.colors.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" weight={700}>
                  {item.name}
                </Text>
                <Text variant="footnote" weight={600} color="textMuted">
                  {t('shopping.lot', { n: item.per, amount: formatIqd(item.priceIqd) })}
                </Text>
              </View>
              {item.available ? (
                <PackStepper
                  packs={packs[item.id] ?? 0}
                  per={item.per}
                  label={item.name}
                  onChange={(n) => breadCart.set(bakery.id, item.id, n)}
                />
              ) : (
                <Text variant="footnote" weight={600} color="textMuted">
                  {t('shopping.sold_out_now')}
                </Text>
              )}
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: '/shopping/daily-bread', params: { bakery: bakery.id } })
          }
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[3],
            minHeight: 56,
            padding: theme.space[3],
            borderRadius: theme.radius.lg,
            backgroundColor: theme.services.food.card.bg,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Icon name="refresh" size={20} color={theme.colors.text} />
          <View style={{ flex: 1 }}>
            <Text variant="label" weight={700}>
              {t('shopping.daily_title')}
            </Text>
            <Text variant="caption" color="textMuted">
              {t('shopping.daily_teaser')}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color={theme.colors.text} />
        </Pressable>
      </View>
    </Screen>
  );
}

function Fact({ icon, big, small }: { icon: IconName; big: string; small: string }) {
  const theme = useTheme();
  const shop = useShopping();
  return (
    <View
      accessible
      accessibilityLabel={`${big}، ${small}`}
      style={{ flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: theme.space[1] }}
    >
      <Icon name={icon} size={20} color={shop.fill} />
      <Text variant="label" weight={700} align="center" numberOfLines={1}>
        {big}
      </Text>
      <Text variant="caption" color="textMuted" align="center" numberOfLines={1}>
        {small}
      </Text>
    </View>
  );
}
