import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { baghdadMonth, type StatsView } from '@driver/contracts';
import { Button, Icon, MeshFill, ModalSheet, StarPattern, Text, useCountUp, useMotionPresets, useTheme, withAlpha } from '@driver/ui';
import { dishPhoto } from '@/features/home/dish-photos';
import { FoodPhoto } from '@/features/food-landing/FoodPhoto';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { comebackDish, savedLabel, savedParts } from './format';
import { MonthColumns, useStackColours } from './MonthColumns';

/**
 * «دفترك»: what came off his bills (the saffron hero, with what we paid back on its own line), the
 * month columns per service, and three tiles: the meals with the dish he keeps coming back to, the
 * rides in town, and الرجعة trips.
 */
export function LedgerTab({ v }: { v: StatsView }) {
  const theme = useTheme();
  const presets = useMotionPresets();
  return (
    <View style={{ gap: theme.space[4] }}>
      <Animated.View entering={presets.panelIn(0)}>
        <SavedHero v={v} />
      </Animated.View>
      {v.months.length > 1 ? (
        <Animated.View entering={presets.panelIn(60)}>
          <MonthColumns months={v.months} />
        </Animated.View>
      ) : null}
      <Animated.View entering={presets.panelIn(120)}>
        <Tiles v={v} />
      </Animated.View>
    </View>
  );
}

function SavedHero({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  const food = theme.services.food;
  const [how, setHow] = useState(false);
  // Counts up once from 0 when the figure arrives (reduced motion: shown at once).
  const [target, setTarget] = useState(0);
  useEffect(() => setTarget(v.saved.totalIqd), [v.saved.totalIqd]);
  const shown = useCountUp(target);
  const label = savedLabel(v.period, v.month, baghdadMonth(new Date()));
  const labelText = t(label.key, label.monthKey ? { month: t(label.monthKey) } : {});
  const parts = savedParts(v.saved);
  const chipBg = withAlpha(theme.colors.surface, 0.72);

  return (
    <View testID="stats-saved" style={{ borderRadius: theme.radius.tile, overflow: 'hidden' }}>
      <MeshFill base={food.fill} mesh={food.mesh} />
      <View style={{ padding: theme.space[5], gap: theme.space[1] }}>
        <View accessible accessibilityLabel={t('stats.saved_a11y', { label: labelText, amount: amountParam(v.saved.totalIqd) })}>
          <Text variant="label" weight={600} color={food.on}>
            {labelText}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
            <Text variant="numeralMd" face="display" tabular color={food.on} testID="stats-saved-amount">
              {amountParam(shown)}
            </Text>
            <Text variant="title" weight={700} color={food.on}>
              {t('stats.dinar')}
            </Text>
          </View>
        </View>
        {parts.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], marginTop: theme.space[1] }}>
            {parts.map((p) => (
              <View key={p.key} style={{ backgroundColor: chipBg, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], paddingVertical: 2 }}>
                <Text variant="caption" weight={600} tabular color={food.on}>
                  {t(p.key, { amount: amountParam(p.amount) })}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text variant="footnote" color={food.on}>
            {t('stats.saved_zero')}
          </Text>
        )}
        {v.saved.madeGoodIqd > 0 ? (
          <Text variant="footnote" weight={600} tabular color={food.on} style={{ marginTop: theme.space[1] }} testID="stats-made-good">
            {t('stats.made_good', { amount: amountParam(v.saved.madeGoodIqd) })}
          </Text>
        ) : null}
        <Pressable
          testID="stats-how"
          accessibilityRole="button"
          onPress={() => setHow(true)}
          hitSlop={12}
          style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, marginTop: theme.space[1] }}
        >
          <Icon name="receipt" size={16} color={food.on} />
          <Text variant="footnote" weight={700} color={food.on} style={{ textDecorationLine: 'underline' }}>
            {t('stats.how')}
          </Text>
        </Pressable>
      </View>
      <HowWeCount visible={how} onClose={() => setHow(false)} />
    </View>
  );
}

/** «شلون نحسبها؟»: what «وفّرت» counts and what it never does, in five plain lines. */
function HowWeCount({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const lines = [
    { icon: 'gift', key: 'stats.how_deals' },
    { icon: 'star', key: 'stats.how_points' },
    { icon: 'rajaa', key: 'stats.how_return' },
    { icon: 'wallet', key: 'stats.how_change' },
    { icon: 'clock', key: 'stats.how_made_good' },
  ] as const;
  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('stats.how_title')} footer={<Button label={t('stats.how_ok')} onPress={onClose} />}>
      <View style={{ gap: theme.space[3], paddingBottom: theme.space[2] }}>
        {lines.map((l) => (
          <View key={l.key} style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
            <Icon name={l.icon} size={20} color="accentText" />
            <Text variant="body" style={{ flex: 1 }}>
              {t(l.key)}
            </Text>
          </View>
        ))}
      </View>
    </ModalSheet>
  );
}

function Tiles({ v }: { v: StatsView }) {
  const theme = useTheme();
  const rides = v.rides.taxi + v.rides.tuktuk;
  const seats = v.rajaa.baghdad + v.rajaa.kut;
  const side = [rides > 0 ? <RidesTile key="rides" v={v} /> : null, seats > 0 ? <RajaaTile key="rajaa" n={seats} /> : null].filter((x) => x !== null);
  if (v.food.orders === 0 && side.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'stretch' }}>
      {v.food.orders > 0 ? (
        <View style={{ flex: side.length ? 1.25 : 1 }}>
          <FoodTile v={v} />
        </View>
      ) : null}
      {side.length ? <View style={{ flex: 1, gap: theme.space[3], flexDirection: v.food.orders > 0 ? 'column' : 'row' }}>{side}</View> : null}
    </View>
  );
}

/** A coloured bento tile; tiles share the height of their column. */
function Tile({ bg, children, testID }: { bg: string; children: ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ backgroundColor: bg, borderRadius: theme.radius.xl, overflow: 'hidden', flexGrow: 1 }}>
      {children}
    </View>
  );
}

function FoodTile({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  const card = theme.services.food.card;
  const dish = comebackDish(v.food.topDishes);
  const photo = dish ? dishPhoto(dish.name) : null;
  return (
    <Tile bg={card.bg} testID="stats-tile-food">
      {photo ? (
        <View style={{ width: '100%', aspectRatio: 1.2, overflow: 'hidden' }}>
          <FoodPhoto photo={photo} style={{ width: '100%', height: '100%' }} />
        </View>
      ) : null}
      <View style={{ padding: theme.space[3], gap: 2, flex: 1, justifyContent: 'flex-end' }}>
        {dish ? (
          <>
            <Text variant="caption" color={card.sub}>
              {t('stats.dish_back', { times: t('month.times', { n: dish.orders }) })}
            </Text>
            <Text variant="bodyStrong" color={card.on} numberOfLines={2}>
              {dish.name}
            </Text>
            {dish.kitchen ? (
              <Text variant="caption" color={card.sub} numberOfLines={1}>
                {t('stats.dish_from', { kitchen: dish.kitchen })}
              </Text>
            ) : null}
          </>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[1], marginTop: theme.space[1] }}>
          <Text variant="amount" face="display" tabular color={card.on}>
            {v.food.orders}
          </Text>
          <Text variant="footnote" weight={600} color={card.on}>
            {t('stats.meals_caption', { n: v.food.orders })}
          </Text>
        </View>
        <Text variant="caption" color={card.sub}>
          {t('month.kitchens', { n: v.food.kitchens })}
        </Text>
      </View>
    </Tile>
  );
}

function RidesTile({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  const card = theme.services.taxi.card;
  const colours = useStackColours();
  const n = v.rides.taxi + v.rides.tuktuk;
  return (
    <Tile bg={card.bg} testID="stats-tile-rides">
      <View style={{ padding: theme.space[3], gap: 2 }}>
        <Text variant="amount" face="display" tabular color={card.on}>
          {n}
        </Text>
        <Text variant="footnote" weight={600} color={card.on}>
          {t('stats.rides_caption', { n })}
        </Text>
        <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2, marginTop: theme.space[1] }}>
          {v.rides.taxi > 0 ? <View style={{ flex: v.rides.taxi, backgroundColor: colours.taxi }} /> : null}
          {v.rides.tuktuk > 0 ? <View style={{ flex: v.rides.tuktuk, backgroundColor: colours.tuktuk }} /> : null}
        </View>
        <Text variant="caption" color={card.sub} tabular>
          {[v.rides.taxi > 0 ? t('stats.legend_taxi', { n: v.rides.taxi }) : null, v.rides.tuktuk > 0 ? t('stats.legend_tuktuk', { n: v.rides.tuktuk }) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Tile>
  );
}

function RajaaTile({ n }: { n: number }) {
  const theme = useTheme();
  const t = useT();
  const trips = theme.services.trips;
  return (
    <Tile bg={trips.fill} testID="stats-tile-rajaa">
      <StarPattern color={trips.pattern} opacity={0.18} />
      <View style={{ padding: theme.space[3], gap: 2 }}>
        <Text variant="amount" face="display" tabular color={trips.on}>
          {n}
        </Text>
        <Text variant="footnote" weight={600} color={trips.sub}>
          {t('stats.rajaa_caption', { n })}
        </Text>
      </View>
    </Tile>
  );
}
