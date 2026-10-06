import { Pressable, View } from 'react-native';
import type { CatalogSearchDish } from '@driver/contracts';
import { Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';

/** One dish in search results: its drawing (or photo), name, kitchen, price, and closed / sold-out marks. */
export function DishResult({ d, divider, onPress }: { d: CatalogSearchDish; divider: boolean; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const muted = !d.restaurantOpen || !d.available;
  const price = iqd(d.priceIqd, { locale });
  const closedLabel = d.restaurantOpensAt ? t('list.closed_opens_at', { time: d.restaurantOpensAt }) : t('list.closed');
  return (
    <Pressable
      testID={`search-dish-${d.id}`}
      accessibilityRole="button"
      accessibilityLabel={[d.name, t('search.dish_at', { restaurant: d.restaurantName }), price, !d.restaurantOpen ? closedLabel : !d.available ? t('search.sold_out') : null].filter(Boolean).join('، ')}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingVertical: theme.space[3],
        paddingHorizontal: theme.space[4],
        backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: theme.colors.border,
      })}
    >
      <View style={{ width: 64, height: 64, borderRadius: theme.radius.md, overflow: 'hidden', opacity: muted ? 0.55 : 1 }}>
        <FoodArt {...artOf(d)} photoUrl={d.photoUrl} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {d.name}
        </Text>
        <Text variant="footnote" color="textMuted" numberOfLines={1}>
          {t('search.dish_at', { restaurant: d.restaurantName })}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[2], marginTop: 2 }}>
          <Text variant="label" weight={600} tabular color={muted ? 'textMuted' : 'text'}>
            {price}
          </Text>
          {!d.restaurantOpen ? (
            <StatusPill size="sm" tone="neutral" icon="clock" label={closedLabel} />
          ) : !d.available ? (
            <StatusPill size="sm" tone="neutral" label={t('search.sold_out')} />
          ) : null}
        </View>
      </View>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}
