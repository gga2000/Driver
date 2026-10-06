import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import type { ThemeColorKey } from '@driver/design-tokens';
import { formatRange } from '@driver/i18n';
import { Button, Card, Icon, initialOf, Skeleton, StatusPill, Text, useTheme, type AvatarTone } from '@driver/ui';
import { DealSticker } from '@/features/food/DealBadge';
import { FoodArt, motifForKitchen } from '@/features/food/FoodArt';
import { SectionHeader } from '@/components/SectionHeader';
import type { RestaurantSummary } from './restaurant-summary';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const CARD_W = 236;
const HERO_H = 104;

/** Generic leading words skipped for the monogram, so "مطعم خالد" reads خ, not م like every other. */
const GENERIC = new Set(['مطعم', 'مطاعم', 'مشويات', 'مأكولات', 'معجنات', 'كافيه', 'الحاج', 'حجي', 'أبو', 'ابو']);

export function monogram(name: string): string {
  const words = name.trim().split(/\s+/);
  const word = words.find((w) => !GENERIC.has(w)) ?? words[0] ?? name;
  return initialOf(word);
}

export const HERO: Record<AvatarTone, { bg: ThemeColorKey; fg: ThemeColorKey }> = {
  accent: { bg: 'accentTint', fg: 'accentText' },
  info: { bg: 'infoTint', fg: 'infoText' },
  success: { bg: 'successTint', fg: 'successText' },
  warning: { bg: 'warningTint', fg: 'warningText' },
};

export function RestaurantCard({ r, showDeal }: { r: RestaurantSummary; showDeal?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const free = r.deliveryFeeIqd !== null && r.deliveryFeeIqd <= 0;
  const fee = r.deliveryFeeIqd === null ? null : free ? t('search.filter_free_delivery') : t('restaurant.delivery_fee', { amount: amountParam(r.deliveryFeeIqd) });
  const time = r.etaMinMinutes !== null && r.etaMaxMinutes !== null ? formatRange(r.etaMinMinutes, r.etaMaxMinutes, locale) : formatRange(r.prepMinMinutes, r.prepMaxMinutes, locale);
  return (
    <Card
      testID={`restaurant-${r.id}`}
      padding={0}
      onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: r.id } })}
      accessibilityLabel={`${r.name}، ${r.cuisine}`}
      style={{ width: CARD_W, overflow: 'hidden' }}
    >
      <View
        style={{
          height: HERO_H,
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[3],
          justifyContent: 'space-between',
          opacity: r.open ? 1 : 0.75,
        }}
      >
        {/* The kitchen's dish (joy S2-13), the same drawing as its menu hero. */}
        <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}>
          <FoodArt motif={motifForKitchen(r.tags)} variant="hero" />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-start', minHeight: 30 }}>
          {r.favourite ? (
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="star" size={16} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
            </View>
          ) : null}
        </View>
        {!r.open ? (
          <StatusPill size="sm" tone="neutral" icon="clock" label={`${t('restaurant.closed')} · ${t('restaurant.opens_at', { time: r.opensAt ?? '' })}`} />
        ) : showDeal && r.deal ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <DealSticker label={r.deal} />
          </View>
        ) : null}
      </View>
      <View style={{ padding: theme.space[3], gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {r.name}
        </Text>
        <Text variant="footnote" color="textMuted" numberOfLines={1}>
          {r.cuisine}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: theme.space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name="star" size={14} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
            <Text variant="caption" weight={600} tabular>
              {r.rating === null ? t('restaurant.rating_new') : r.rating.toFixed(1)}
            </Text>
          </View>
          <Dot />
          <Icon name="clock" size={14} color="textMuted" />
          <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
            {t('home.prep_range', { range: time })}
          </Text>
        </View>
        {fee ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="bike" size={14} color={free ? 'successText' : 'textMuted'} />
            <Text variant="caption" weight={free ? 600 : 400} color={free ? 'successText' : 'textMuted'} numberOfLines={1} tabular>
              {fee}
            </Text>
          </View>
        ) : null}
        <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
          {t('restaurant.min_order', { amount: amountParam(r.minOrderIqd) })}
        </Text>
      </View>
    </Card>
  );
}

function Dot() {
  const theme = useTheme();
  return <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: theme.colors.textMuted }} />;
}

function CardSkeleton() {
  const theme = useTheme();
  return (
    <Card padding={0} style={{ width: CARD_W, overflow: 'hidden' }}>
      <Skeleton height={HERO_H} radius={0} />
      <View style={{ padding: theme.space[3], gap: theme.space[2] }}>
        <Skeleton height={16} width="70%" />
        <Skeleton height={12} width="50%" />
        <Skeleton height={12} width="85%" />
      </View>
    </Card>
  );
}

export interface RestaurantRailProps {
  title: string;
  restaurants: readonly RestaurantSummary[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  showDeal?: boolean;
  /** "شوف الكل" opens the full list (/restaurants) with this filter preset (audit C-02). */
  seeAll?: 'all' | 'open' | 'deals';
  testID?: string;
}

/** Horizontal rail bleeding to the screen edges, with skeleton, empty and error states. */
export function RestaurantRail({ title, restaurants, loading, error, onRetry, showDeal, seeAll = 'all', testID }: RestaurantRailProps) {
  const theme = useTheme();
  const t = useT();
  const gutter = theme.space[5];
  return (
    <View testID={testID} style={{ gap: theme.space[3] }}>
      <SectionHeader
        title={title}
        action={restaurants?.length ? { label: t('action.see_all'), onPress: () => router.push({ pathname: '/restaurants', params: { preset: seeAll } }) } : undefined}
      />
      {loading ? (
        <View accessibilityLabel={t('status.loading')} style={{ flexDirection: 'row', gap: theme.space[3], marginHorizontal: -gutter, paddingHorizontal: gutter, overflow: 'hidden' }}>
          <CardSkeleton />
          <CardSkeleton />
        </View>
      ) : error ? (
        <Card elevation={0} padding={4}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Icon name="x" size={20} color="dangerText" />
            <Text variant="label" style={{ flex: 1 }}>
              {t('home.load_failed')}
            </Text>
            <Button size="sm" variant="secondary" label={t('action.retry')} onPress={onRetry} />
          </View>
        </Card>
      ) : !restaurants?.length ? (
        <Card elevation={0} tone="sunken" padding={4}>
          <Text variant="label" color="textMuted" align="center">
            {t('home.rail_empty')}
          </Text>
        </Card>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -gutter }}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingVertical: theme.space[2], gap: theme.space[3] }}
        >
          {restaurants.map((r) => (
            <RestaurantCard key={r.id} r={r} showDeal={showDeal} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
