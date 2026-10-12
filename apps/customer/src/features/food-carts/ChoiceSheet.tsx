import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { CartDish } from '@driver/contracts';
import { Icon, ModalSheet, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { chosen, needed, picksOk, single, startPicks, toggle, unitPrice, type ChosenOption } from './choices';
import { cartPalette } from './palette';

/**
 * «شلون تريده؟» (Ali 2026-10-12): a cart dish with sizes or extras opens this before it goes on the
 * order. Each size shows its whole price («صحن كامل · 5,000»), each extra what it adds («بيض +500»,
 * «حار» with nothing). The button carries the price with the picks and adds one.
 */
export function ChoiceSheet({ dish, onClose, onAdd }: { dish: CartDish | null; onClose: () => void; onAdd: (dish: CartDish, choices: ChosenOption[]) => void }) {
  if (!dish) return null;
  return <Sheet key={dish.itemId} dish={dish} onClose={onClose} onAdd={onAdd} />;
}

function Sheet({ dish, onClose, onAdd }: { dish: CartDish; onClose: () => void; onAdd: (dish: CartDish, choices: ChosenOption[]) => void }) {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const t = useT();
  const [picked, setPicked] = useState(() => startPicks(dish));
  const ok = picksOk(dish, picked);
  const price = unitPrice(dish, chosen(dish, picked));

  return (
    <ModalSheet
      visible
      onClose={onClose}
      title={dish.nameAr}
      {...(dish.description ? { subtitle: dish.description } : {})}
      testID="cart-choice"
      footer={
        <Pressable
          testID="cart-choice-add"
          accessibilityRole="button"
          accessibilityState={{ disabled: !ok }}
          disabled={!ok}
          onPress={() => {
            theme.haptic('medium');
            onAdd(dish, chosen(dish, picked));
          }}
          style={({ pressed }) => ({ minHeight: 60, borderRadius: 30, paddingHorizontal: theme.space[5], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: ok ? pal.fill : theme.colors.surfaceSunken, transform: [{ scale: pressed && !theme.reduceMotion ? 0.98 : 1 }] })}
        >
          <Text variant="title" face="display" tabular color={ok ? pal.on : 'textMuted'}>
            {t('carts.choice_add', { amount: amountParam(price) })}
          </Text>
          <Icon name="plus" size={22} color={ok ? pal.on : theme.colors.textMuted} />
        </Pressable>
      }
    >
      <View style={{ gap: theme.space[5] }}>
        {dish.groups.map((g) => {
          const one = single(g);
          return (
            <View key={g.id} style={{ gap: theme.space[2] }} accessibilityRole={one ? 'radiogroup' : undefined}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space[2] }}>
                <Text variant="section" face="display">
                  {g.nameAr}
                </Text>
                <Text variant="footnote" color="textMuted">
                  {one ? (needed(g) > 0 ? t('carts.choice_one') : t('carts.choice_maybe')) : t('carts.choice_any')}
                </Text>
              </View>
              {g.options.map((o) => {
                const on = (picked[g.id] ?? []).includes(o.id);
                const sizeRow = one && needed(g) > 0;
                const right = sizeRow ? amountParam(dish.priceIqd + o.priceIqd) : o.priceIqd > 0 ? `+${amountParam(o.priceIqd)}` : t('carts.choice_free');
                return (
                  <Pressable
                    key={o.id}
                    testID={`cart-choice-${o.id}`}
                    accessibilityRole={one ? 'radio' : 'checkbox'}
                    accessibilityState={{ checked: on, disabled: !o.available }}
                    disabled={!o.available}
                    onPress={() => {
                      theme.haptic('selection');
                      setPicked((p) => toggle(dish, p, g.id, o.id));
                    }}
                    style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], borderRadius: theme.radius.lg, borderWidth: on ? 2 : 1, borderColor: on ? pal.fill : theme.colors.border, backgroundColor: theme.colors.surface, opacity: o.available ? 1 : 0.45 }}
                  >
                    <View style={{ width: 24, height: 24, borderRadius: one ? 12 : 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? pal.fill : 'transparent', borderWidth: on ? 0 : 2, borderColor: theme.colors.borderStrong }}>
                      {on ? <Icon name="check" size={16} color={pal.on} /> : null}
                    </View>
                    <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                      {o.nameAr}
                    </Text>
                    <Text variant="body" color={sizeRow ? 'text' : 'textMuted'} tabular>
                      {o.available ? right : t('carts.dish_off')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
    </ModalSheet>
  );
}
