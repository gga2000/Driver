import { memo } from 'react';
import { Pressable, View } from 'react-native';
import type { MenuItem } from '@driver/contracts';
import { Icon, Text, useTheme } from '@driver/ui';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { useItemCount } from '@/features/food/cart-store';
import { servesCopy } from '@/features/food/portions';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { aheadCopy, platesOf, slotWhen } from './format';
import { PlateDots, PortionPill, usePom } from './parts';

const THUMB = 84;

export interface HomeDishActions {
  open: (item: MenuItem) => void;
  add: (item: MenuItem) => void;
  remove: (item: MenuItem) => void;
  reserve: (item: MenuItem) => void;
}

/**
 * One home dish (v3): her photo, the name with its portion beside it, her line under it, then how it
 * sells — plates left as small plates for a ready dish, the next free time and how far ahead to book
 * for a reserve one. A ready dish adds with «+» up to the plates left; a reserve dish opens the sheet.
 */
export const HomeDishRow = memo(function HomeDishRow({ merchantId, item, now, actions, closed }: { merchantId: string; item: MenuItem; now: Date; actions: HomeDishActions; closed: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const pom = usePom();
  const inCart = useItemCount(merchantId, item.id);
  const home = item.home;
  const serves = servesCopy(item.serves, locale);
  const portion = [serves ? t(serves.key, 'params' in serves ? serves.params : undefined) : null, item.portion ?? null].filter(Boolean).join(' · ');
  const reserve = home?.mode === 'reserve';
  const out = !item.available;

  let status: React.ReactNode = null;
  if (home?.mode === 'ready') {
    const p = platesOf(home);
    status =
      home.cooked === null && home.left === 0 ? (
        <Text variant="caption" color="textMuted" testID={`home-dish-status-${item.id}`}>
          {t('home_food.not_cooked')}
        </Text>
      ) : (
        <PlateDots testID={`home-dish-status-${item.id}`} total={p.dots && p.left > 0 ? p.total : 0} left={p.left} label={p.left === 0 ? t('home_food.sold_out') : t('home_food.left', { n: p.left })} />
      );
  } else if (home?.mode === 'reserve') {
    const ahead = aheadCopy(home.aheadMin);
    const when = home.next ? slotWhen(home.next.at, now) : null;
    status = (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} testID={`home-dish-status-${item.id}`}>
        <Icon name="clock" size={15} color={when ? pom.ink : 'textMuted'} />
        <Text variant="caption" weight={700} color={when ? pom.ink : 'textMuted'} tabular>
          {when ? t('home_food.next_slot', when) : t('home_food.week_full')}
        </Text>
        {ahead && when ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {t(ahead.key, ahead.params)}
          </Text>
        ) : null}
      </View>
    );
  }

  const left = home?.mode === 'ready' ? home.left : 0;
  return (
    <Pressable
      testID={`home-dish-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}، ${iqd(item.priceIqd, { locale })}`}
      onPress={() => (reserve ? actions.reserve(item) : actions.open(item))}
      style={({ pressed }) => ({ flexDirection: 'row', gap: theme.space[3], paddingVertical: theme.space[3], opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ width: THUMB, height: THUMB, borderRadius: theme.radius.xl, overflow: 'hidden', opacity: out ? 0.55 : 1 }}>
        <FoodArt {...artOf(item)} photoUrl={item.photoUrl} />
      </View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Text variant="bodyStrong" face="display" style={{ fontSize: 17, flexShrink: 1 }} color={out ? 'textMuted' : 'text'}>
            {item.name}
          </Text>
          {portion ? <PortionPill label={portion} /> : null}
        </View>
        {item.description ? (
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {item.description}
          </Text>
        ) : null}
        <View style={{ marginTop: 2 }}>{status}</View>
      </View>
      <View style={{ alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2], width: 96 }}>
        <Text variant="label" weight={700} tabular color={out ? 'textMuted' : 'text'}>
          {iqd(item.priceIqd, { locale })}
        </Text>
        {closed && !reserve ? null : reserve ? (
          out ? null : (
            <Pressable
              testID={`home-reserve-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={t('home_food.reserve_a11y', { name: item.name })}
              onPress={() => actions.reserve(item)}
              hitSlop={4}
              style={({ pressed }) => ({ minHeight: 44, minWidth: 72, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: pom.fill, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? pom.wash : 'transparent' })}
            >
              <Text variant="label" weight={700} color={pom.ink} compact>
                {t('home_food.reserve')}
              </Text>
            </Pressable>
          )
        ) : out ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
            {inCart > 0 ? (
              <>
                <Round icon="minus" label={t('cart.remove_item', { name: item.name })} onPress={() => actions.remove(item)} tone="soft" testID={`home-minus-${item.id}`} />
                <Text variant="label" weight={700} tabular style={{ minWidth: 18, textAlign: 'center' }} testID={`home-count-${item.id}`}>
                  {String(inCart)}
                </Text>
              </>
            ) : null}
            <Round icon="plus" label={t('restaurant.add_item', { name: item.name })} onPress={() => actions.add(item)} disabled={inCart >= left} testID={`home-add-${item.id}`} />
          </View>
        )}
      </View>
    </Pressable>
  );
});

function Round({ icon, label, onPress, disabled, tone = 'fill', testID }: { icon: 'plus' | 'minus'; label: string; onPress: () => void; disabled?: boolean; tone?: 'fill' | 'soft'; testID?: string }) {
  const theme = useTheme();
  const pom = usePom();
  const fill = tone === 'fill';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => {
        theme.haptic('light');
        onPress();
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: fill ? pom.fill : pom.wash,
        opacity: disabled ? theme.state.disabledOpacity : pressed ? 0.85 : 1,
      })}
    >
      <Icon name={icon} size={20} color={fill ? pom.on : pom.ink} />
    </Pressable>
  );
}
