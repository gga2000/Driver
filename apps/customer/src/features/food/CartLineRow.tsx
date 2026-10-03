import { useRef } from 'react';
import { View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Icon, Stepper, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { lineTotal, type CartLine } from './cart';

/**
 * One cart line: name, choices and note, line price, quantity stepper (down to 0 removes) and a
 * swipe toward the end side that removes it (the cart offers undo).
 */
export function CartLineRow({ line, onQty, onRemove, divider }: { line: CartLine; onQty: (qty: number) => void; onRemove: () => void; divider?: boolean }) {
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
          borderBottomWidth: divider ? 1 : 0,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {line.name}
          </Text>
          {line.modifiers.length ? (
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
          <Text variant="label" weight={600} tabular style={{ marginTop: 2 }}>
            {iqd(lineTotal(line), { locale })}
          </Text>
        </View>
        <Stepper size="sm" value={line.qty} min={0} max={99} onChange={onQty} accessibilityLabel={`${t('item.qty')} · ${line.name}`} />
      </View>
    </Swipeable>
  );
}
