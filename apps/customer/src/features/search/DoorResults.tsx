import { router } from 'expo-router';
import { View } from 'react-native';
import { sellsIceCream, type FoodDoor } from '@driver/contracts';
import { Icon, Text, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { BestThree } from '@/features/doors/BestThree';
import { bestThree, doorShops } from '@/features/doors/doors';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useT } from '@/lib/i18n';

/** The shops a door word shows: the door's open shops, only the ones selling ice cream for «آيس كريم». */
export function doorResultShops(
  all: readonly RestaurantSummary[],
  door: FoodDoor,
  iceCream: boolean,
) {
  const s = doorShops(all, door);
  const keep = (r: RestaurantSummary) => !iceCream || sellsIceCream(r.tags);
  return { open: s.open.filter(keep), closed: s.closed.filter(keep) };
}

/**
 * A door word answered (food doors f1, bug b1): «حلويات» used to find nothing and offer kebab. Now the
 * door's best open shops come up with their reasons, and «شوف الكل» opens the door. Nothing open → one
 * line with when the first opens, and the door still opens.
 */
export function DoorResults({
  door,
  iceCream,
  all,
  onOpen,
}: {
  door: FoodDoor;
  iceCream: boolean;
  all: readonly RestaurantSummary[];
  onOpen: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const shops = doorResultShops(all, door, iceCream);
  const picks = bestThree(shops.open);
  const see = {
    label: t('search.door_see_all'),
    onPress: () => router.push({ pathname: '/food/[door]', params: { door } }),
  };
  if (picks.length > 0) {
    return (
      <View testID={`search-door-${door}`}>
        <BestThree
          picks={picks}
          title={t(`food.door.${door}`)}
          action={see}
          onOpen={onOpen}
          testID={`search-door-${door}-best`}
        />
      </View>
    );
  }
  const first = shops.closed[0];
  return (
    <View style={{ gap: theme.space[2] }} testID={`search-door-${door}`}>
      <SectionHeader big title={t(`food.door.${door}`)} action={see} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          padding: theme.space[3],
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.surfaceSunken,
        }}
      >
        <Icon name="clock" size={18} color="textMuted" />
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {first?.opensAt
            ? `${t('search.door_none')}. ${t('search.door_opens', { time: first.opensAt })}`
            : t('search.door_none')}
        </Text>
      </View>
    </View>
  );
}
