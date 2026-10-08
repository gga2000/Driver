import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import type { ShopPick } from '@/features/doors/doors';
import { doorMinutes } from '@/features/doors/doors';
import { motifForKitchen } from '@/features/food/food-art';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useT } from '@/lib/i18n';
import { ALL_STRIP, distinctPhotos, photoForMotif } from './photos';

/**
 * «فاتحين هسة» (Ali 2026-10-08): the open kitchens as photo cards, each with one honest reason it is
 * here («الأسرع لبابك», «أعلى تقييم هنا»: `bestThree`, never paid), its door time and rating.
 */
export function KitchenCards({ picks }: { picks: readonly ShopPick[] }) {
  const theme = useTheme();
  const t = useT();
  if (picks.length === 0) return null;
  const photos = distinctPhotos(picks.map((p) => motifForKitchen(p.shop.tags, p.shop.cuisine)));
  return (
    <View testID="food-kitchens" style={{ gap: theme.space[3] }}>
      <Text variant="title" weight={700} accessibilityRole="header">
        {t('food.landing.open_kitchens')}
      </Text>
      {picks.map((p, i) => (
        <KitchenCard key={p.shop.id} pick={p} photo={photos[i] ?? photoForMotif('plate')} />
      ))}
    </View>
  );
}

function KitchenCard({ pick: { shop, reason }, photo }: { pick: ShopPick; photo: number }) {
  const theme = useTheme();
  const t = useT();
  const why = reason === 'score' ? t('food.reason.score', { rating: shop.rating?.toFixed(1) ?? '' }) : t(`food.reason.${reason}`);
  const minutes = doorMinutes(shop);
  return (
    <Pressable
      testID={`food-kitchen-${shop.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${shop.name}، ${why}، ${t('food.minutes', { n: minutes })}`}
      onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: shop.id } })}
      style={({ pressed }) => ({
        borderRadius: theme.radius.xl,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View style={{ height: 136 }}>
        <Image source={photo} resizeMode="cover" accessible={false} style={{ width: '100%', height: '100%' }} />
        <Pill style={{ top: theme.space[3], start: theme.space[3] }} dark>
          {why}
        </Pill>
        <Pill style={{ bottom: theme.space[3], end: theme.space[3] }}>{t('food.minutes', { n: minutes })}</Pill>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3] }}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" weight={700} numberOfLines={1}>
            {shop.name}
          </Text>
          {shop.cuisine ? (
            <Text variant="label" color="textMuted" numberOfLines={1}>
              {shop.cuisine}
            </Text>
          ) : null}
        </View>
        {shop.rating != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name="star" size={14} color="star" />
            <Text variant="label" weight={700} color="accentText" tabular>
              {shop.rating.toFixed(1)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function Pill({ children, style, dark = false }: { children: string; style: object; dark?: boolean }) {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      style={[
        { position: 'absolute', paddingHorizontal: theme.space[3], paddingVertical: 4, borderRadius: theme.radius.pill, backgroundColor: dark ? withAlpha(theme.colors.inverse, 0.8) : withAlpha(theme.colors.surface, 0.95) },
        style,
      ]}
    >
      <Text variant="caption" weight={700} color={dark ? 'onInverseAccent' : 'text'} tabular numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

/** The way to everything: a strip of real dishes under a dark veil, «شوف كل المحلات». */
export function AllShops() {
  const theme = useTheme();
  const t = useT();
  const ink = theme.colors.inverse;
  return (
    <Pressable
      testID="food-all"
      accessibilityRole="button"
      accessibilityLabel={t('food.landing.all')}
      onPress={() => router.push('/restaurants')}
      style={({ pressed }) => ({ height: 112, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: ink, transform: [{ scale: pressed ? 0.985 : 1 }] })}
    >
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
        {ALL_STRIP.map((src, i) => (
          <Image key={i} source={src} resizeMode="cover" accessible={false} style={{ flex: 1, height: '100%' }} />
        ))}
      </View>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            {/* Darkest under the words (the reading start), so the gold line stays readable. */}
            <LinearGradient id="all-veil" x1="1" y1="0" x2="0" y2="0">
              <Stop offset="0" stopColor={ink} stopOpacity={0.95} />
              <Stop offset="0.55" stopColor={ink} stopOpacity={0.82} />
              <Stop offset="1" stopColor={ink} stopOpacity={0.45} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#all-veil)" />
        </Svg>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[5] }}>
        <View style={{ flex: 1 }}>
          <Text weight={700} color="onInverse" style={{ fontSize: 19, lineHeight: 28 }}>
            {t('food.landing.all')}
          </Text>
          <Text variant="label" weight={500} color="onInverseAccent" numberOfLines={1}>
            {t('food.landing.all_sub')}
          </Text>
        </View>
        <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent }}>
          <Icon name="arrow-forward" size={22} color="onAccent" />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The street asleep (A2): the first kitchen to open, so tonight's hunger becomes tomorrow's order.
 * Its menu takes the order for a time slot (`slots.ts`, joy o11); this card only opens it.
 */
export function AheadCard({ shop }: { shop: RestaurantSummary }) {
  const theme = useTheme();
  const t = useT();
  const ink = theme.colors.inverse;
  return (
    <View testID="food-ahead" style={{ height: 300, borderRadius: theme.radius['2xl'], overflow: 'hidden', backgroundColor: ink }}>
      <Image source={photoForMotif(motifForKitchen(shop.tags, shop.cuisine))} resizeMode="cover" accessible={false} style={{ position: 'absolute', top: 0, start: 0, width: '100%', height: '100%' }} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="ahead-veil" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ink} stopOpacity={0.2} />
              <Stop offset="0.85" stopColor={ink} stopOpacity={0.94} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#ahead-veil)" />
        </Svg>
      </View>
      <View style={{ position: 'absolute', bottom: theme.space[4], start: theme.space[4], end: theme.space[4], gap: theme.space[1] }}>
        <Text weight={700} color="onInverse" accessibilityRole="header" style={{ fontSize: 26, lineHeight: 36 }}>
          {t('food.landing.ahead_title')}
        </Text>
        <Text variant="body" color={withAlpha(theme.colors.onInverse, 0.84)} tabular>
          {t('food.landing.ahead_body', { shop: shop.name, time: shop.opensAt ?? '' })}
        </Text>
        <Pressable
          testID="food-ahead-cta"
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: shop.id } })}
          style={({ pressed }) => ({ marginTop: theme.space[3], minHeight: 52, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent, transform: [{ scale: pressed ? 0.98 : 1 }] })}
        >
          <Text variant="button" weight={700} color="onAccent">
            {t('food.landing.ahead_cta')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
