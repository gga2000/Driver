import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Chip, EmptyState, IconButton, RetryState, retryKindFor, SketchScene, Skeleton, Text, useLoadTimeout, useNetwork, useTheme } from '@driver/ui';
import { MAX_CONTENT_WIDTH, Screen } from '@/components/Screen';
import { filterKitchens, HOME_FILTERS, type HomeFilter } from '@/features/home-food/format';
import { KitchenCard } from '@/features/home-food/KitchenCard';
import { usePom } from '@/features/home-food/parts';
import { useHomeKitchens } from '@/features/home-food/queries';
import { useLocale, useT } from '@/lib/i18n';

const FILTER_KEY = { all: 'home_food.filter_all', ready: 'home_food.filter_ready', reserve: 'home_food.filter_reserve', sweets: 'home_food.filter_sweets' } as const;

/**
 * أكل بيت (Ali 2026-10-11, concept A made restaurant-like, v3 «love it»): Aziziyah's home kitchens,
 * each with its few dishes — ready now until the plates run out, or by reservation. Filters for ready
 * now, by reservation and home sweets. Public, like the food lists; closed while the city keeps home
 * kitchens closed.
 */
export default function HomeFoodScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const pom = usePom();
  const net = useNetwork();
  const kitchens = useHomeKitchens();
  const [slow, restartSlow] = useLoadTimeout(kitchens.isPending);
  const [filter, setFilter] = useState<HomeFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const all = kitchens.data?.kitchens;
  const shown = useMemo(() => filterKitchens(all ?? [], filter), [all, filter]);
  const failed = (kitchens.isError || slow) && !kitchens.data;

  const refresh = async () => {
    setRefreshing(true);
    await kitchens.refetch();
    setRefreshing(false);
  };

  let body: React.ReactNode;
  if (failed) {
    const kind = retryKindFor({ net, error: kitchens.error, slow });
    body = (
      <RetryState
        kind={kind}
        locale={locale}
        art={kind === 'offline' || kind === 'unreachable' ? <SketchScene name="offline" /> : undefined}
        {...(kind === 'server' || kind === 'slow' ? { title: t('home_food.load_failed') } : {})}
        onRetry={() => {
          restartSlow();
          void kitchens.refetch();
        }}
      />
    );
  } else if (!kitchens.data) {
    body = [0, 1].map((i) => <Skeleton key={i} height={262} radius={theme.radius.tile} />);
  } else if (!kitchens.data.open) {
    body = <EmptyState icon="food" title={t('home_food.soon_title')} body={t('home_food.soon_body')} />;
  } else if ((all ?? []).length === 0) {
    body = <EmptyState icon="food" title={t('home_food.none_title')} body={t('home_food.none_body')} />;
  } else if (shown.length === 0) {
    body = <EmptyState icon="food" title={t('home_food.empty_filter_title')} body={t('home_food.empty_filter_body')} action={{ label: t('home_food.show_all'), onPress: () => setFilter('all') }} />;
  } else {
    body = shown.map((k) => <KitchenCard key={k.id} k={k} />);
  }

  return (
    <Screen testID="home-food" padded={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <Stack.Screen options={{ headerShown: false, title: t('home_food.title') }} />
      <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: theme.space[5], gap: theme.space[4], paddingBottom: theme.space[8] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
          <View style={{ flex: 1 }}>
            <Text variant="label" face="voice" color={pom.ink}>
              {t('home_food.kicker')}
            </Text>
            <Text variant="display" face="display" accessibilityRole="header">
              {t('home_food.title')}
            </Text>
          </View>
          <IconButton icon="arrow-back" variant="outline" accessibilityLabel={t('action.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="home-food-back" />
        </View>
        {kitchens.data?.open && (all ?? []).length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -theme.space[5] }}
            contentContainerStyle={{ paddingHorizontal: theme.space[5], gap: theme.space[2] }}
            accessibilityLabel={t('home_food.filters')}
            testID="home-food-filters"
          >
            {HOME_FILTERS.map((f) => (
              <Chip key={f} testID={`home-food-filter-${f}`} role="radio" label={t(FILTER_KEY[f])} selected={filter === f} onPress={() => setFilter(f)} />
            ))}
          </ScrollView>
        ) : null}
        {body}
      </View>
    </Screen>
  );
}
