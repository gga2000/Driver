import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { MessageKey } from '@driver/i18n';
import { formatRange } from '@driver/i18n';
import { Button, Chip, ModalSheet, Skeleton, Stepper, Text, useTheme, useToast } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { addLine, cartMerchantOf, EMPTY_CART, TABLE, type CartState } from '@/features/food/cart';
import { cartStore, useCart } from '@/features/food/cart-store';
import { FoodArt, motifForDish } from '@/features/food/FoodArt';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useMenus } from './queries';
import { guestTray, mealTray, swapLine, TRAY_BUDGETS, TRAY_MOODS, type Tray, type TrayBudget, type TrayMood } from './tray';

export type TrayMode = 'meal' | 'guests';

/** The shops a tray is tried from, best first (the door's own «أحسن 3» order). */
const TRY_SHOPS = 3;
const THUMB = 52;

/**
 * «اختارلي» (k10) and «ضيوف جايين؟» (s2) on one sheet: how many people (and, for a meal, a rough budget
 * per person and what you feel like), then a whole tray from one shop — each piece with how many it
 * feeds, «بدّل» for another of the same kind, and «محل ثاني» to try the next of the door's best shops.
 * «حطها بالسلة» puts it in the cart as dishes «للسفرة»; the cart and checkout price it as always.
 */
export function TraySheet({ mode, shops, visible, onClose }: { mode: TrayMode; shops: readonly RestaurantSummary[]; visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const cart = useCart();
  const [people, setPeople] = useState(mode === 'guests' ? 8 : 2);
  const [budget, setBudget] = useState<TrayBudget>(null);
  const [mood, setMood] = useState<TrayMood | null>(null);
  const [shopIndex, setShopIndex] = useState(0);
  const [edited, setEdited] = useState<{ key: string; tray: Tray } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const tried = useMemo(() => shops.slice(0, TRY_SHOPS).map((s) => s.id), [shops]);
  const { menus, pending } = useMenus(visible ? tried : []);

  /** Every shop that can make this tray, in order. */
  const options = useMemo(
    () =>
      menus.flatMap((menu) => {
        if (!menu) return [];
        const tray = mode === 'guests' ? guestTray(menu.categories, people) : mealTray(menu.categories, { people, budget, mood });
        return tray && tray.lines.length > 0 ? [{ menu, tray }] : [];
      })
        // A shop with real sweets before one that only has ice cream (the order is otherwise the door's).
        .sort((a, b) => Number(a.tray.fallback ?? false) - Number(b.tray.fallback ?? false)),
    [menus, mode, people, budget, mood],
  );
  const current = options[shopIndex % Math.max(1, options.length)];
  const key = current ? `${current.menu.restaurant.id}|${people}|${budget}|${mood}` : '';
  const tray = edited && edited.key === key ? edited.tray : (current?.tray ?? null);
  const shop = current ? shops.find((s) => s.id === current.menu.restaurant.id) : undefined;

  const reset = () => {
    setEdited(null);
    setConfirmReplace(false);
  };

  const put = (replace: boolean) => {
    if (!current || !tray) return;
    const merchant = cartMerchantOf(current.menu.restaurant);
    const sameShop = cart.merchant?.id === merchant.id;
    if (!replace && !sameShop && cart.lines.length > 0) {
      setConfirmReplace(true);
      return;
    }
    let next: CartState = sameShop ? cart : EMPTY_CART;
    for (const l of tray.lines) {
      const res = addLine(next, merchant, { itemId: l.item.id, name: l.item.name, basePriceIqd: l.item.priceIqd, modifiers: l.version.modifiers, qty: l.qty, note: null, personId: TABLE });
      if (res.ok) next = res.cart;
    }
    cartStore.replaceCart(next);
    theme.haptic('success');
    toast.show({ message: t('tray.added', { shop: merchant.name }), tone: 'success', icon: 'cart' });
    onClose();
    router.push('/cart');
  };

  const time = shop ? (shop.etaMinMinutes !== null && shop.etaMaxMinutes !== null ? formatRange(shop.etaMinMinutes, shop.etaMaxMinutes, locale) : formatRange(shop.prepMinMinutes, shop.prepMaxMinutes, locale)) : null;

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={mode === 'guests' ? t('tray.title_guests') : t('tray.title_meal')}
      layout="sheet"
      sheetMaxWidth={MAX_CONTENT_WIDTH}
      closeLabel={t('action.close')}
      testID={`tray-sheet-${mode}`}
      footer={
        tray && current ? (
          confirmReplace ? (
            <View style={{ gap: theme.space[2] }} testID="tray-replace">
              <Text variant="label" weight={700}>
                {t('tray.replace_title', { shop: cart.merchant?.name ?? '' })}
              </Text>
              <Text variant="footnote" color="textMuted">
                {t('tray.replace_body')}
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                <Button variant="secondary" label={t('action.cancel')} onPress={() => setConfirmReplace(false)} style={{ flex: 1 }} />
                <Button testID="tray-replace-yes" label={t('tray.replace_yes')} onPress={() => put(true)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <Button testID="tray-add" size="lg" fullWidth icon="cart" label={`${t('tray.add')} · ${t('unit.iqd', { amount: amountParam(tray.totalIqd) })}`} onPress={() => put(false)} />
          )
        ) : undefined
      }
    >
      <View style={{ gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
          <Text variant="bodyStrong">{mode === 'guests' ? t('tray.guests') : t('tray.people')}</Text>
          <Stepper
            value={people}
            min={mode === 'guests' ? 2 : 1}
            max={mode === 'guests' ? 40 : 20}
            accessibilityLabel={t('tray.people_a11y')}
            onChange={(v) => {
              setPeople(v);
              reset();
            }}
          />
        </View>

        {mode === 'meal' ? (
          <>
            <Choices
              label={t('tray.budget')}
              options={TRAY_BUDGETS.map((b) => ({ key: String(b), label: b === null ? t('tray.budget_any') : t('tray.budget_amount', { amount: amountParam(b) }), on: budget === b, pick: () => setBudget(b) }))}
              onChange={reset}
            />
            <Choices
              label={t('tray.mood')}
              options={[
                { key: 'any', label: t('tray.mood_any'), on: mood === null, pick: () => setMood(null) },
                ...TRAY_MOODS.map((m) => ({ key: m, label: t(`tray.mood.${m}` as MessageKey), on: mood === m, pick: () => setMood(m) })),
              ]}
              onChange={reset}
            />
          </>
        ) : null}

        {pending && !current ? (
          <View style={{ gap: theme.space[2] }} accessibilityLabel={t('tray.loading')}>
            <Skeleton height={18} width="40%" />
            <Skeleton height={THUMB} />
            <Skeleton height={THUMB} />
          </View>
        ) : !tray || !current ? (
          <Text variant="body" color="textMuted" testID="tray-none">
            {t('tray.none')}
          </Text>
        ) : (
          <View style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }} testID="tray-result">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="title" numberOfLines={1}>
                  {t('tray.from', { shop: current.menu.restaurant.name })}
                </Text>
                <Text variant="footnote" color="textMuted" tabular>
                  {t('tray.serves', { n: tray.serves })}
                  {time ? ` · ${t('list.minutes', { range: time })}` : ''}
                </Text>
              </View>
              {options.length > 1 ? (
                <Button
                  testID="tray-other-shop"
                  size="sm"
                  variant="secondary"
                  label={t('tray.other_shop')}
                  onPress={() => {
                    setShopIndex((i) => i + 1);
                    reset();
                  }}
                />
              ) : null}
            </View>
            {tray.overBudget ? (
              <Text variant="footnote" color="warningText">
                {t('tray.over_budget')}
              </Text>
            ) : null}
            {tray.moodIgnored && mood ? (
              <Text variant="footnote" color="warningText">
                {t('tray.mood_ignored', { mood: t(`tray.mood.${mood}` as MessageKey) })}
              </Text>
            ) : null}
            {tray.lines.map((l, i) => {
              const name = l.version.label ? t('tray.line_version', { name: l.item.name, version: l.version.label }) : l.item.name;
              return (
                <View key={`${l.item.id}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }} testID={`tray-line-${i}`}>
                  <View style={{ width: THUMB, height: THUMB, borderRadius: theme.radius.md, overflow: 'hidden' }}>
                    <FoodArt motif={motifForDish(l.item.name)} photoUrl={l.item.photoUrl} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text variant="label" weight={600} numberOfLines={2}>
                      {name}
                    </Text>
                    <Text variant="caption" color="textMuted" tabular>
                      {l.qty > 1 ? `${l.qty} × ` : ''}
                      {t('unit.iqd', { amount: amountParam(l.version.priceIqd) })}
                    </Text>
                  </View>
                  <Button
                    testID={`tray-swap-${i}`}
                    size="sm"
                    variant="secondary"
                    icon="refresh"
                    label={t('tray.swap')}
                    accessibilityLabel={t('tray.swap_a11y', { name: l.item.name })}
                    onPress={() => {
                      theme.haptic('selection');
                      setEdited({ key, tray: swapLine(tray, i, current.menu.categories) });
                    }}
                  />
                </View>
              );
            })}
            <View style={{ gap: 2, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.space[3] }}>
              <Text variant="bodyStrong" tabular testID="tray-total">
                {t('tray.total', { amount: amountParam(tray.totalIqd) })}
              </Text>
              <Text variant="caption" color="textMuted">
                {mode === 'guests' && time ? t('tray.when_guests', { range: time }) : t('tray.total_hint')}
              </Text>
            </View>
          </View>
        )}
      </View>
    </ModalSheet>
  );
}

function Choices({ label, options, onChange }: { label: string; options: Array<{ key: string; label: string; on: boolean; pick: () => void }>; onChange: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" weight={600}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }} accessibilityRole="radiogroup">
        {options.map((o) => (
          <Chip
            key={o.key}
            role="radio"
            label={o.label}
            selected={o.on}
            onPress={() => {
              o.pick();
              onChange();
            }}
          />
        ))}
      </View>
    </View>
  );
}
