import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';
import { t } from '@driver/i18n';
import { DishDrawing } from '../art/dishes';
import { dishLook, motifForDish } from '../art/dish-motif';
import { Text } from '../components/Text';
import { formatAmount } from '../format';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { useHomeLook } from './look';
import { DishPhoto, type DishPicture } from './panels';

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

const iqd = (n: number) => t('unit.iqd', { amount: formatAmount(n) });
const mins = (n: number) => t('live_map.minutes', { n });
/** Where the price sits inside «restaurant · price · minutes», so it can wear its own colour. */
const MARK = '\u2063';

/**
 * The page card every home section sits in (spec §12.1): the theme's surface with the home edge, one
 * layout in both themes.
 */
function PageCard({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View testID={testID} style={[{ backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: look.edge, borderRadius: theme.radius.xl, overflow: 'hidden' }, style]}>
      {children}
    </View>
  );
}

/**
 * A photo, or the designed fallback when there is none (spec §8 "a designed fallback when a photo is
 * missing"): the dish's own cut-out drawing on the board's flat tile, never an empty grey box.
 */
function Picture({ picture, name, seed, width, height, radius, testID }: { picture?: DishPicture; name: string; seed: string; width: number | `${number}%`; height: number; radius: number; testID?: string }) {
  const look = useHomeLook();
  if (picture) return <DishPhoto picture={picture} size={{ width, height }} radius={radius} />;
  const side = Math.min(height, typeof width === 'number' ? width : height) * 0.92;
  return (
    <View testID={testID ? `${testID}-fallback` : undefined} accessible={false} style={{ width, height, borderRadius: radius, backgroundColor: look.board.tile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <Svg width={side} height={side} viewBox="0 0 200 200">
        <DishDrawing kind={motifForDish(name)} look={dishLook(seed)} window={false} />
      </Svg>
    </View>
  );
}

/** The full-width outline button on a card: ink on sage, orange at night (§4: orange is the night's action colour). */
function OutlineButton({ label, onPress, accessibilityLabel, testID }: { label: string; onPress: () => void; accessibilityLabel?: string; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={() => {
        theme.haptic('light');
        onPress();
      }}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: theme.radius.pill,
        borderWidth: 1.5,
        borderColor: theme.colors.selectedBorder,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: theme.space[4],
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text variant="bodyStrong" face="display" color="accentText" compact>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Dish ────────────────────────────────────────────────────────────────────────────────────────

export interface BigDishCardProps {
  dish: HomeCardDish;
  /** The daypart tag («للعشا», `home.band.*`). */
  tag: string;
  onAdd: () => void;
  onPress?: () => void;
  testID?: string;
}

/** The idle home's big dish (spec §3 item 8): daylight photo, daypart tag, name, «restaurant · price · minutes», «ضيفه للسلة». */
export function BigDishCard({ dish, tag, onAdd, onPress, testID }: BigDishCardProps) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <PageCard testID={testID} style={{ padding: theme.space[2] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.dish_card_a11y', { dish: dish.name, restaurant: dish.restaurant, price: iqd(dish.price), minutes: mins(dish.minutes) })}
        onPress={onPress}
        disabled={!onPress}
      >
        <Picture picture={dish.picture} name={dish.name} seed={dish.id} width="100%" height={176} radius={theme.radius.lg} testID={testID} />
        <View style={{ paddingHorizontal: theme.space[2], paddingTop: theme.space[3], gap: theme.space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
            <Text variant="title" face="display" numberOfLines={2} style={{ flex: 1 }}>
              {dish.name}
            </Text>
            <View style={{ borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 2, marginTop: 4 }}>
              <Text variant="footnote" color="textMuted" compact>
                {tag}
              </Text>
            </View>
          </View>
          <Text variant="label" color="textMuted" numberOfLines={2}>
            {t('home.dish_meta', { restaurant: dish.restaurant, price: MARK, minutes: mins(dish.minutes) })
              .split(MARK)
              .flatMap((part, i) =>
                i === 0
                  ? [part]
                  : [
                      <Text key="p" variant="label" weight={700} face="display" color={look.board.fact}>
                        {iqd(dish.price)}
                      </Text>,
                      part,
                    ],
              )}
          </Text>
        </View>
      </Pressable>
      <View style={{ padding: theme.space[2], paddingTop: theme.space[3] }}>
        <OutlineButton label={t('home.dish_add')} accessibilityLabel={t('home.dish_add_a11y', { dish: dish.name })} onPress={onAdd} testID={testID ? `${testID}-add` : undefined} />
      </View>
    </PageCard>
  );
}

export interface CompactDishProps {
  dish: HomeCardDish;
  onAdd: () => void;
  onPress?: () => void;
  testID?: string;
}

/** The compact dish row during an order (spec §3 item 8): photo, name, «restaurant · price», round +. */
export function CompactDish({ dish, onAdd, onPress, testID }: CompactDishProps) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <PageCard testID={testID} style={{ padding: theme.space[2], flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.dish_card_a11y', { dish: dish.name, restaurant: dish.restaurant, price: iqd(dish.price), minutes: mins(dish.minutes) })}
        onPress={onPress}
        disabled={!onPress}
        style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}
      >
        <Picture picture={dish.picture} name={dish.name} seed={dish.id} width={64} height={64} radius={theme.radius.lg} testID={testID} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" face="display" numberOfLines={2}>
            {dish.name}
          </Text>
          <Text variant="label" color="textMuted" numberOfLines={1}>
            {dish.restaurant} ·{' '}
            <Text variant="label" weight={700} face="display" color={look.board.fact}>
              {iqd(dish.price)}
            </Text>
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.dish_add_a11y', { dish: dish.name })}
        onPress={() => {
          theme.haptic('light');
          onAdd();
        }}
        testID={testID ? `${testID}-add` : undefined}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          borderWidth: 1.5,
          borderColor: theme.colors.selectedBorder,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Icon name="plus" size={22} color="accentText" strokeWidth={2.25} />
      </Pressable>
    </PageCard>
  );
}

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

/** «طلبك المعتاد» (spec §3 item 9): photo, restaurant + items on one line, price on the next, «اطلب نفس الطلب». */
export function UsualCard({ restaurant, items, price, picture, friday, onReorder, onPress, testID }: UsualCardProps) {
  const theme = useTheme();
  const look = useHomeLook();
  const line = t('home.usual_line', { restaurant, items });
  return (
    <PageCard testID={testID} style={{ padding: theme.space[3], gap: theme.space[3] }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t(friday ? 'home.usual_friday' : 'home.usual_title')}، ${line}، ${iqd(price)}`} onPress={onPress} disabled={!onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Picture picture={picture} name={items} seed={restaurant} width={72} height={72} radius={theme.radius.lg} testID={testID} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="footnote" color="textMuted" compact>
            {t(friday ? 'home.usual_friday' : 'home.usual_title')}
          </Text>
          <Text variant="bodyStrong" face="display" numberOfLines={1}>
            {line}
          </Text>
          <Text variant="bodyStrong" face="display" color={look.board.fact} compact>
            {iqd(price)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          theme.haptic('light');
          onReorder();
        }}
        testID={testID ? `${testID}-reorder` : undefined}
        style={({ pressed }) => ({ minHeight: 48, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
      >
        <Text variant="bodyStrong" face="display" color="onAccent" compact>
          {t('home.reorder')}
        </Text>
      </Pressable>
    </PageCard>
  );
}

// ─── Restaurant ──────────────────────────────────────────────────────────────────────────────────

export interface RestaurantCardProps {
  name: string;
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

/** A restaurant in «مفتوح هسة» (spec §3 item 10): photo, full name up to 2 lines, star + rating, minutes, fee. */
export function RestaurantCard({ name, rating, minutes, fee, picture, width = 228, onPress, testID }: RestaurantCardProps) {
  const theme = useTheme();
  const feeText = fee > 0 ? t('list.fee', { amount: formatAmount(fee) }) : t('list.fee_free');
  const stars = rating.toFixed(1);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.rest_a11y', { name, rating: stars, minutes: mins(minutes), fee: feeText })}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({ width, opacity: pressed ? 0.9 : 1 })}
    >
      <PageCard style={{ padding: theme.space[2], gap: theme.space[2], flex: 1 }}>
        <Picture picture={picture} name={name} seed={name} width="100%" height={124} radius={theme.radius.lg} testID={testID} />
        <View style={{ paddingHorizontal: theme.space[1], paddingBottom: theme.space[1], gap: 2 }}>
          <Text variant="bodyStrong" face="display" numberOfLines={2}>
            {name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {/* Light: a forest star (orange fails on the sage card, §4); night: the orange star. */}
            <Icon name="star" size={14} color="selected" filled />
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
      </PageCard>
    </Pressable>
  );
}

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
  testID?: string;
}

/** The category chips under «مفتوح هسة»: 44 tall, a sideways row, selected = the theme's selected fill + check. */
export function HomeChips({ chips, selected, onSelect, testID }: HomeChipsProps) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID} contentContainerStyle={{ gap: theme.space[2], paddingHorizontal: theme.space[4] }} style={{ marginHorizontal: -theme.space[4] }}>
      {chips.map((c) => {
        const on = c.id === selected;
        return (
          <Pressable
            key={c.id}
            accessibilityRole="radio"
            aria-checked={on}
            onPress={() => {
              theme.haptic('selection');
              onSelect(on ? null : c.id);
            }}
            testID={testID ? `${testID}-${c.id}` : undefined}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: theme.space[4],
              borderRadius: theme.radius.pill,
              borderWidth: 1,
              borderColor: on ? theme.colors.selectedBorder : look.edge,
              backgroundColor: on ? theme.colors.selected : theme.colors.surface,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {on ? <Icon name="check" size={16} color="onSelected" strokeWidth={2.5} /> : null}
            <Text variant="label" weight={on ? 700 : 500} color={on ? 'onSelected' : 'text'} compact>
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
