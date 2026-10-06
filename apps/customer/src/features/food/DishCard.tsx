import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import { dealLinePrice, type MenuItem } from '@driver/contracts';
import { IconButton, StatusPill, Stepper, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { FoodArt, artOf, type DishArt } from './FoodArt';
import { measure, type Rect } from './FlyToCart';
import { canQuickAdd, fromPrice } from './modifiers';
import { servesCopy } from './portions';

const LABEL_KEY = { spicy: 'item.label_spicy', new: 'item.label_new', family: 'item.label_family' } as const;

export interface DishCardProps {
  item: MenuItem;
  /** How many of this dish are already in the cart. */
  inCart: number;
  /** Kitchen closed: browse only. */
  disabled?: boolean;
  onOpen: () => void;
  /**
   * One-tap add (dishes without a required choice), with where its picture sits on screen so it can
   * fly to the cart bar (joy o1); otherwise the + opens the sheet.
   */
  onQuickAdd: (from: Rect | null) => void;
  /** One less of a quick-add dish (the in-place stepper's −); the last one removes it. */
  onDecrement?: () => void;
  /** Its drawing in the menu (`dishArt`: never the same as the row above); its own otherwise. */
  art?: DishArt;
}

/**
 * A menu row: name, description, price, and a thumbnail with the + button on its corner. Under a
 * live percent deal with no minimum (f10, the server's `item.deal`) the price is the deal price in
 * the success colour with the menu price struck through, as the cart will charge it.
 */
export function DishCard({ item, inCart, disabled, onOpen, onQuickAdd, onDecrement, art }: DishCardProps) {
  const theme = useTheme();
  const thumb = useRef<View>(null);
  const t = useT();
  const locale = useLocale();
  const price = fromPrice(item);
  const dealPrice = item.deal ? dealLinePrice(price.amount, item.deal) : null;
  const soldOut = !item.available;
  const quick = canQuickAdd(item);
  const serves = servesCopy(item.serves, locale);
  const servesText = serves ? t(serves.key, 'params' in serves ? serves.params : undefined) : null;
  return (
    <Pressable
      testID={`dish-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={
        dealPrice !== null && dealPrice < price.amount
          ? t('restaurant.deal_price_a11y', { name: item.name, amount: amountParam(dealPrice), was: amountParam(price.amount) })
          : `${item.name}، ${iqd(price.amount, { locale })}`
      }
      onPress={onOpen}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: theme.space[3],
        paddingVertical: theme.space[4],
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: soldOut ? 0.55 : pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {item.name}
        </Text>
        {item.description ? (
          <Text variant="footnote" color="textMuted" numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        {/* o8 / o3: the kitchen's own labels and how many the dish feeds, when it says. */}
        {(item.labels?.length ?? 0) > 0 || item.serves ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[1] }} testID={`dish-tags-${item.id}`}>
            {(item.labels ?? []).map((l) => (
              <View key={l} style={{ paddingHorizontal: theme.space[2], paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: l === 'spicy' ? theme.colors.dangerTint : l === 'new' ? theme.colors.deal : theme.colors.surfaceSunken }}>
                <Text variant="caption" weight={600} color={l === 'spicy' ? 'dangerText' : l === 'new' ? 'onDeal' : 'text'}>
                  {t(LABEL_KEY[l])}
                </Text>
              </View>
            ))}
            {servesText ? (
              <View style={{ paddingHorizontal: theme.space[2], paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken }}>
                <Text variant="caption" color="textMuted">
                  {servesText}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: 2 }}>
          {dealPrice !== null && dealPrice < price.amount ? (
            <>
              <Text variant="label" weight={700} color="successText" tabular testID={`dish-deal-${item.id}`}>
                {price.varies ? t('restaurant.price_from', { amount: amountParam(dealPrice) }) : iqd(dealPrice, { locale })}
              </Text>
              <Text variant="caption" color="textMuted" tabular style={{ textDecorationLine: 'line-through' }}>
                {iqd(price.amount, { locale })}
              </Text>
            </>
          ) : (
            <Text variant="label" weight={600} tabular>
              {price.varies ? t('restaurant.price_from', { amount: amountParam(price.amount) }) : iqd(price.amount, { locale })}
            </Text>
          )}
          {soldOut ? <StatusPill size="sm" tone="neutral" label={t('item.sold_out')} /> : null}
        </View>
      </View>
      <View style={{ width: 96, height: 96 }}>
        <View ref={thumb} collapsable={false} style={{ width: 96, height: 96, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
          <FoodArt {...(art ?? artOf(item))} photoUrl={item.photoUrl} />
        </View>
        {!soldOut && !disabled && quick && inCart > 0 && onDecrement ? (
          // o1: the + became a neutral stepper in place; − takes one off, + adds (and flies) one more.
          <View style={{ position: 'absolute', bottom: -10, start: -14, end: -14, alignItems: 'center' }} testID={`dish-stepper-${item.id}`}>
            <Stepper
              size="sm"
              value={inCart}
              min={0}
              max={99}
              accessibilityLabel={t('restaurant.qty_label', { name: item.name })}
              onChange={(next) => {
                if (next < inCart) onDecrement();
                else void measure(thumb).then(onQuickAdd);
              }}
              style={{ alignSelf: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}
            />
          </View>
        ) : !soldOut && !disabled ? (
          <IconButton
            testID={`dish-add-${item.id}`}
            icon="plus"
            size={36}
            variant={inCart > 0 ? 'accent' : 'outline'}
            accessibilityLabel={t('restaurant.add_item', { name: item.name })}
            onPress={quick ? () => void measure(thumb).then(onQuickAdd) : onOpen}
            style={{ position: 'absolute', bottom: -6, start: -6 }}
          />
        ) : null}
        {inCart > 0 && !(quick && onDecrement && !soldOut && !disabled) ? (
          <View
            style={{
              position: 'absolute',
              top: -6,
              end: -6,
              minWidth: 24,
              height: 24,
              paddingHorizontal: 6,
              borderRadius: 12,
              backgroundColor: theme.colors.text,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="caption" weight={700} color="bg" tabular>
              {inCart}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
