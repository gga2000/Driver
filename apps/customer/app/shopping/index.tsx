import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatAmount,
  Icon,
  IconButton,
  QueryBoundary,
  Skeleton,
  Text,
  useTheme,
} from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import type { ProduceItem, ShoppingFront } from '@/features/shopping/model';
import { useShopping } from '@/features/shopping/palette';
import { ProducePhoto } from '@/features/shopping/ProducePhoto';
import { useShoppingFront } from '@/features/shopping/queries';

/**
 * السوق, the shopping front (round 2, Ali 2026-10-11): two photo doors (الأفران with how many are
 * open now, خضرة وفواكه with this morning's photos and prices), «أسواق» for the house's shelves, the
 * green «دوّرلي» card for anything from any shop, and today's prices from the stalls.
 */
export default function ShoppingFront() {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const front = useShoppingFront();
  return (
    <Screen
      testID="shopping-front"
      edges={[]}
      contentStyle={{
        paddingTop: insets.top + theme.space[3],
        paddingBottom: insets.bottom + theme.space[8],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconButton
          icon="arrow-back"
          variant="tonal"
          accessibilityLabel={t('action.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      </View>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="display" accessibilityRole="header">
          {t('shopping.title')}
        </Text>
        <Text variant="body" color="textMuted">
          {t('shopping.subtitle')}
        </Text>
      </View>
      <QueryBoundary query={front} skeleton={<FrontSkeleton />}>
        {(data) => <Front data={data} />}
      </QueryBoundary>
    </Screen>
  );
}

function FrontSkeleton() {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <Skeleton style={{ flex: 1, height: 220, borderRadius: theme.radius.xl }} />
        <Skeleton style={{ flex: 1, height: 220, borderRadius: theme.radius.xl }} />
      </View>
      <Skeleton style={{ height: 116, borderRadius: theme.radius.xl }} />
      <Skeleton style={{ height: 96, borderRadius: theme.radius.xl }} />
    </View>
  );
}

function Front({ data }: { data: ShoppingFront }) {
  const theme = useTheme();
  const shop = useShopping();
  const t = useT();
  const stall = data.stalls[0];
  const today = stall ? stall.items.filter((i) => i.photoToday).slice(0, 4) : [];
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <Door
          title={t('shopping.door_bakeries')}
          photo="/media/food/shop-samoon-oven-1.webp"
          fact={t('shopping.bakeries_open', { n: data.bakeriesOpen })}
          live
          onPress={() => router.push('/shopping/bakeries')}
        />
        <Door
          title={t('shopping.door_produce')}
          photo="/media/food/shop-produce-stall-1.webp"
          fact={t('shopping.produce_fact')}
          onPress={() => router.push('/shopping/produce')}
        />
      </View>

      <View
        accessible
        accessibilityLabel={`${t('shopping.door_markets')}، ${t('shopping.markets_fact')}، ${t('shopping.soon')}`}
        style={{
          flexDirection: 'row',
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.xl,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <ProducePhoto
          uri="/media/food/shop-dukkan-1.webp"
          label=""
          style={{ width: 132, height: 112 }}
        />
        <View style={{ flex: 1, padding: theme.space[3], justifyContent: 'center', gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="title" weight={700}>
              {t('shopping.door_markets')}
            </Text>
            <View
              style={{
                paddingHorizontal: theme.space[2],
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.surfaceSunken,
              }}
            >
              <Text variant="caption" weight={600} color="textMuted">
                {t('shopping.soon')}
              </Text>
            </View>
          </View>
          <Text variant="footnote" color="textMuted">
            {t('shopping.markets_fact')}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('shopping.dawwerli')}، ${t('shopping.dawwerli_fact')}`}
        onPress={() => router.push('/shopping/dawwerli')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          backgroundColor: shop.fill,
          borderRadius: theme.radius['2xl'],
          paddingVertical: theme.space[3],
          paddingStart: theme.space[4],
          paddingEnd: theme.space[3],
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="section" style={{ color: shop.on }}>
            {t('shopping.dawwerli')}
          </Text>
          <Text variant="footnote" style={{ color: shop.on, opacity: 0.92 }}>
            {t('shopping.dawwerli_fact')}
          </Text>
        </View>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="arrow-forward" size={18} color={theme.colors.text} />
        </View>
      </Pressable>

      {stall && today.length ? (
        <View style={{ gap: theme.space[2], marginTop: theme.space[2] }}>
          <Text variant="label" weight={700} color="textMuted">
            {t('shopping.today_prices')}
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            {today.map((item) => (
              <PriceTile
                key={item.id}
                item={item}
                onPress={() =>
                  router.push({
                    pathname: '/shopping/stall/[id]',
                    params: { id: stall.id, item: item.id },
                  })
                }
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Door({
  title,
  photo,
  fact,
  live,
  onPress,
}: {
  title: string;
  photo: string;
  fact: string;
  live?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const shop = useShopping();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}، ${fact}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.xl,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.border,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <ProducePhoto uri={photo} label="" style={{ width: '100%', height: 150 }} />
      <View style={{ padding: theme.space[3], gap: 2 }}>
        <Text variant="title" weight={700}>
          {title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
          {live ? (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: shop.fill }} />
          ) : null}
          <Text
            variant="footnote"
            weight={live ? 600 : 400}
            style={{ color: live ? shop.fill : theme.colors.textMuted }}
          >
            {fact}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function PriceTile({ item, onPress }: { item: ProduceItem; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('shopping.tile_a11y', {
        name: item.name,
        amount: formatAmount(item.priceIqd),
      })}
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        gap: 2,
        padding: theme.space[2],
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <ProducePhoto
        uri={item.photo}
        label=""
        style={{ width: '100%', height: 56, borderRadius: theme.radius.md }}
      />
      <Text variant="footnote" weight={600} numberOfLines={1}>
        {item.name}
      </Text>
      <Text variant="footnote" weight={700} tabular>
        {formatAmount(item.priceIqd)}
      </Text>
    </Pressable>
  );
}
