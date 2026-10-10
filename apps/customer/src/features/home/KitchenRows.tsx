import { router } from 'expo-router';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { longRideForHotFood } from '@driver/contracts';
import { formatRange } from '@driver/i18n';
import type { ThemeColorKey } from '@driver/design-tokens';
import { Button, Chip, CornerFill, Icon, PhotoImage, Skeleton, stageOf, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { DealSticker } from '@/features/food/DealBadge';
import { FoodArt, kitchenLook, motifForKitchen, type Motif } from '@/features/food/FoodArt';
import { LongRide } from '@/features/food/RestaurantRow';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { apiPhoto } from '@/lib/photo';
import { FoodPhoto } from '@/features/food-landing/FoodPhoto';
import type { FoodPhotoSource } from '@/features/food-landing/photos';
import { kitchenPhotos } from './dish-photos';
import { HOME_KITCHENS, sharedFee } from './kitchens';
import type { RestaurantSummary } from './restaurant-summary';

/** A kitchen's picture in its row. */
const PIC = 56;
/** How many of the other kitchens' photos sit on «كل المحلات», their size and how far each tucks under the last. */
const FACES = 3;
const FACE = 38;
const OVERLAP = 12;

/**
 * «مفتوح هسة» on home (concept C, Ali 2026-10-08): the first few open kitchens as plain rows on the
 * page, flat like the cards above (no boxes, no shadow): a photo (its own, else one of its kind, else
 * its warm drawing), the name, its rating («جديد» before real ratings) and minutes. The delivery fee is
 * said once over the list when every kitchen charges the same; a row says its own only when they
 * differ. «كل المحلات» opens the rest, in a box of its own under the rows.
 */
export function KitchenRows({
  title,
  kitchens,
  count,
  showing = [],
  onMap,
  testID = 'rail-open',
}: {
  title: string;
  kitchens: readonly RestaurantSummary[];
  count: string;
  /** The stand-in photos' kinds already on the page (the hour's dishes): rows pick others. */
  showing?: readonly Motif[];
  /** «الخريطة»: the town's restaurants on the map (Ali 2026-10-10: "add it"); hidden where there is no map. */
  onMap?: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const t = useT();
  const shown = kitchens.slice(0, HOME_KITCHENS);
  const fee = sharedFee(kitchens);
  // A kitchen without its own photo shows one for its kind (two in a row never share one), else its
  // drawing. The next few kitchens' photos go on «كل المحلات», never one already on the page.
  const motifs = useMemo(() => kitchens.slice(0, HOME_KITCHENS + FACES).map((r) => motifForKitchen(r.tags, r.cuisine)), [kitchens]);
  const photos = useMemo(() => kitchenPhotos(motifs, showing), [motifs, showing]);
  const faces = useMemo(
    () =>
      kitchens
        .slice(HOME_KITCHENS, HOME_KITCHENS + FACES)
        .map((r, i) => apiPhoto(r.photoUrl) ?? photos[HOME_KITCHENS + i] ?? null)
        .filter((f): f is string | number => f !== null),
    [kitchens, photos],
  );
  return (
    <View testID={testID} style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: theme.space[3], minHeight: 36 }}>
        <Text variant="section" face="display" accessibilityRole="header">
          {title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          {fee !== null ? (
            <Text testID={`${testID}-fee`} variant="footnote" color="textMuted" tabular>
              {fee <= 0 ? t('home.fee_all_free') : t('home.fee_all', { amount: amountParam(fee) })}
            </Text>
          ) : null}
          {onMap ? <Chip label={t('restaurant_map.open_map')} icon="map-pin" role="button" onPress={onMap} testID={`${testID}-map`} /> : null}
        </View>
      </View>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
        {shown.map((r, i) => (
          <KitchenRow key={r.id} r={r} motif={motifs[i]!} photo={photos[i] ?? null} ownFee={fee === null} testID={`restaurant-${r.id}`} />
        ))}
      </View>
      {kitchens.length > HOME_KITCHENS ? <AllKitchens count={count} faces={faces} testID={`${testID}-all`} /> : null}
    </View>
  );
}

/**
 * «كل المحلات» (Ali 2026-10-08: "a clear beautiful box"): a Soft Tint box in the food card's own
 * colours, so it reads as the way into the rest: the words and how many are open, a few of the other
 * kitchens' photos, and a round ink arrow. It sinks a little under the finger, like the cards above.
 */
function AllKitchens({ count, faces, testID }: { count: string; faces: readonly (string | number)[]; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const card = theme.services.food.card;
  const p = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.025 * p.value }] }));
  // The photos take the room the words leave, as many as fit whole (fewer on a small phone or with large text).
  const [room, setRoom] = useState<number | null>(null);
  const fit = room === null ? faces.length : Math.max(0, Math.min(faces.length, Math.floor((room - FACE) / (FACE - OVERLAP)) + 1));
  return (
    <Animated.View style={[{ marginTop: theme.space[3] }, sink]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('home.all_kitchens_a11y', { count })}
        onPress={() => {
          theme.haptic('selection');
          router.push({ pathname: '/restaurants', params: { preset: 'open' } });
        }}
        onPressIn={() => {
          if (!theme.reduceMotion) p.value = withSpring(1, theme.motion.spring.press);
        }}
        onPressOut={() => {
          p.value = withSpring(0, theme.motion.spring.select);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          minHeight: 76,
          paddingVertical: theme.space[3],
          paddingStart: theme.space[5],
          paddingEnd: theme.space[4],
          backgroundColor: card.bg,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: withAlpha(card.on, 0.07),
          overflow: 'hidden',
        }}
      >
        {card.top ? <CornerFill base={card.bg} light={card.top} /> : null}
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text variant="title" face="display" color={card.on} numberOfLines={2}>
            {t('home.all_kitchens')}
          </Text>
          <Text variant="footnote" weight={500} color={card.sub} tabular>
            {count}
          </Text>
        </View>
        <View
          onLayout={(e) => setRoom(e.nativeEvent.layout.width)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'flex-end', overflow: 'hidden' }}
        >
          {faces.slice(0, fit).map((f, i) => (
            <View
              key={i}
              style={{
                width: FACE,
                height: FACE,
                marginStart: i === 0 ? 0 : -OVERLAP,
                borderRadius: FACE / 2,
                borderWidth: 2,
                borderColor: card.top ?? card.bg,
                overflow: 'hidden',
                backgroundColor: theme.colors.surfaceSunken,
              }}
            >
              <FoodPhoto photo={f} style={{ width: '100%', height: '100%' }} />
            </View>
          ))}
        </View>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: card.on }}>
          <Icon name="chevron-forward" size={20} color={card.top ?? card.bg} strokeWidth={2.25} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

function KitchenRow({ r, motif, photo, ownFee, testID }: { r: RestaurantSummary; motif: Motif; photo: FoodPhotoSource | null; ownFee: boolean; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [failed, setFailed] = useState(false);
  const uri = failed ? null : apiPhoto(r.photoUrl);
  const minutes = t('list.minutes', {
    range: r.etaMinMinutes !== null && r.etaMaxMinutes !== null ? formatRange(r.etaMinMinutes, r.etaMaxMinutes, locale) : formatRange(r.prepMinMinutes, r.prepMaxMinutes, locale),
  });
  const free = r.deliveryFeeIqd !== null && r.deliveryFeeIqd <= 0;
  const fee = ownFee && r.deliveryFeeIqd !== null ? (free ? t('list.fee_free') : t('list.fee', { amount: amountParam(r.deliveryFeeIqd) })) : null;
  const rating = r.rating === null ? t('list.new') : r.rating.toFixed(1);
  // The facts after the rating, «·» between them.
  const facts = [minutes, fee].filter((f): f is string => f !== null);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[r.name, r.rating === null ? rating : t('home.kitchen_stars_a11y', { n: rating }), ...facts].join('، ')}
      onPress={() => {
        theme.haptic('selection');
        router.push({ pathname: '/restaurant/[id]', params: { id: r.id } });
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingVertical: theme.space[3],
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: PIC, height: PIC, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
        {uri ? (
          <PhotoImage uri={uri} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} />
        ) : photo !== null ? (
          <FoodPhoto photo={photo} style={{ width: '100%', height: '100%' }} />
        ) : (
          <FoodArt motif={motif} look={kitchenLook(r.id)} stage={stageOf(r.id, theme.decor.stages)} photoUrl={null} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="bodyStrong" weight={700} numberOfLines={1} style={{ flexShrink: 1 }}>
            {r.name}
          </Text>
          {r.dealCount > 0 ? <DealSticker label={t('list.deal')} /> : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space[2], rowGap: 2 }}>
          {r.rating === null ? (
            <View testID={`${testID}-new`} style={{ paddingHorizontal: theme.space[2], paddingVertical: 1, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentTint }}>
              <Text variant="caption" weight={700} color="accentText" compact>
                {rating}
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon name="star" size={13} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
              <Text variant="footnote" weight={600} tabular>
                {rating}
              </Text>
            </View>
          )}
          {facts.map((f) => (
            <Fragment key={f}>
              <Text variant="footnote" color="textMuted" aria-hidden>
                ·
              </Text>
              <Text variant="footnote" weight={f === fee && free ? 700 : 400} color={f === fee && free ? 'accentText' : 'textMuted'} tabular numberOfLines={1}>
                {f}
              </Text>
            </Fragment>
          ))}
        </View>
        {longRideForHotFood(r) ? <LongRide testID={`${testID}-long-ride`} /> : null}
      </View>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}

/**
 * One flat line in the kitchens' place when there are none to list: night (who opens first, tap for
 * its menu), a failed load (try again) or a zone with none. The rows' own look, no box, so home stays
 * calm when food is quiet.
 */
export function KitchenNote({
  testID,
  art,
  title,
  line,
  onPress,
  hint,
  action,
}: {
  testID?: string;
  art: ReactNode;
  title: string;
  line?: string | null;
  /** The whole line opens something (the first kitchen's menu): a chevron at its end. */
  onPress?: () => void;
  hint?: string;
  /** Or a small button at its end (try again, see all). */
  action?: { label: string; onPress: () => void; testID?: string };
}) {
  const theme = useTheme();
  const row: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[3], borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border };
  const body = (
    <>
      <View style={{ width: PIC, height: PIC, alignItems: 'center', justifyContent: 'center' }}>{art}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" weight={700}>
          {title}
        </Text>
        {line ? (
          <Text variant="footnote" color="textMuted" tabular>
            {line}
          </Text>
        ) : null}
      </View>
      {onPress ? <Icon name="chevron-forward" size={18} color="textMuted" /> : action ? <Button testID={action.testID} size="sm" variant="secondary" label={action.label} onPress={action.onPress} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={row}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, line].filter(Boolean).join('، ')}
      accessibilityHint={hint}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => [row, { opacity: pressed ? 0.6 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** The round mark at the start of a note: an icon on the sunken colour. */
export function NoteMark({ icon, color = 'textMuted' }: { icon: IconName; color?: ThemeColorKey }) {
  const theme = useTheme();
  return (
    <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken }}>
      <Icon name={icon} size={22} color={color} />
    </View>
  );
}

/** The list while kitchens load: the same rows, drawn quiet. */
export function KitchenRowsSkeleton() {
  const theme = useTheme();
  const t = useT();
  return (
    <View accessibilityLabel={t('status.loading')} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }}>
          <Skeleton width={PIC} height={PIC} radius={theme.radius.lg} />
          <View style={{ flex: 1, gap: theme.space[2] }}>
            <Skeleton height={14} width="50%" />
            <Skeleton height={12} width="35%" />
          </View>
        </View>
      ))}
    </View>
  );
}
