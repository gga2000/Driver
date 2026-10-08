import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { OrderHistoryRow } from '@driver/contracts';
import { CornerFill, Icon, stageOf, Text, usePressScale, useTheme, withAlpha, type IconName } from '@driver/ui';
import { FoodArt, kitchenLook, motifForDish } from '@/features/food/FoodArt';

/** The dish's picture on the card. */
const PIC = 72;

/**
 * The card under the service cards (concept C's Soft Tint slot, 2026-10-08): the usual, the Friday
 * booking or the last meal again, in the food card's own colours so it reads as one family with the
 * cards above. A photo of the dish (its drawing when there is none), the kitchen, the dishes, one line
 * of why or when, and the action as a dark pill. The whole card is the one button (the pill is only its
 * picture: a button inside a button can't be pressed on its own, and the web refuses it), and it sinks
 * a little under the finger.
 */
export function SlotCard({
  testID,
  kicker,
  row,
  dishes,
  meta,
  metaIcon,
  metaTestID,
  note,
  noteTestID,
  photo,
  action,
  actionIcon,
  actionTestID,
  busy,
  onPress,
  accessibilityLabel,
}: {
  testID: string;
  kicker: string;
  row: OrderHistoryRow;
  dishes: string;
  meta: string;
  metaIcon?: IconName;
  metaTestID?: string;
  /** A second, quieter line under the footer (Friday prayer). */
  note?: string | null;
  noteTestID?: string;
  /** The dish's photo (`orderPhoto`), chosen once on home so the gallery below can leave it out. */
  photo: number | null;
  action: string;
  actionIcon: IconName;
  actionTestID?: string;
  busy: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const card = theme.services.food.card;
  const light = card.top ?? card.bg;
  const sink = usePressScale(0.975);
  return (
    <Animated.View style={sink.style}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={action}
        accessibilityState={{ busy }}
        onPress={busy ? undefined : onPress}
        onPressIn={sink.onPressIn}
        onPressOut={sink.onPressOut}
        style={{ gap: theme.space[3], padding: theme.space[4], backgroundColor: card.bg, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: withAlpha(card.on, 0.07), overflow: 'hidden' }}
      >
        {card.top ? <CornerFill base={card.bg} light={card.top} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: PIC, height: PIC, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: light }}>
            {photo !== null ? (
              <Image source={photo} resizeMode="cover" accessible={false} style={{ width: '100%', height: '100%' }} />
            ) : (
              <FoodArt motif={motifForDish(row.items[0]?.name ?? '')} look={kitchenLook(row.order.merchantOrgId ?? row.order.id)} stage={stageOf(row.order.merchantOrgId ?? row.order.id, theme.decor.stages)} photoUrl={null} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="caption" weight={700} color={card.sub} numberOfLines={2}>
              {kicker}
            </Text>
            <Text variant="title" face="display" color={card.on} numberOfLines={2}>
              {row.merchantName}
            </Text>
            <Text variant="footnote" color={card.sub} numberOfLines={2}>
              {dishes}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {metaIcon ? <Icon name={metaIcon} size={16} color={card.on} /> : null}
            <Text testID={metaTestID} variant="footnote" weight={600} color={card.on} tabular style={{ flexShrink: 1 }}>
              {/* A number keeps the word after it on its line when the line wraps («1:30 م», «15,000 دينار»). */}
              {meta.replace(/(\d) /g, '$1\u00A0')}
            </Text>
          </View>
          <View
            testID={actionTestID ?? `${testID}-go`}
            aria-hidden
            accessible={false}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: card.on }}
          >
            {busy ? <ActivityIndicator size="small" color={light} /> : <Icon name={actionIcon} size={16} color={light} strokeWidth={2.25} />}
            <Text variant="label" weight={700} color={light} compact>
              {action}
            </Text>
          </View>
        </View>
        {note ? (
          <Text testID={noteTestID} variant="caption" color={card.sub}>
            {note}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
