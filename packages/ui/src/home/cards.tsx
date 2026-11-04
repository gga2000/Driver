import { memo, type ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Text } from '../components/Text';
import { formatAmount, ltr } from '../format';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeProvider';
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

export const iqd = (n: number) => t('unit.iqd', { amount: ltr(formatAmount(n)) });
export const mins = (n: number) => t('live_map.minutes', { n });
/** Where the price sits inside «restaurant · price · minutes», so it can wear its own colour. */
const MARK = '⁣';
/** One tap, one order: a second tap within this window is ignored. */
const GUARD_MS = 1200;

/**
 * The surface every home section sits on (audit round 2): the card colour and one soft shadow, never an
 * outline; one radius for cards (20), round for buttons and chips.
 */
export function HomeCard({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View testID={testID} style={[{ backgroundColor: look.card.fill, borderRadius: theme.radius.xl, boxShadow: look.card.shadow ?? undefined }, style]}>
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
        minHeight: compact ? theme.hitTarget : 48,
        paddingHorizontal: compact ? theme.space[4] : theme.space[5],
        borderRadius: theme.radius.pill,
        borderWidth: filled ? 0 : 1.5,
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
  const line = withMinutes ? t('home.dish_meta', { restaurant: dish.restaurant, price: MARK, minutes: mins(dish.minutes) }) : t('home.dish_meta_short', { restaurant: dish.restaurant, price: MARK });
  const [before, after] = line.split(MARK);
  return (
    <Text variant="label" color="textMuted" numberOfLines={withMinutes ? 2 : 1}>
      {before}
      <Text variant="label" weight={700} face="display" color={look.price}>
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
  onAdd: () => void;
  onPress?: () => void;
  testID?: string;
}

/** The idle home's big dish (spec §3 item 8): photo edge to edge, name with the daypart tag, «restaurant · price · minutes», «ضيفه للسلة». */
export const BigDishCard = memo(function BigDishCard({ dish, tag, onAdd, onPress, testID }: BigDishCardProps) {
  const theme = useTheme();
  return (
    <HomeCard testID={testID} style={{ overflow: 'hidden' }}>
      <HomePress accessibilityLabel={dishA11y(dish)} onPress={onPress}>
        <Picture picture={dish.picture} name={dish.name} seed={dish.id} width="100%" height={188} radius={0} testID={testID} />
        <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[3], gap: theme.space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
            <Text variant="title" face="display" numberOfLines={2} style={{ flex: 1 }}>
              {dish.name}
            </Text>
            <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], marginTop: 3 }}>
              <Text variant="footnote" weight={600} color="textMuted" compact>
                {tag}
              </Text>
            </View>
          </View>
          <DishMeta dish={dish} withMinutes />
        </View>
      </HomePress>
      <View style={{ padding: theme.space[4], paddingTop: theme.space[3] }}>
        <CardButton label={t('home.dish_add')} a11y={t('home.dish_add_a11y', { dish: dish.name })} onPress={onAdd} testID={testID ? `${testID}-add` : undefined} />
      </View>
    </HomeCard>
  );
});

export interface CompactDishProps {
  dish: HomeCardDish;
  onAdd: () => void;
  onPress?: () => void;
  testID?: string;
}

/** The compact dish row during an order (spec §3 item 8): photo, name, «restaurant · price», round +. */
export const CompactDish = memo(function CompactDish({ dish, onAdd, onPress, testID }: CompactDishProps) {
  const theme = useTheme();
  return (
    <HomeCard testID={testID} style={{ padding: theme.space[2], paddingEnd: theme.space[3], flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <HomePress accessibilityLabel={dishA11y(dish)} onPress={onPress} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Picture picture={dish.picture} name={dish.name} seed={dish.id} width={64} height={64} radius={theme.radius.lg} testID={testID} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" face="display" numberOfLines={2}>
            {dish.name}
          </Text>
          <DishMeta dish={dish} withMinutes={false} />
        </View>
      </HomePress>
      <HomePress
        accessibilityLabel={t('home.dish_add_a11y', { dish: dish.name })}
        onPress={onAdd}
        guardMs={GUARD_MS}
        testID={testID ? `${testID}-add` : undefined}
        style={{ width: theme.hitTarget, height: theme.hitTarget, borderRadius: theme.hitTarget / 2, borderWidth: 1.5, borderColor: theme.colors.selectedBorder, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="plus" size={22} color="accentText" strokeWidth={2.25} />
      </HomePress>
    </HomeCard>
  );
});

// ─── «طلبك المعتاد» ──────────────────────────────────────────────────────────────────────────────

export interface UsualCardProps {
  restaurant: string;
  /** The items, already joined («تمن وقيمة · لبن»). */
  items: string;
  /** Last time's total in dinars (the server prices the new order). */
  price: number;
  picture?: DishPicture;
  /** Friday wording («مثل كل جمعة»). */
  friday: boolean;
  onReorder: () => void;
  onPress?: () => void;
  testID?: string;
}

/**
 * «طلبك المعتاد» as one slim strip (audit round 2: the regular's main job sits right under the map): photo,
 * the label, restaurant + items, the price, and the orange «اطلبه». One tap orders once.
 */
export const UsualCard = memo(function UsualCard({ restaurant, items, price, picture, friday, onReorder, onPress, testID }: UsualCardProps) {
  const theme = useTheme();
  const look = useHomeLook();
  const title = t(friday ? 'home.usual_friday' : 'home.usual_title');
  const line = t('home.usual_line', { restaurant, items });
  return (
    <HomeCard testID={testID} style={{ padding: theme.space[2], paddingEnd: theme.space[3], flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <HomePress accessibilityLabel={t('home.usual_a11y', { title, line, price: iqd(price) })} onPress={onPress} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Picture picture={picture} name={items} seed={restaurant} width={56} height={56} radius={theme.radius.lg} testID={testID} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="footnote" weight={600} color="textMuted" compact>
            {title}
          </Text>
          <Text variant="label" weight={700} face="display" numberOfLines={2}>
            {line}
          </Text>
          <Text variant="label" weight={700} face="display" color={look.price} compact>
            {iqd(price)}
          </Text>
        </View>
      </HomePress>
      <CardButton label={t('home.usual_go')} a11y={t('home.usual_go_a11y', { restaurant })} onPress={onReorder} filled compact testID={testID ? `${testID}-reorder` : undefined} />
    </HomeCard>
  );
});

// ─── Restaurant ──────────────────────────────────────────────────────────────────────────────────

export interface RestaurantCardProps {
  name: string;
  /** 0 = no ratings yet («جديد»). */
  rating: number;
  minutes: number;
  /** Delivery fee in dinars from the server; 0 = free. */
  fee: number;
  picture?: DishPicture;
  /** Card width in the row (the row scrolls sideways). */
  width?: number;
  onPress?: () => void;
  testID?: string;
}

/** A restaurant in «مفتوح هسة» (spec §3 item 10): photo edge to edge, full name up to 2 lines, star + rating · minutes, fee. */
export const RestaurantCard = memo(function RestaurantCard({ name, rating, minutes, fee, picture, width = 228, onPress, testID }: RestaurantCardProps) {
  const theme = useTheme();
  const feeText = fee > 0 ? t('list.fee', { amount: ltr(formatAmount(fee)) }) : t('list.fee_free');
  const stars = rating > 0 ? rating.toFixed(1) : t('home.rating_new');
  return (
    <HomePress accessibilityLabel={rating > 0 ? t('home.rest_a11y', { name, rating: stars, minutes: mins(minutes), fee: feeText }) : t('home.rest_new_a11y', { name, minutes: mins(minutes), fee: feeText })} onPress={onPress} testID={testID} style={{ width }}>
      <HomeCard style={{ overflow: 'hidden', flex: 1 }}>
        <Picture picture={picture} name={name} seed={name} width="100%" height={128} radius={0} testID={testID} />
        <View style={{ padding: theme.space[3], paddingTop: theme.space[2], gap: 2 }}>
          <Text variant="bodyStrong" face="display" numberOfLines={2}>
            {name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {/* The theme's star: orange with an ink outline in sage (orange alone fails there, §4). */}
            {rating > 0 ? <Icon name="star" size={14} color="starOutline" fillColor="star" filled strokeWidth={1.25} /> : null}
            <Text variant="footnote" weight={700} tabular compact>
              {stars}
            </Text>
            <Text variant="footnote" color="textMuted" compact>
              ·
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

/** The category chips under «مفتوح هسة»: 44 tall, a sideways row, selected = the theme's selected fill + check. */
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
            checked={on}
            haptic="selection"
            onPress={() => onSelect(on ? null : c.id)}
            testID={testID ? `${testID}-${c.id}` : undefined}
            style={{
              minHeight: theme.hitTarget,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: theme.space[4],
              borderRadius: theme.radius.pill,
              backgroundColor: on ? theme.colors.selected : look.card.fill,
              boxShadow: on ? undefined : (look.card.shadow ?? undefined),
            }}
          >
            {on ? <Icon name="check" size={16} color="onSelected" strokeWidth={2.5} /> : null}
            <Text variant="label" weight={on ? 700 : 500} color={on ? 'onSelected' : 'text'} compact>
              {c.label}
            </Text>
          </HomePress>
        );
      })}
    </ScrollView>
  );
}
