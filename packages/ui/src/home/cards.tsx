import { memo, useCallback, type ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Text } from '../components/Text';
import { formatAmount, ltr } from '../format';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { GUARD_MS, homeSize, iqd, mins, sep, SLOT, splitSlot } from './format';
import { useHomeLook } from './look';
import { HomePress, Picture, type DishPicture } from './media';

/** A dish on the home's cards: the photo may be missing (then the designed drawing shows). */
export interface HomeCardDish {
  id: string;
  name: string;
  restaurant: string;
  /** Minutes to the door. */
  minutes: number;
  /** Price in dinars (from the server). */
  price: number;
  picture?: DishPicture;
}

/**
 * The surface every home section sits on (audit round 2): the card colour and one soft shadow, never an
 * outline; one radius for cards (20), round for buttons and chips.
 */
export function HomeCard({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View testID={testID} style={[{ backgroundColor: look.card.fill, borderRadius: theme.radius.xl, boxShadow: look.card.shadow ?? undefined, borderWidth: look.card.edge ? 1 : 0, borderColor: look.card.edge ?? undefined }, style]}>
      {children}
    </View>
  );
}

/** A round button on a card: outline (ink on sage, orange at night) or filled orange. */
function CardButton({ label, a11y, onPress, filled, compact, testID }: { label: string; a11y?: string; onPress: () => void; filled?: boolean; compact?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <HomePress
      accessibilityLabel={a11y ?? label}
      onPress={onPress}
      haptic={filled ? 'light' : 'secondary'}
      guardMs={GUARD_MS}
      testID={testID}
      style={{
        minHeight: compact ? theme.hitTarget : homeSize.button,
        paddingHorizontal: compact ? theme.space[4] : theme.space[5],
        borderRadius: theme.radius.pill,
        borderWidth: filled ? 0 : homeSize.outline,
        borderColor: theme.colors.selectedBorder,
        backgroundColor: filled ? theme.colors.accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="bodyStrong" face="display" color={filled ? 'onAccent' : 'accentText'} compact numberOfLines={1}>
        {label}
      </Text>
    </HomePress>
  );
}

/** «restaurant · price · minutes» with the price in its own colour. */
function DishMeta({ dish, withMinutes }: { dish: HomeCardDish; withMinutes: boolean }) {
  const look = useHomeLook();
  const line = withMinutes ? t('home.dish_meta', { restaurant: dish.restaurant, price: SLOT, minutes: mins(dish.minutes) }) : t('home.dish_meta_short', { restaurant: dish.restaurant, price: SLOT });
  const [before, after] = splitSlot(line);
  return (
    <Text variant="label" color="textMuted" numberOfLines={withMinutes ? 2 : 1}>
      {before}
      <Text variant="label" weight={600} face="display" color={look.price}>
        {iqd(dish.price)}
      </Text>
      {after}
    </Text>
  );
}

const dishA11y = (d: HomeCardDish) => t('home.dish_card_a11y', { dish: d.name, restaurant: d.restaurant, price: iqd(d.price), minutes: mins(d.minutes) });

// ─── Dish ────────────────────────────────────────────────────────────────────────────────────────

export interface BigDishCardProps {
  dish: HomeCardDish;
  /** The daypart tag («للعشا», `home.band.*`). */
  tag: string;
  /** Called with the dish id, so a list can pass one stable callback and `memo` skips redraws. */
  onAdd: (id: string) => void;
  onPress?: (id: string) => void;
  testID?: string;
}

/** The idle home's big dish (spec §3 item 8): photo edge to edge, name with the daypart tag, «restaurant · price · minutes», «ضيفه للسلة». */
export const BigDishCard = memo(function BigDishCard({ dish, tag, onAdd, onPress, testID }: BigDishCardProps) {
  const theme = useTheme();
  const add = useCallback(() => onAdd(dish.id), [onAdd, dish.id]);
  const open = useCallback(() => onPress?.(dish.id), [onPress, dish.id]);
  return (
    <HomeCard testID={testID} style={{ overflow: 'hidden' }}>
      <HomePress accessibilityLabel={dishA11y(dish)} onPress={onPress ? open : undefined}>
        <Picture picture={dish.picture} name={dish.name} seed={dish.id} width="100%" height={homeSize.dishPhoto} radius={0} testID={testID} />
        <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[3], gap: theme.space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
            <Text variant="title" face="display" numberOfLines={2} style={{ flex: 1 }}>
              {dish.name}
            </Text>
            <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], marginTop: theme.space[1] }}>
              <Text variant="footnote" weight={600} color="textMuted" compact>
                {tag}
              </Text>
            </View>
          </View>
          <DishMeta dish={dish} withMinutes />
        </View>
      </HomePress>
      <View style={{ padding: theme.space[4], paddingTop: theme.space[3] }}>
        <CardButton label={t('home.dish_add')} a11y={t('home.dish_add_a11y', { dish: dish.name })} onPress={add} testID={testID ? `${testID}-add` : undefined} />
      </View>
    </HomeCard>
  );
});

export interface CompactDishProps {
  dish: HomeCardDish;
  onAdd: (id: string) => void;
  onPress?: (id: string) => void;
  testID?: string;
}

/** The compact dish row during an order (spec §3 item 8): photo, name, «restaurant · price», round +. */
export const CompactDish = memo(function CompactDish({ dish, onAdd, onPress, testID }: CompactDishProps) {
  const theme = useTheme();
  const add = useCallback(() => onAdd(dish.id), [onAdd, dish.id]);
  const open = useCallback(() => onPress?.(dish.id), [onPress, dish.id]);
  return (
    <HomeCard testID={testID} style={{ padding: theme.space[2], paddingEnd: theme.space[3], flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <HomePress accessibilityLabel={dishA11y(dish)} onPress={onPress ? open : undefined} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Picture picture={dish.picture} name={dish.name} seed={dish.id} width={homeSize.thumb} height={homeSize.thumb} radius={theme.radius.lg} testID={testID} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" face="display" numberOfLines={2}>
            {dish.name}
          </Text>
          <DishMeta dish={dish} withMinutes={false} />
        </View>
      </HomePress>
      <HomePress
        accessibilityLabel={t('home.dish_add_a11y', { dish: dish.name })}
        onPress={add}
        guardMs={GUARD_MS}
        testID={testID ? `${testID}-add` : undefined}
        style={{ width: theme.hitTarget, height: theme.hitTarget, borderRadius: theme.hitTarget / 2, borderWidth: homeSize.outline, borderColor: theme.colors.selectedBorder, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="plus" size={homeSize.iconPlus} color="accentText" strokeWidth={2.25} />
      </HomePress>
    </HomeCard>
  );
});

// ─── Two dishes ──────────────────────────────────────────────────────────────────────────────────

export interface DishPairProps {
  /** Two dishes for this time of day; one shows alone at full width. */
  dishes: readonly HomeCardDish[];
  onAdd: (id: string) => void;
  onPress?: (id: string) => void;
  testID?: string;
}

/**
 * Audit round 3: the idle home's dishes for this time of day, two side by side (Wolt, Talabat), so the
 * page offers a choice instead of one more hero photo. Photo, name, price in its colour, a round +.
 */
export function DishPair({ dishes, onAdd, onPress, testID }: DishPairProps) {
  const theme = useTheme();
  const shown = dishes.slice(0, 2);
  if (shown.length === 0) return null;
  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: theme.space[3] }}>
      {shown.map((d) => (
        <PairDish key={d.id} dish={d} onAdd={onAdd} onPress={onPress} testID={testID ? `${testID}-${d.id}` : undefined} />
      ))}
    </View>
  );
}

/** One of the two: takes the parent's id callbacks as they are, so `memo` really skips a redraw. */
const PairDish = memo(function PairDish({ dish: d, onAdd, onPress, testID }: { dish: HomeCardDish; onAdd: (id: string) => void; onPress?: (id: string) => void; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  const add = useCallback(() => onAdd(d.id), [onAdd, d.id]);
  const open = useCallback(() => onPress?.(d.id), [onPress, d.id]);
  return (
    <HomeCard testID={testID} style={{ flex: 1, overflow: 'hidden' }}>
      <HomePress accessibilityLabel={dishA11y(d)} onPress={onPress ? open : undefined} style={{ flex: 1 }}>
        <Picture picture={d.picture} name={d.name} seed={d.id} width="100%" height={homeSize.pairPhoto} radius={0} testID={testID} />
        <View style={{ padding: theme.space[3], paddingBottom: theme.space[2], gap: homeSize.gapHair, flex: 1 }}>
          <Text variant="bodyStrong" face="display" numberOfLines={2}>
            {d.name}
          </Text>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {t('home.panel.dish_meta', { restaurant: d.restaurant, minutes: mins(d.minutes) })}
          </Text>
        </View>
      </HomePress>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingStart: theme.space[3], paddingEnd: theme.space[2], paddingBottom: theme.space[2] }}>
        <Text variant="label" weight={600} face="display" color={look.price} tabular compact>
          {iqd(d.price)}
        </Text>
        <HomePress
          accessibilityLabel={t('home.dish_add_a11y', { dish: d.name })}
          onPress={add}
          guardMs={GUARD_MS}
          testID={testID ? `${testID}-add` : undefined}
          style={{ width: theme.hitTarget, height: theme.hitTarget, borderRadius: theme.hitTarget / 2, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="plus" size={homeSize.iconPlus} color="accentText" strokeWidth={2.25} />
        </HomePress>
      </View>
    </HomeCard>
  );
});

// ─── Restaurant ──────────────────────────────────────────────────────────────────────────────────

export interface RestaurantCardProps {
  id: string;
  name: string;
  /** 0 = no ratings yet («جديد»). */
  rating: number;
  minutes: number;
  /** Delivery fee in dinars from the server; 0 = free. */
  fee: number;
  picture?: DishPicture;
  /** Card width in the row (the row scrolls sideways). */
  width?: number;
  /** Called with the restaurant id (one stable callback for the whole row). */
  onPress?: (id: string) => void;
  testID?: string;
}

/** A restaurant in «مفتوح هسة» (spec §3 item 10): photo edge to edge, full name up to 2 lines, star + rating · minutes, fee. */
export const RestaurantCard = memo(function RestaurantCard({ id, name, rating, minutes, fee, picture, width = homeSize.restWidth, onPress, testID }: RestaurantCardProps) {
  const open = useCallback(() => onPress?.(id), [onPress, id]);
  const theme = useTheme();
  const feeText = fee > 0 ? t('list.fee', { amount: ltr(formatAmount(fee)) }) : t('list.fee_free');
  const stars = rating > 0 ? rating.toFixed(1) : t('home.rating_new');
  return (
    <HomePress accessibilityLabel={rating > 0 ? t('home.rest_a11y', { name, rating: stars, minutes: mins(minutes), fee: feeText }) : t('home.rest_new_a11y', { name, minutes: mins(minutes), fee: feeText })} onPress={onPress ? open : undefined} testID={testID} style={{ width }}>
      <HomeCard style={{ overflow: 'hidden', flex: 1 }}>
        <Picture picture={picture} name={name} seed={id} width="100%" height={homeSize.restPhoto} radius={0} testID={testID} />
        <View style={{ padding: theme.space[3], paddingTop: theme.space[2], gap: homeSize.gapHair }}>
          <Text variant="bodyStrong" face="display" numberOfLines={2}>
            {name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
            {/* The theme's star: orange with an ink outline in sage (orange alone fails there, §4). */}
            {rating > 0 ? <Icon name="star" size={homeSize.iconSm} color="starOutline" fillColor="star" filled strokeWidth={1.25} /> : null}
            <Text variant="footnote" weight={700} tabular compact>
              {stars}
            </Text>
            <Text variant="footnote" color="textMuted" compact>
              {sep()}
            </Text>
            <Text variant="footnote" color="textMuted" compact numberOfLines={1}>
              {mins(minutes)}
            </Text>
          </View>
          <Text variant="footnote" color="textMuted" compact numberOfLines={1}>
            {feeText}
          </Text>
        </View>
      </HomeCard>
    </HomePress>
  );
});

// ─── Chips ───────────────────────────────────────────────────────────────────────────────────────

export interface HomeChip {
  id: string;
  label: string;
}

export interface HomeChipsProps {
  chips: readonly HomeChip[];
  /** None at first (spec §8); tapping the selected chip again clears it. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** What a screen reader calls the group («الأصناف»). */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * The category chips under «مفتوح هسة»: 44 tall, a sideways row, selected = the theme's selected fill + check.
 * Not the shared `Chip`: the home's surfaces are told apart by fill and shadow, never an outline, and a
 * chip here is a radio in a group (tap again to clear), which `Chip` doesn't model.
 */
export function HomeChips({ chips, selected, onSelect, accessibilityLabel, testID }: HomeChipsProps) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} contentContainerStyle={{ gap: theme.space[2], paddingHorizontal: theme.space[4], paddingVertical: 4 }} style={{ marginHorizontal: -theme.space[4] }}>
      {chips.map((c) => {
        const on = c.id === selected;
        return (
          <HomePress
            key={c.id}
            accessibilityRole="radio"
            accessibilityHint={on ? t('home.chip_hint') : undefined}
            checked={on}
            haptic="selection"
            onPress={() => onSelect(on ? null : c.id)}
            testID={testID ? `${testID}-${c.id}` : undefined}
            style={{
              minHeight: theme.hitTarget,
              flexDirection: 'row',
              alignItems: 'center',
              gap: homeSize.gapTight,
              paddingHorizontal: theme.space[4],
              borderRadius: theme.radius.pill,
              backgroundColor: on ? theme.colors.selected : look.card.fill,
              boxShadow: on ? undefined : (look.card.shadow ?? undefined),
            }}
          >
            {on ? <Icon name="check" size={homeSize.iconChip} color="onSelected" strokeWidth={2.5} /> : null}
            <Text variant="label" weight={on ? 700 : 500} color={on ? 'onSelected' : 'text'} compact>
              {c.label}
            </Text>
          </HomePress>
        );
      })}
    </ScrollView>
  );
}
