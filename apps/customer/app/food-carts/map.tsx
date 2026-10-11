import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, IconButton, Text, useTheme, withAlpha } from '@driver/ui';
import { CartPhoto } from '@/features/food-carts/CartPhoto';
import { CARTS_MAP, CartsMap } from '@/features/food-carts/CartsMap';
import { cartPalette } from '@/features/food-carts/palette';
import { useCarts } from '@/features/food-carts/queries';
import { cartStatus } from '@/features/food-carts/status';
import { useGrantedPosition } from '@/features/ride/phone-position';
import { useLocale, useT } from '@/lib/i18n';

const TOP_BAR = 64;
const CARD_H = 132;

/**
 * «شوفهم عالخريطة» (look A, golden light): the carts where they stand tonight, the nearest open one
 * chosen first, its card at the bottom with «افتحها». Closed carts show grey at their last spot. Phones
 * without the map yet, and a map that fails, go back to the list.
 */
export default function CartsMapScreen() {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const here = useGrantedPosition();
  const carts = useCarts(here.isError ? null : (here.data ?? null));
  const all = carts.data ? [...carts.data.open, ...carts.data.closed] : [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (selectedId === null && carts.data?.open[0]) setSelectedId(carts.data.open[0].id);
  }, [carts.data, selectedId]);
  const chosen = all.find((c) => c.id === selectedId) ?? null;

  // No map here, the map failed, or the carts could not be read: back to the list.
  if (!CARTS_MAP || failed || (carts.isError && !carts.data)) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: 'center', paddingTop: insets.top }}>
        <EmptyState icon="map-pin" title={failed || carts.isError ? t('carts.map_error') : t('carts.map_phone_soon')} action={{ label: t('carts.see_list'), onPress: () => router.replace('/food-carts') }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }} testID="carts-map">
      <CartsMap carts={all} selectedId={selectedId} onSelect={setSelectedId} topInset={insets.top + TOP_BAR} bottomInset={CARD_H + insets.bottom + 24} onFail={() => setFailed(true)} />
      <View style={{ position: 'absolute', top: insets.top + theme.space[2], start: theme.space[4], end: theme.space[4], flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <IconButton icon="arrow-back" variant="outline" size={44} accessibilityLabel={t('action.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/food-carts'))} testID="header-back" />
        <View style={{ flex: 1, minHeight: 48, borderRadius: 24, paddingHorizontal: theme.space[4], justifyContent: 'center', backgroundColor: withAlpha(theme.colors.surface, 0.96) }}>
          <Text variant="title" face="display" numberOfLines={1} accessibilityRole="header">
            {t('carts.map_title', { n: carts.data?.open.length ?? 0 })}
          </Text>
        </View>
      </View>
      {chosen ? (
        <View style={{ position: 'absolute', start: theme.space[4], end: theme.space[4], bottom: insets.bottom + theme.space[4], borderRadius: theme.radius.xl, padding: theme.space[3], backgroundColor: theme.colors.surface, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], ...theme.elevation[3] }} testID="carts-map-card">
          <CartPhoto card={chosen} size={88} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="title" face="display" numberOfLines={1}>
              {chosen.name}
            </Text>
            <Text variant="footnote" weight={600} color={chosen.open ? pal.text : 'textMuted'} numberOfLines={1} tabular>
              {cartStatus(t, chosen, locale)}
            </Text>
            <Button testID="carts-map-open" size="sm" label={t('carts.open_cart')} onPress={() => router.push({ pathname: '/food-carts/[id]', params: { id: chosen.id } })} style={{ alignSelf: 'flex-start', marginTop: theme.space[1] }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
