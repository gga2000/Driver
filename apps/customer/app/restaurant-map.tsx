import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, Icon, IconButton, Text, useLiteMode, useTheme, withAlpha } from '@driver/ui';
import { useCatalogRestaurants } from '@/features/food/queries';
import { Brief } from '@/features/restaurant-map/Brief';
import { RESTAURANT_MAP, RestaurantMap } from '@/features/restaurant-map/RestaurantMap';
import { mapShops, tourStep } from '@/features/restaurant-map/shops';
import { useT } from '@/lib/i18n';

const TOP_BAR = 56;

/**
 * مطاعم العزيزية on the map (Ali's idea, 2026-10-09; "A · Lantern tour"): the town with every restaurant
 * standing as its own 3D shop. Tap one and the camera flies to its front with a short brief; «الجاي»
 * flies on to the next, «شوف المنيو» opens it. `?id=` opens on one shop. Phones without the map yet,
 * and a map that fails, get the list.
 */
export default function RestaurantMapScreen() {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const lite = useLiteMode();
  const params = useLocalSearchParams<{ id?: string }>();
  const query = useCatalogRestaurants();
  const shops = useMemo(() => mapShops(query.data ?? []), [query.data]);
  const [selectedId, setSelectedId] = useState<string | null>(params.id ?? null);
  const [failed, setFailed] = useState(false);
  const [briefH, setBriefH] = useState(260);
  const index = shops.findIndex((s) => s.id === selectedId);
  const shop = index >= 0 ? shops[index]! : null;
  const toList = () => router.replace('/restaurants');

  const fallback = (title: string, body?: string) => (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top + TOP_BAR, justifyContent: 'center' }}>
      <EmptyState icon="map-pin" title={title} {...(body ? { body } : {})} action={{ label: t('restaurant_map.see_list'), onPress: toList }} />
    </View>
  );

  let body: React.ReactNode;
  if (!RESTAURANT_MAP) body = fallback(t('restaurant_map.title'), t('restaurant_map.phone_soon'));
  else if (failed) body = fallback(t('restaurant_map.error'));
  else if (query.isError && !query.data) {
    body = (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: 'center' }}>
        <EmptyState icon="refresh" title={t('restaurant_map.error')} action={{ label: t('restaurant_map.retry'), onPress: () => void query.refetch() }} />
      </View>
    );
  } else if (query.data && !shops.length) body = fallback(t('restaurant_map.empty'));
  else {
    body = (
      <>
        <RestaurantMap
          shops={shops}
          selectedId={shop?.id ?? null}
          onSelect={setSelectedId}
          topInset={insets.top + TOP_BAR}
          bottomInset={shop ? briefH + insets.bottom : 96 + insets.bottom}
          lite={lite}
          onFail={() => setFailed(true)}
        />
        <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: insets.bottom + theme.space[3], paddingHorizontal: theme.space[3] }]}>
          {shop ? (
            <Brief
              shop={shop}
              index={index}
              total={shops.length}
              onLayout={(e) => setBriefH(Math.round(e.nativeEvent.layout.height))}
              onMenu={() => router.push({ pathname: '/restaurant/[id]', params: { id: shop.id } })}
              onNext={() => setSelectedId(tourStep(shops, shop.id, 1)?.id ?? null)}
              onPrev={() => setSelectedId(tourStep(shops, shop.id, -1)?.id ?? null)}
            />
          ) : (
            <View style={{ alignSelf: 'center', paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], borderRadius: theme.radius.pill, backgroundColor: withAlpha(theme.colors.surface, 0.95) }}>
              <Text variant="footnote" weight={600} testID="restaurant-map-hint">
                {query.isLoading ? '…' : t('restaurant_map.hint')}
              </Text>
            </View>
          )}
        </View>
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
      {/* Top bar: back and the title over the town; «رجوع للخريطة» while a shop is open. */}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + theme.space[2], paddingHorizontal: theme.space[3], gap: theme.space[2] }]}>
        {shop ? (
          <Pressable
            onPress={() => setSelectedId(null)}
            accessibilityRole="button"
            testID="restaurant-map-back-to-map"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, boxShadow: '0 2px 8px rgba(40,24,8,0.18)' }}
          >
            <Icon name="arrow-back" size={18} color="text" strokeWidth={2.2} />
            <Text variant="footnote" weight={700}>
              {t('restaurant_map.back_to_map')}
            </Text>
          </Pressable>
        ) : (
          <>
            <View style={{ borderRadius: 22, backgroundColor: theme.colors.surface, boxShadow: '0 2px 8px rgba(40,24,8,0.18)' }}>
              <IconButton icon="arrow-back" variant="plain" accessibilityLabel={t('action.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="header-back" />
            </View>
            <View style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, boxShadow: '0 2px 8px rgba(40,24,8,0.18)' }}>
              <Text variant="bodyStrong" weight={700}>
                {t('restaurant_map.title')}
              </Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
