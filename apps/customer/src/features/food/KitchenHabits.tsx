import { View } from 'react-native';
import type { MenuItem, MenuPot, MenuStory } from '@driver/contracts';
import { formatClock } from '@driver/i18n';
import { Button, Card, Icon, Text, useTheme } from '@driver/ui';
import { potUntilAt } from '@/features/home/habits';
import { useDishFollows } from '@/features/home/habit-queries';
import { appNow } from '@/lib/dev-clock';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { FollowBell } from './FollowBell';
import { FoodArt, artOf, type DishArt } from './FoodArt';

const ART = 64;

/**
 * «قدر اليوم» on the restaurant page (joy h2): the kitchen's dish of the day above the menu, with its
 * note and «لحد» time, «شوفها» to open it, and the bell to be told the next time they cook it.
 */
export function PotBanner({ pot, item, art, restaurant, merchantOrgId, onOpen }: { pot: MenuPot; item: MenuItem; art: DishArt | undefined; restaurant: string; merchantOrgId: string; onOpen: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const follows = useDishFollows();
  const followed = Boolean(follows.data?.itemIds.includes(item.id));
  const until = pot.until ? t('pots.until', { time: formatClock(potUntilAt(pot.until, appNow())) }) : null;
  const price = iqd(item.priceIqd, { locale });
  return (
    <Card elevation={1} padding={3} style={{ marginTop: theme.space[4] }} testID="restaurant-pot">
      <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
        <View style={{ width: ART, height: ART, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
          <FoodArt {...(art ?? artOf(item))} photoUrl={item.photoUrl} />
        </View>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text variant="caption" weight={600} color="accentText">
            {t('pots.badge')}
          </Text>
          <Text variant="bodyStrong" numberOfLines={2}>
            {item.name}
          </Text>
          <Text variant="footnote" weight={600} tabular numberOfLines={1}>
            {until ? `${price} · ${until}` : price}
          </Text>
        </View>
        <FollowBell merchantOrgId={merchantOrgId} itemId={item.id} dish={item.name} restaurant={restaurant} followed={followed} testID="restaurant-pot-follow" />
      </View>
      {pot.note ? (
        <Text variant="footnote" color="textMuted" style={{ marginTop: theme.space[2] }}>
          {pot.note}
        </Text>
      ) : null}
      <View style={{ marginTop: theme.space[3] }}>
        <Button size="sm" variant="secondary" label={t('restaurant.pot_open')} onPress={onOpen} testID="restaurant-pot-open" />
      </View>
    </Card>
  );
}

/**
 * «مطاعمنا» (joy h5): the owner's own lines and the year the kitchen opened — only when he chose to
 * show them (the server sends nothing otherwise) — and «معروف بـ» from the kitchen's real most-ordered
 * dish (≥ 20 orders in 30 days), never a made-up claim.
 */
export function KitchenStory({ story, knownFor }: { story: MenuStory; knownFor: string | null }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card elevation={0} tone="sunken" padding={4} style={{ marginTop: theme.space[3] }} testID="restaurant-story">
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="food" size={18} color="accentText" />
          <Text variant="label" weight={600} color="accentText" style={{ flex: 1 }} accessibilityRole="header">
            {t('story.title')}
          </Text>
          {story.sinceYear !== null ? (
            <Text variant="caption" weight={600} color="textMuted" tabular testID="restaurant-story-since">
              {t('story.since', { year: String(story.sinceYear) })}
            </Text>
          ) : null}
        </View>
        <Text variant="body">{story.text}</Text>
        {knownFor ? (
          <Text variant="footnote" color="textMuted" testID="restaurant-story-known">
            {t('story.known_for', { dish: knownFor })}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
