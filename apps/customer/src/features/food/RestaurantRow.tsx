import { router } from 'expo-router';
import type { ReactNode } from 'react';
import type { CatalogSearchDish } from '@driver/contracts';
import { View } from 'react-native';
import { Card, Icon, Skeleton, StatusPill, stageOf, Text, useTheme } from '@driver/ui';
import { formatRange } from '@driver/i18n';
import { DealSticker } from '@/features/food/DealBadge';
import { FoodArt, kitchenLook, motifForDish, motifForKitchen } from '@/features/food/FoodArt';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { Shutter } from '@/features/doors/Shutter';

const ART = 84;

/**
 * One kitchen in a vertical list (home, all restaurants, search results), Date & Saffron: a white
 * card on a warm lift, the kitchen's dish on its own coloured plate, the name and cuisine, then small
 * chips — the rating with a saffron star, the door time, the delivery fee (free delivery is a saffron
 * chip, never green: J-D1). A closed kitchen stays tappable, muted, with when it opens: its menu can
 * be browsed (audit C-02), behind a rolled-down shutter (food doors p1). `reason` is the one true line
 * that put it in «أحسن 3» (food doors r3/k3), in the accent over the cuisine. With a `dish` (a craving's
 * «أحسن 3 للكنافة»), the row is about that dish: its drawing, its name and price (per kilo when sold by
 * weight) in place of the cuisine line, and a tap opens it on the menu. `cold` says the door time the
 * way the cold drinks door does: «توصل باردة» (j3).
 */
export function RestaurantRow({
  r,
  testID,
  onOpen,
  reason,
  dish,
  cold,
}: {
  r: RestaurantSummary;
  testID?: string;
  onOpen?: () => void;
  reason?: string;
  dish?: CatalogSearchDish;
  cold?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const free = r.deliveryFeeIqd !== null && r.deliveryFeeIqd <= 0;
  const time = r.etaMinMinutes !== null && r.etaMaxMinutes !== null ? formatRange(r.etaMinMinutes, r.etaMaxMinutes, locale) : formatRange(r.prepMinMinutes, r.prepMaxMinutes, locale);
  const closedLabel = r.opensAt ? t('list.closed_opens_at', { time: r.opensAt }) : t('list.closed');
  const dishLine = dish
    ? dish.kiloIqd
      ? t('food.dish_kilo', { dish: dish.name, amount: amountParam(dish.kiloIqd) })
      : t('food.dish_price', { dish: dish.name, amount: amountParam(dish.priceIqd) })
    : null;
  return (
    <Card
      testID={testID ?? `restaurant-row-${r.id}`}
      padding={3}
      lift
      onPress={() => {
        onOpen?.();
        router.push({ pathname: '/restaurant/[id]', params: dish ? { id: r.id, item: dish.id } : { id: r.id } });
      }}
      accessibilityLabel={[r.name, reason, dishLine ?? r.cuisine, r.open ? null : closedLabel].filter(Boolean).join('، ')}
    >
      <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
        {/* The kitchen's dish, the same drawing as its menu hero (joy S2-13): food, not a letter. */}
        <View testID={`${testID ?? `restaurant-row-${r.id}`}-art`} style={{ width: ART, height: ART, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
          <FoodArt motif={dish ? motifForDish(dish.name) : motifForKitchen(r.tags, r.cuisine)} look={kitchenLook(r.id)} stage={stageOf(r.id, theme.decor.stages)} photoUrl={dish?.photoUrl ?? null} />
          {r.open ? null : <Shutter size={ART} />}
        </View>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="bodyStrong" weight={700} numberOfLines={1} style={{ flexShrink: 1 }}>
              {r.name}
            </Text>
            {r.open && r.dealCount > 0 ? <DealSticker label={t('list.deal')} /> : null}
          </View>
          {reason ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID={`${testID ?? `restaurant-row-${r.id}`}-reason`}>
              <Icon name="check" size={13} color="accentText" strokeWidth={2.4} />
              <Text variant="caption" weight={700} color="accentText" numberOfLines={1} style={{ flexShrink: 1 }}>
                {reason}
              </Text>
            </View>
          ) : null}
          {dishLine ? (
            <Text variant="footnote" weight={600} numberOfLines={1} tabular testID={`${testID ?? `restaurant-row-${r.id}`}-dish`}>
              {dishLine}
            </Text>
          ) : (
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {r.cuisine}
            </Text>
          )}
          {r.open ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[1], marginTop: 2 }}>
              <Chip>
                <Icon name="star" size={12} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
                <Text variant="caption" weight={600} tabular compact>
                  {r.rating === null ? t('list.new') : r.rating.toFixed(1)}
                </Text>
              </Chip>
              <Chip>
                <Text variant="caption" weight={600} tabular numberOfLines={1} compact>
                  {cold ? t('food.cold_minutes', { range: time }) : t('list.minutes', { range: time })}
                </Text>
              </Chip>
              {r.deliveryFeeIqd !== null ? (
                <Chip deal={free}>
                  <Text variant="caption" weight={600} color={free ? 'onDeal' : 'text'} tabular numberOfLines={1} compact>
                    {free ? t('list.fee_free') : t('list.fee', { amount: amountParam(r.deliveryFeeIqd) })}
                  </Text>
                </Chip>
              ) : null}
            </View>
          ) : (
            <View style={{ alignItems: 'flex-start', gap: 2, marginTop: 2 }}>
              <StatusPill size="sm" tone="neutral" icon="clock" label={closedLabel} />
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

/** A small rounded fact under the name: sunken by default, saffron for free delivery. */
function Chip({ children, deal }: { children: ReactNode; deal?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        minHeight: 24,
        paddingHorizontal: theme.space[2],
        borderRadius: theme.radius.pill,
        backgroundColor: deal ? theme.colors.deal : theme.colors.surfaceSunken,
      }}
    >
      {children}
    </View>
  );
}

export function RestaurantRowSkeleton() {
  const theme = useTheme();
  return (
    <Card padding={3} lift>
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
