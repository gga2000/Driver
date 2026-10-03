import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import type { ThemeColorKey } from '@driver/design-tokens';
import { Button, Card, Icon, initialOf, Skeleton, StatusPill, Text, toneFor, useTheme, type AvatarTone } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import type { RestaurantSummary } from '@/fixtures/restaurants';
import { useT } from '@/lib/i18n';
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

/** "20–30" kept left-to-right inside Arabic text (otherwise the bidi algorithm shows 30–20). */
function range(min: number, max: number): string {
  return `\u2066${min}–${max}\u2069`;
}

const HERO: Record<AvatarTone, { bg: ThemeColorKey; fg: ThemeColorKey }> = {
  accent: { bg: 'accentTint', fg: 'accentText' },
  info: { bg: 'infoTint', fg: 'infoText' },
  success: { bg: 'successTint', fg: 'successText' },
  warning: { bg: 'warningTint', fg: 'warningText' },
};

export function RestaurantCard({ r, showDeal }: { r: RestaurantSummary; showDeal?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const tone = HERO[toneFor(r.name)];
  const fee = r.deliveryFeeIqd <= 0 ? t('search.filter_free_delivery') : t('restaurant.delivery_from', { amount: amountParam(r.deliveryFeeIqd) });
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
          backgroundColor: theme.colors[tone.bg],
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[3],
          justifyContent: 'space-between',
          opacity: r.open ? 1 : 0.75,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Text weight={700} color={tone.fg} style={{ fontSize: 44, lineHeight: 58 }}>
            {monogram(r.name)}
          </Text>
          {r.favourite ? (
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="star" size={16} color="accent" filled />
            </View>
          ) : null}
        </View>
        {!r.open ? (
          <StatusPill size="sm" tone="neutral" icon="clock" label={`${t('restaurant.closed')} · ${t('restaurant.opens_at', { time: r.opensAt ?? '' })}`} />
        ) : showDeal && r.deal ? (
          <StatusPill size="sm" tone="success" icon="gift" label={r.deal} style={{ backgroundColor: theme.colors.surface }} />
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
            <Icon name="star" size={14} color="accent" filled />
            <Text variant="caption" weight={600} tabular>
              {r.rating.toFixed(1)}
            </Text>
          </View>
          <Dot />
          <Icon name="clock" size={14} color="textMuted" />
          <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
            {t('home.prep_range', { range: range(r.prepMinMinutes, r.prepMaxMinutes) })}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="bike" size={14} color={r.deliveryFeeIqd <= 0 ? 'successText' : 'textMuted'} />
          <Text variant="caption" weight={r.deliveryFeeIqd <= 0 ? 600 : 400} color={r.deliveryFeeIqd <= 0 ? 'successText' : 'textMuted'} numberOfLines={1} tabular>
            {fee}
          </Text>
        </View>
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
  testID?: string;
}

/** Horizontal rail bleeding to the screen edges, with skeleton, empty and error states. */
export function RestaurantRail({ title, restaurants, loading, error, onRetry, showDeal, testID }: RestaurantRailProps) {
  const theme = useTheme();
  const t = useT();
  const gutter = theme.space[5];
  return (
    <View testID={testID} style={{ gap: theme.space[3] }}>
      <SectionHeader title={title} action={restaurants?.length ? { label: t('action.see_all'), onPress: () => {} } : undefined} />
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
