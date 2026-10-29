import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native';
import { Button, Card, Icon, stageOf, Text, useTheme, withAlpha } from '@driver/ui';
import { FoodArt, kitchenLook, motifForKitchen } from '@/features/food/FoodArt';
import { useT } from '@/lib/i18n';
import { countKey } from '@/lib/plural';
import type { LivePin, OrderStep } from './logic';
import { CookingDot } from './Markers';

const TILE = 132;

/** «أسرع شي يوصلك هسة»: photo tiles of the soonest open kitchens, «كل المطاعم» beside the title. */
export function FastRail({ pins, loading, onPick, onAll }: { pins: LivePin[]; loading: boolean; onPick: (id: string) => void; onAll: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card padding={0} lift testID="live-rail">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space[4], paddingTop: theme.space[3] }}>
        <Text variant="bodyStrong" weight={700}>
          {t('live_map.rail_title')}
        </Text>
        <Pressable onPress={onAll} accessibilityRole="link" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} testID="live-rail-all">
          <Text variant="footnote" weight={700} color="accentText">
            {t('live_map.all_restaurants')}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[3], paddingHorizontal: theme.space[4], paddingBottom: theme.space[4], paddingTop: theme.space[1] }}>
        {loading
          ? [0, 1, 2].map((i) => <View key={i} style={{ width: TILE, height: TILE + 40, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }} />)
          : pins.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => onPick(p.id)}
                accessibilityRole="button"
                accessibilityLabel={t('live_map.pin_label', { name: p.card.name, n: p.minutes ?? 0 })}
                testID={`live-tile-${p.id}`}
                style={{ width: TILE, gap: 4 }}
              >
                <View style={{ width: TILE, height: TILE * 0.72, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
                  <FoodArt motif={motifForKitchen(p.card.tags, p.card.cuisine)} look={kitchenLook(p.id)} stage={stageOf(p.id, theme.decor.stages)} photoUrl={p.card.photoUrl} />
                  {p.cooking ? (
                    <View style={{ position: 'absolute', top: 6, start: 6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: withAlpha(theme.colors.surface, 0.94) }}>
                      <CookingDot />
                      <Text variant="caption" weight={700} color="accentText">
                        {t('live_map.cooking_now')}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text variant="footnote" weight={700} numberOfLines={1}>
                  {p.card.name}
                </Text>
                <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
                  {t('live_map.reaches_you', { n: p.minutes ?? 0 })}
                </Text>
              </Pressable>
            ))}
      </ScrollView>
    </Card>
  );
}

/** The chips found nothing: say so in one line and offer every kitchen again. */
export function NothingHere({ text, onAll }: { text: string; onAll: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card padding={4} lift testID="live-nothing">
      <Text variant="body" weight={600}>
        {text}
      </Text>
      <View style={{ alignItems: 'flex-start', marginTop: theme.space[3] }}>
        <Button label={t('live_map.show_all')} variant="secondary" onPress={onAll} testID="live-nothing-all" />
      </View>
    </Card>
  );
}

/**
 * Their order on its way, over the map (the dark date card): the kitchen, the minutes in a saffron box,
 * the four steps, and «تابع طلبك» to the full tracking screen.
 */
export function OrderCard({ kitchen, step, minutes, onOpen }: { kitchen: string | null; step: OrderStep; minutes: number | null; onOpen: () => void }) {
  const theme = useTheme();
  const t = useT();
  const s = theme.services.trips;
  const steps = [t('live_map.step_ordered'), t('live_map.step_making'), t('live_map.step_on_way'), t('live_map.step_door')];
  return (
    <View style={{ borderRadius: theme.radius.xl, backgroundColor: s.fill, padding: theme.space[4], gap: theme.space[3], boxShadow: '0 6px 18px rgba(40,24,8,0.3)' }} testID="live-order">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="title" weight={700} style={{ color: s.on }}>
            {t('live_map.order_title')}
          </Text>
          {kitchen ? (
            <Text variant="footnote" numberOfLines={1} style={{ color: s.sub }}>
              {kitchen}
            </Text>
          ) : null}
        </View>
        {minutes !== null ? (
          <View style={{ paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: theme.colors.accent }}>
            <Text variant="bodyStrong" weight={700} tabular color="onAccent">
              {t(countKey('live_map.minutes', minutes), { n: minutes })}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel={steps[step]}>
        {steps.map((label, i) => (
          <View key={label} style={{ flex: 1, gap: 4 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= step ? theme.colors.accent : withAlpha(s.on, 0.25) }} />
            <Text variant="caption" weight={i === step ? 700 : 400} numberOfLines={1} style={{ color: i === step ? s.on : withAlpha(s.on, 0.7) }}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      <Button label={t('live_map.order_open')} onPress={onOpen} testID="live-order-open" />
    </View>
  );
}

/** How long each shop front stays in the tour before it moves on by itself. */
export const TOUR_STEP_MS = 6500;

/**
 * «هسة بالعزيزية», once: story bars across the top of the card, the shop, «يطبخ هسة» or its minutes,
 * «شوف المنيو» and «الجاي», and «تخطّى» to leave the tour. The bar fills while the camera holds the
 * shop; with reduce motion it simply shows full and the tour waits for «الجاي».
 */
export function TourCard({ pin, index, total, onMenu, onNext, onSkip }: { pin: LivePin; index: number; total: number; onMenu: () => void; onNext: () => void; onSkip: () => void }) {
  const theme = useTheme();
  const t = useT();
  const fill = useRef(new Animated.Value(0)).current;
  const next = useRef(onNext);
  next.current = onNext;
  useEffect(() => {
    if (theme.reduceMotion) {
      fill.setValue(1);
      return;
    }
    fill.setValue(0);
    const run = Animated.timing(fill, { toValue: 1, duration: TOUR_STEP_MS, easing: Easing.linear, useNativeDriver: false });
    run.start(({ finished }) => {
      if (finished) next.current();
    });
    return () => run.stop();
  }, [pin.id, fill, theme.reduceMotion]);
  const r = pin.card;
  return (
    <Card padding={4} lift testID="live-tour">
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: theme.space[3] }}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
            {i < index ? <View style={{ flex: 1, backgroundColor: theme.colors.accent }} /> : null}
            {i === index ? <Animated.View style={{ height: 3, backgroundColor: theme.colors.accent, width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} /> : null}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 64, height: 64, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
          <FoodArt motif={motifForKitchen(r.tags, r.cuisine)} look={kitchenLook(r.id)} stage={stageOf(r.id, theme.decor.stages)} photoUrl={r.photoUrl} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="caption" weight={700} color="accentText">
            {t('live_map.tour_tag')}
          </Text>
          <Text variant="title" weight={700} numberOfLines={1}>
            {r.name}
          </Text>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {pin.cooking ? t('live_map.cooking_reaches', { n: pin.minutes ?? 0 }) : t('live_map.reaches_you', { n: pin.minutes ?? 0 })}
          </Text>
        </View>
        <Pressable onPress={onSkip} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }} testID="live-tour-skip">
          <Text variant="footnote" weight={700} color="textMuted">
            {t('live_map.tour_skip')}
          </Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: theme.space[4] }}>
        <Button label={t('restaurant_map.menu')} icon="food" onPress={onMenu} style={{ flex: 1 }} testID="live-tour-menu" />
        <Button
          label={index + 1 < total ? t('restaurant_map.next') : t('live_map.tour_done')}
          variant="ink"
          onPress={onNext}
          trailing={index + 1 < total ? <Icon name="chevron-forward" size={18} color="surface" strokeWidth={2.4} /> : undefined}
          testID="live-tour-next"
        />
      </View>
    </Card>
  );
}
