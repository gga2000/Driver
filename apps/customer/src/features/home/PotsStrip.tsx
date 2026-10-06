import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { TodayPot } from '@driver/contracts';
import { formatClock } from '@driver/i18n';
import { Button, Card, Icon, Skeleton, StaleNote, Text, useMotionPresets, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { FollowBell } from '@/features/food/FollowBell';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { usePots } from './habit-queries';
import { potUntilAt, visiblePots } from './habits';

/** A pot card's width: two show on a 390 phone with the next one peeking. */
const CARD_W = 264;
const ART = 72;

/**
 * «العزيزية اليوم» (joy h2, delight E1/E2): what the town's kitchens are cooking today — each open
 * kitchen's «قدر اليوم» with its dish drawing, price and note, and a bell to be told the next time.
 * Nothing to show (no pots, or every pot's kitchen closed) draws nothing; loading is a skeleton row,
 * a failed read with nothing cached a small retry line, offline the last copy with its age.
 */
export function PotsStrip({ now }: { now: Date }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const pots = usePots();
  const shown = visiblePots(pots.data);

  if (pots.isPending) {
    return (
      <View style={{ gap: theme.space[3] }} accessibilityLabel={t('status.loading')} testID="home-pots-loading">
        <Skeleton height={28} width="40%" />
        <Skeleton height={112} radius={theme.radius.xl} />
      </View>
    );
  }
  if (pots.isError && !pots.data) {
    return (
      <Card elevation={0} tone="sunken" padding={3} testID="home-pots-error">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Icon name="x" size={18} color="textMuted" />
          <Text variant="label" color="textMuted" style={{ flex: 1 }}>
            {t('pots.load_failed')}
          </Text>
          <Button size="sm" variant="secondary" label={t('action.retry')} onPress={() => void pots.refetch()} />
        </View>
      </Card>
    );
  }
  if (shown.length === 0) return null;
  return (
    <View testID="home-pots" style={{ gap: theme.space[3] }}>
      <SectionHeader voice title={t('pots.title')} />
      <StaleNote updatedAt={pots.dataUpdatedAt} locale={locale} testID="home-pots-stale" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[3], paddingEnd: theme.space[1] }} style={{ marginHorizontal: -theme.space[1] }}>
        {shown.map((p, i) => (
          <PotCard key={p.merchantOrgId} pot={p} now={now} index={i} />
        ))}
      </ScrollView>
    </View>
  );
}

function PotCard({ pot, now, index }: { pot: TodayPot; now: Date; index: number }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const presets = useMotionPresets();
  const price = iqd(pot.dish.priceIqd, { locale });
  const until = pot.until ? t('pots.until', { time: formatClock(potUntilAt(pot.until, now)) }) : null;
  return (
    <Animated.View entering={presets.panelIn(presets.staggerDelay(index))} style={{ width: CARD_W }}>
      <Card elevation={1} padding={3} testID={`home-pot-${index}`}>
        <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('pots.card_a11y', { restaurant: pot.restaurantName, dish: pot.dish.name, price })}
            onPress={() => {
              theme.haptic('selection');
              router.push({ pathname: '/restaurant/[id]', params: { id: pot.merchantOrgId, item: pot.dish.id } });
            }}
            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', gap: theme.space[3], opacity: pressed ? 0.85 : 1 })}
          >
            <View style={{ width: ART, height: ART, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
              <FoodArt {...artOf(pot.dish)} photoUrl={pot.dish.photoUrl} />
            </View>
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <Text variant="caption" weight={600} color="accentText" numberOfLines={1}>
                {t('pots.badge')}
              </Text>
              <Text variant="bodyStrong" numberOfLines={1}>
                {pot.dish.name}
              </Text>
              <Text variant="footnote" color="textMuted" numberOfLines={1}>
                {pot.restaurantName}
              </Text>
              <Text variant="footnote" weight={600} tabular numberOfLines={1}>
                {until ? `${price} · ${until}` : price}
              </Text>
            </View>
          </Pressable>
          <FollowBell merchantOrgId={pot.merchantOrgId} itemId={pot.dish.id} dish={pot.dish.name} restaurant={pot.restaurantName} followed={pot.followed} testID={`home-pot-follow-${index}`} />
        </View>
        {pot.note ? (
          <Text variant="footnote" color="textMuted" numberOfLines={1} style={{ marginTop: theme.space[2] }}>
            {pot.note}
          </Text>
        ) : null}
      </Card>
    </Animated.View>
  );
}
