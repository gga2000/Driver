import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, Icon, Skeleton, StatusPill, Text, useTheme } from '@driver/ui';
import { formatRange } from '@driver/i18n';
import { DealSticker } from '@/features/food/DealBadge';
import { FoodArt, motifForKitchen } from '@/features/food/FoodArt';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const ART = 76;

/**
 * One kitchen in a vertical list (home, all restaurants, search results): the kitchen's dish, name, cuisine, rating,
 * door time and delivery fee. A closed kitchen stays tappable, muted, with when it opens: its menu can
 * be browsed (audit C-02).
 */
export function RestaurantRow({ r, testID, onOpen }: { r: RestaurantSummary; testID?: string; onOpen?: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const free = r.deliveryFeeIqd !== null && r.deliveryFeeIqd <= 0;
  const time = r.etaMinMinutes !== null && r.etaMaxMinutes !== null ? formatRange(r.etaMinMinutes, r.etaMaxMinutes, locale) : formatRange(r.prepMinMinutes, r.prepMaxMinutes, locale);
  const closedLabel = r.opensAt ? t('list.closed_opens_at', { time: r.opensAt }) : t('list.closed');
  return (
    <Card
      testID={testID ?? `restaurant-row-${r.id}`}
      padding={3}
      onPress={() => {
        onOpen?.();
        router.push({ pathname: '/restaurant/[id]', params: { id: r.id } });
      }}
      accessibilityLabel={[r.name, r.cuisine, r.open ? null : closedLabel].filter(Boolean).join('، ')}
    >
      <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
        {/* The kitchen's dish, the same drawing as its menu hero (joy S2-13): food, not a letter. */}
        <View testID={`${testID ?? `restaurant-row-${r.id}`}-art`} style={{ width: ART, height: ART, borderRadius: theme.radius.lg, overflow: 'hidden', opacity: r.open ? 1 : 0.6 }}>
          <FoodArt motif={motifForKitchen(r.tags)} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {r.name}
            </Text>
            {r.open && r.dealCount > 0 ? <DealSticker label={t('list.deal')} /> : null}
          </View>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {r.cuisine}
          </Text>
          {r.open ? (
            // D-12: two fixed lines, never a wrap that leaves a dot at a line end — rating · time, then the fee.
            <View style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Icon name="star" size={14} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
                  <Text variant="caption" weight={600} tabular>
                    {r.rating === null ? t('list.new') : r.rating.toFixed(1)}
                  </Text>
                </View>
                <Dot />
                <Text variant="caption" color="textMuted" tabular numberOfLines={1} style={{ flexShrink: 1 }}>
                  {t('list.minutes', { range: time })}
                </Text>
              </View>
              {r.deliveryFeeIqd !== null ? (
                <Text variant="caption" weight={free ? 600 : 400} color={free ? 'successText' : 'textMuted'} tabular numberOfLines={1}>
                  {free ? t('list.fee_free') : t('list.fee', { amount: amountParam(r.deliveryFeeIqd) })}
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={{ alignItems: 'flex-start', gap: 2, marginTop: 2 }}>
              <StatusPill size="sm" tone="neutral" icon="clock" label={closedLabel} />
            </View>
          )}
        </View>
        <Icon name="chevron-forward" size={18} color="textMuted" />
      </View>
    </Card>
  );
}

function Dot() {
  const theme = useTheme();
  return <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: theme.colors.textMuted }} />;
}

export function RestaurantRowSkeleton() {
  const theme = useTheme();
  return (
    <Card padding={3} elevation={0}>
      <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
        <Skeleton width={ART} height={ART} radius={theme.radius.lg} />
        <View style={{ flex: 1, gap: theme.space[2] }}>
          <Skeleton height={16} width="55%" />
          <Skeleton height={12} width="40%" />
          <Skeleton height={12} width="70%" />
        </View>
      </View>
    </Card>
  );
}
