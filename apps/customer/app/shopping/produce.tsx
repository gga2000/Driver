import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { formatAmount, QueryBoundary, Skeleton, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import type { Stall } from '@/features/shopping/model';
import { useShopping } from '@/features/shopping/palette';
import { ProducePhoto } from '@/features/shopping/ProducePhoto';
import { useShoppingFront } from '@/features/shopping/queries';
import { ShopHeader } from '@/features/shopping/ShopHeader';

/**
 * خضرة وفواكه: the stalls near the customer, each with when it photographed this morning and a strip
 * of today's pictures and prices, so the freshest stall is visible before opening one.
 */
export default function ProduceStalls() {
  const theme = useTheme();
  const t = useT();
  const front = useShoppingFront();
  return (
    <Screen testID="shopping-produce" edges={['bottom']}>
      <ShopHeader title={t('shopping.door_produce')} sub={t('shopping.produce_sub')} />
      <QueryBoundary
        query={front}
        skeleton={<Skeleton style={{ height: 220, borderRadius: theme.radius.xl }} />}
        isEmpty={(d) => d.stalls.length === 0}
        empty={{ icon: 'bag', title: t('shopping.no_stalls'), body: t('shopping.no_stalls_body') }}
      >
        {(data) => (
          <View style={{ gap: theme.space[3] }}>
            {data.stalls.map((s) => (
              <StallCard key={s.id} stall={s} />
            ))}
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

function StallCard({ stall }: { stall: Stall }) {
  const theme = useTheme();
  const shop = useShopping();
  const t = useT();
  const shown = stall.items.slice(0, 4);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${stall.name}، ${stall.postedAt ? t('shopping.posted_at', { time: stall.postedAt }) : t('shopping.not_posted')}`}
      onPress={() => router.push({ pathname: '/shopping/stall/[id]', params: { id: stall.id } })}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.space[4],
        gap: theme.space[3],
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View style={{ gap: 2 }}>
        <Text variant="title" weight={700}>
          {stall.name}
        </Text>
        <Text variant="footnote" color="textMuted">
          {t('shopping.stall_meta', {
            rating: stall.rating ?? '—',
            area: stall.area,
            min: stall.minutes,
          })}
        </Text>
        <Text
          variant="footnote"
          weight={600}
          style={{ color: stall.postedAt ? shop.fill : theme.colors.textMuted }}
        >
          {stall.postedAt
            ? t('shopping.posted_at', { time: stall.postedAt })
            : t('shopping.not_posted')}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        {shown.map((item) => (
          <View key={item.id} style={{ flex: 1, gap: 2, alignItems: 'center' }}>
            <ProducePhoto
              uri={item.photo}
              label={item.name}
              style={{ width: '100%', height: 60, borderRadius: theme.radius.md }}
            />
            <Text variant="caption" weight={600} numberOfLines={1}>
              {item.name}
            </Text>
            <Text variant="caption" weight={700} tabular>
              {formatAmount(item.priceIqd)}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}
