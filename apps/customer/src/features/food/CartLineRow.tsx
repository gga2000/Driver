import { useRef } from 'react';
import { View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Icon, Stepper, Text, stageOf, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { lineTotal, type CartLine } from './cart';
import { FoodArt, artOf } from './FoodArt';

/**
 * One cart line: name, choices and note, line price, quantity stepper (down to 0 removes) and a
 * swipe toward the end side that removes it (the cart offers undo). Under a restaurant deal the line
 * shows its price after the deal, the menu price struck through and what it saves (server figures).
 *
 * `tray` is the after-order redesign's basket (b1): the dish's picture on its plate, who it is for in
 * the subtitle, the row on the tray's tint, and savings in saffron (deals are saffron, never green).
 */
export function CartLineRow({
  line,
  onQty,
  onRemove,
  divider,
  savingIqd = 0,
  tray,
  who,
}: {
  line: CartLine;
  onQty: (qty: number) => void;
  onRemove: () => void;
  divider?: boolean;
  savingIqd?: number;
  tray?: boolean;
  /** The tray's subtitle names who the dish is for («سارة · بدون بصل»). */
  who?: string | null;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const ref = useRef<SwipeableMethods>(null);
  const action = () => (
    <View style={{ width: 96, backgroundColor: theme.colors.danger, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <Icon name="x" size={20} color="onDanger" strokeWidth={2.2} />
      <Text variant="caption" weight={600} color="onDanger">
        {t('cart.remove')}
      </Text>
    </View>
  );
  // The end side is the left in RTL: the row swipes toward the reading start to reveal it.
  const side = theme.isRTL ? { renderLeftActions: action } : { renderRightActions: action };
  return (
    <Swipeable
      ref={ref}
      friction={1.6}
      overshootFriction={8}
      {...side}
      onSwipeableOpen={() => {
        ref.current?.close();
        onRemove();
      }}
    >
      <View
        testID={`cart-line-${line.itemId}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          paddingVertical: theme.space[3],
          paddingHorizontal: theme.space[4],
          backgroundColor: theme.colors.surface,
          borderRadius: tray ? theme.radius.lg : 0,
          borderBottomWidth: divider && !tray ? 1 : 0,
          borderBottomColor: theme.colors.border,
        }}
      >
        {tray ? (
          <View style={{ width: 56, height: 56, borderRadius: theme.radius.md, overflow: 'hidden' }}>
            <FoodArt {...artOf({ id: line.itemId, name: line.name })} stage={stageOf(line.itemId, theme.decor.stages)} />
          </View>
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {line.name}
          </Text>
          {tray && (who || line.modifiers.length) ? (
            <Text variant="footnote" color="textMuted" numberOfLines={2}>
              {[who, ...line.modifiers.map((m) => m.name)].filter(Boolean).join(' · ')}
            </Text>
          ) : !tray && line.modifiers.length ? (
            <Text variant="footnote" color="textMuted" numberOfLines={2}>
              {line.modifiers.map((m) => m.name).join('، ')}
            </Text>
          ) : null}
          {line.note ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="chat" size={14} color="textMuted" />
              <Text variant="footnote" color="textMuted" numberOfLines={2} style={{ flexShrink: 1 }}>
                {line.note}
              </Text>
            </View>
          ) : null}
          {savingIqd > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[2], marginTop: 2 }} testID={`cart-line-saving-${line.itemId}`}>
              <Text variant="label" weight={700} color={tray ? 'accentText' : 'successText'} tabular>
                {iqd(lineTotal(line) - savingIqd, { locale })}
              </Text>
              <Text variant="caption" color="textMuted" tabular style={{ textDecorationLine: 'line-through' }}>
                {iqd(lineTotal(line), { locale })}
              </Text>
              <View style={{ backgroundColor: tray ? theme.colors.accentTint : theme.colors.successTint, borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text variant="caption" weight={600} color={tray ? 'accentText' : 'successText'} tabular>
                  {t('cart.line_saving', { amount: amountParam(savingIqd) })}
                </Text>
              </View>
            </View>
          ) : (
            <Text variant="label" weight={600} tabular style={{ marginTop: 2 }}>
              {iqd(lineTotal(line), { locale })}
            </Text>
          )}
        </View>
        <Stepper size="sm" value={line.qty} min={0} max={99} onChange={onQty} accessibilityLabel={`${t('item.qty')} · ${line.name}`} />
      </View>
    </Swipeable>
  );
}
