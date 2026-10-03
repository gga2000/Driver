import { memo } from 'react';
import { Pressable, View } from 'react-native';
import type { AdminMenuItem } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { itemStatus } from './logic';
import { Pill, Thumb, Toggle } from './parts';

export interface MenuItemRowProps {
  item: AdminMenuItem;
  now: number;
  wide: boolean;
  last?: boolean;
  onOpen: (item: AdminMenuItem) => void;
  onToggle: (item: AdminMenuItem, on: boolean) => void;
  onSoldOut: (item: AdminMenuItem) => void;
}

/**
 * One dish: photo, name, price and what the customer can do with it right now. The switch is "on the
 * menu or not"; "خلص اليوم" takes it off until midnight and it comes back by itself.
 */
export const MenuItemRow = memo(function MenuItemRow({ item, now, wide, last, onOpen, onToggle, onSoldOut }: MenuItemRowProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const status = itemStatus(item, now);
  const on = status === 'on';
  const options = item.modifierGroups.length;
  const soldOutPill = on ? <Pill testID={`menu-soldout-${item.id}`} size="sm" outline label={t('merchant.menu.sold_out_today')} glyph="hourglass" onPress={() => onSoldOut(item)} /> : null;
  const statePill =
    status === 'sold_out_today' ? (
      <Pill size="sm" tone="warning" dot label={t('merchant.menu.back_tomorrow')} />
    ) : status === 'off' ? (
      <Pill size="sm" tone="neutral" dot label={t('merchant.menu.off')} />
    ) : null;
  return (
    <View
      testID={`menu-item-${item.id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingVertical: theme.space[3],
        paddingHorizontal: theme.space[4],
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('merchant.menu.edit_item', { name: item.nameAr })}
        onPress={() => onOpen(item)}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], opacity: pressed ? 0.7 : 1 })}
      >
        <Thumb url={item.photoUrl} name={item.nameAr} size={wide ? 64 : 56} dim={!on} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" color={on ? 'text' : 'textMuted'} numberOfLines={1} style={{ fontSize: 16 }}>
            {item.nameAr}
          </Text>
          {wide && item.description ? (
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: theme.space[2], rowGap: 4 }}>
            <Text variant="label" weight={700} color={on ? 'text' : 'textMuted'} tabular>
              {iqd(item.priceIqd, { locale })}
            </Text>
            {options > 0 ? (
              <Text variant="caption" color="textMuted">
                {t('merchant.menu.options_count', { count: options })}
              </Text>
            ) : null}
            {statePill}
            {!wide ? soldOutPill : null}
          </View>
        </View>
      </Pressable>
      {wide ? soldOutPill : null}
      <Toggle testID={`menu-toggle-${item.id}`} label={t('merchant.menu.toggle_label', { name: item.nameAr })} value={on} onChange={(v) => onToggle(item, v)} />
    </View>
  );
});
