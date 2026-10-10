import { View, type LayoutChangeEvent } from 'react-native';
import { Button, Card, Icon, IconButton, stageOf, StatusPill, Text, useTheme } from '@driver/ui';
import { formatRange } from '@driver/i18n';
import { FoodArt, kitchenLook, motifForKitchen } from '@/features/food/FoodArt';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import type { MapShop } from './shops';

const ART = 76;

/**
 * The chosen restaurant's brief on the map (Lantern tour): its photo, name and cuisine, one line of facts
 * (rating, minutes to the door, delivery fee), whether it is open, then «شوف المنيو» as the big button,
 * «الجاي» to fly to the next shop and a small back arrow to the one before, and where it is in the tour.
 */
export function Brief({
  shop,
  index,
  total,
  onMenu,
  onNext,
  onPrev,
  onLayout,
}: {
  shop: MapShop;
  index: number;
  total: number;
  onMenu: () => void;
  onNext: () => void;
  onPrev: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const r = shop.card;
  const time = r.etaMinMinutes !== null && r.etaMaxMinutes !== null ? formatRange(r.etaMinMinutes, r.etaMaxMinutes, locale) : formatRange(r.prepMinMinutes, r.prepMaxMinutes, locale);
  const free = r.deliveryFeeIqd !== null && r.deliveryFeeIqd <= 0;
  const facts = [
    r.rating === null ? t('list.new') : r.rating.avg.toFixed(1),
    t('list.minutes', { range: time }),
    r.deliveryFeeIqd === null ? null : free ? t('list.fee_free') : t('list.fee', { amount: amountParam(r.deliveryFeeIqd) }),
  ].filter(Boolean);
  const closed = r.opensAt ? t('list.closed_opens_at', { time: r.opensAt }) : t('list.closed');
  return (
    <View onLayout={onLayout}>
    <Card padding={4} lift testID="restaurant-brief">
      <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
        <View style={{ width: ART, height: ART, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
          <FoodArt motif={motifForKitchen(r.tags, r.cuisine)} look={kitchenLook(r.id)} stage={stageOf(r.id, theme.decor.stages)} photoUrl={r.photoUrl} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="title" weight={700} numberOfLines={1}>
            {r.name}
          </Text>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {r.cuisine}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <Icon name="star" size={13} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
            <Text variant="caption" weight={600} tabular numberOfLines={1} style={{ flexShrink: 1 }}>
              {facts.join(' · ')}
            </Text>
          </View>
          {r.open ? null : (
            <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
              <StatusPill size="sm" tone="neutral" icon="clock" label={closed} />
            </View>
          )}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: theme.space[4] }}>
        <IconButton icon="chevron-back" variant="outline" size={44} accessibilityLabel={t('restaurant_map.prev')} onPress={onPrev} testID="restaurant-brief-prev" />
        <Button label={t('restaurant_map.menu')} icon="food" onPress={onMenu} style={{ flex: 1 }} testID="restaurant-brief-menu" />
        <Button label={t('restaurant_map.next')} variant="ink" onPress={onNext} trailing={<Icon name="chevron-forward" size={18} color="surface" strokeWidth={2.4} />} testID="restaurant-brief-next" />
      </View>
      <Text variant="caption" color="textMuted" tabular style={{ textAlign: 'center', marginTop: theme.space[2] }}>
        {t('restaurant_map.count', { n: index + 1, total })}
      </Text>
    </Card>
    </View>
  );
}
