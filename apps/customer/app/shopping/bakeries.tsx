import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { QueryBoundary, Skeleton, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { BakeryStatePill } from '@/features/shopping/BakeryState';
import type { Bakery } from '@/features/shopping/model';
import { ProducePhoto } from '@/features/shopping/ProducePhoto';
import { useShoppingFront } from '@/features/shopping/queries';
import { ShopHeader } from '@/features/shopping/ShopHeader';

/** الأفران: the bakeries near the customer, open ones first, each with its state and how far it is. */
export default function Bakeries() {
  const theme = useTheme();
  const t = useT();
  const front = useShoppingFront();
  return (
    <Screen testID="shopping-bakeries" edges={['bottom']}>
      <ShopHeader title={t('shopping.door_bakeries')} sub={t('shopping.bakeries_sub')} />
      <QueryBoundary
        query={front}
        skeleton={<Skeleton style={{ height: 240, borderRadius: theme.radius.xl }} />}
        isEmpty={(d) => d.bakeries.length === 0}
        empty={{ icon: 'bag', title: t('shopping.no_bakeries') }}
      >
        {(data) => (
          <View style={{ gap: theme.space[3] }}>
            {[...data.bakeries]
              .sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open'))
              .map((b) => (
                <BakeryCard key={b.id} bakery={b} />
              ))}
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

function BakeryCard({ bakery }: { bakery: Bakery }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bakery.name}
      onPress={() => router.push({ pathname: '/shopping/bakery/[id]', params: { id: bakery.id } })}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.xl,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: bakery.state === 'closed' ? 0.75 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <ProducePhoto uri={bakery.photo} label="" style={{ width: '100%', height: 140 }} />
      <View style={{ padding: theme.space[4], gap: theme.space[1] }}>
        <Text variant="title" weight={700}>
          {bakery.name}
        </Text>
        <Text variant="footnote" color="textMuted">
          {t('shopping.bakery_meta', { street: bakery.street, min: bakery.minutes })}
        </Text>
        <BakeryStatePill bakery={bakery} />
      </View>
    </Pressable>
  );
}
