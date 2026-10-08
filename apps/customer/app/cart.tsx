import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import type { MenuItem } from '@driver/contracts';
import { Avatar, Button, Card, EmptyState, Icon, IconButton, PriceBreakdown, SketchScene, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { groupByPerson, itemsTotal, ME, minOrderShortfall, TABLE } from '@/features/food/cart';
import { CartLineRow } from '@/features/food/CartLineRow';
import { cartStore, useCart } from '@/features/food/cart-store';
import { checkoutTotals, lineSavings, otherDeals } from '@/features/food/checkout';
import { DealBadges } from '@/features/food/DealBadge';
import { DeliverToRow } from '@/features/food/DeliverToRow';
import { EarnPill } from '@/features/food/EarnPill';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { minOrderProgress } from '@/features/food/min-order';
import { MinOrderStrip } from '@/features/food/MinOrderStrip';
import { priceItems } from '@/features/food/price-lines';
import { quoteStop } from '@/features/food/stopped';
import { useCartQuote, useDeliverTo, useMenu, useOrderQuote } from '@/features/food/queries';
import { upsellItems } from '@/features/food/upsell';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { requireSignIn } from '@/lib/guest';
import { useProfile } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';
import { useUiSwitch } from '@/lib/ui-switches';
import { BasketScreen } from '@/features/food/BasketScreen';

/**
 * Cart (spec §3): one kitchen, lines grouped by person once more than one person is tagged, swipe or
 * step to 0 to remove (with undo), same-kitchen upsells, the minimum-order gap, and the live total
 * from `pricing.quote` — delivery and fees included, the same total checkout shows. The restaurant's
 * deal comes from the server (`orders.quote`): its badge, what each line saves, the discount line, and
 * how much more unlocks a deal with a minimum.
 */
export default function CartRoute() {
  // After-order redesign step 1 (the basket as a tray) ships beside this screen behind its switch.
  return useUiSwitch('basket_v2') ? <BasketScreen /> : <CartScreen />;
}

function CartScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const cart = useCart();
  const { name: myName } = useProfile();
  const { place, dropoff } = useDeliverTo();
  const quote = useCartQuote(cart, dropoff, false);
  const orderQuote = useOrderQuote(cart, dropoff, false);
  const menu = useMenu(cart.merchant?.id);
  const { grouped, groups } = groupByPerson(cart);
  // The total waits for the server's deal (or its failure) so it never jumps after it shows.
  const totals = quote.data && (orderQuote.data || orderQuote.isError) ? checkoutTotals(cart, quote.data, orderQuote.data) : null;
  const savings = lineSavings(cart, orderQuote.data);
  const nextDeal = orderQuote.data?.nextDeal ?? null;
  const deals = menu.data?.restaurant.deals ?? [];
  const shortfall = minOrderShortfall(cart);
  const progress = cart.merchant ? minOrderProgress(itemsTotal(cart), cart.merchant.minOrderIqd) : null;
  // J-D6: below the minimum the order can still go with the server's small-order fee (guests: the card's).
  const smallOrderFee = orderQuote.data?.smallOrder?.feeIqd ?? menu.data?.restaurant.smallOrderFeeIqd ?? 0;
  const upsell = useMemo(() => (menu.data ? upsellItems(menu.data.categories, cart, shortfall) : []), [menu.data, cart, shortfall]);
  const closed = menu.data ? !menu.data.restaurant.open : false;
  // A guest builds the cart freely; "كمّل الطلب" asks for the phone and comes back to checkout (C-18).
  const guest = !useSignedIn();

  if (!cart.merchant || cart.lines.length === 0) {
    return (
      <Screen edges={['bottom']} testID="cart">
        <EmptyState icon="cart" art={<SketchScene name="empty_cart" />} title={t('cart.empty')} body={t('cart.empty_hint')} action={{ label: t('shell.back_home'), onPress: () => (router.canDismiss() ? router.dismissAll() : router.replace('/')) }} />
      </Screen>
    );
  }
  const merchant = cart.merchant;

  const remove = (key: string) => {
    const removed = cartStore.remove(key);
    if (removed) toast.show({ message: t('cart.removed', { name: removed.line.name }), icon: 'x', action: { label: t('cart.undo'), onPress: () => cartStore.restore(removed) } });
  };
  const setQty = (key: string, qty: number) => (qty <= 0 ? remove(key) : cartStore.setQty(key, qty));
  const quickAdd = (item: MenuItem) => {
    const res = cartStore.add(merchant, { itemId: item.id, name: item.name, basePriceIqd: item.priceIqd, modifiers: [], qty: 1, note: null, personId: ME });
    if (res.ok) toast.show({ message: t('restaurant.added', { name: item.name }), tone: 'success', icon: 'cart' });
  };

  // Below the minimum is allowed since J-D6 (with the small-order fee in the total), so only a missing price blocks.
  // REL-16: a service ops paused, or a zone that is full, is a calm notice and the button waits.
  const stopped = quoteStop(orderQuote.error ?? quote.error, t, locale);
  const canCheckout = !stopped && (guest || Boolean(totals));
  const footer = (
    <View style={{ gap: theme.space[3] }}>
      {stopped ? (
        <Card elevation={0} testID="cart-stopped">
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }} accessibilityLiveRegion="polite">
            <Icon name="clock" size={18} color="warningText" />
            <Text variant="footnote" color="warningText" style={{ flex: 1 }}>
              {stopped}
            </Text>
          </View>
        </Card>
      ) : null}
      {progress ? <MinOrderStrip progress={progress} minOrderIqd={merchant.minOrderIqd} feeIqd={smallOrderFee} /> : null}
      <EarnPill points={orderQuote.data?.pointsEarn} grouped={grouped} />
      <Button
        testID="cart-checkout"
        size="lg"
        fullWidth
        disabled={!canCheckout}
        label={totals ? `${t('cart.checkout')} · ${iqd(totals.totalIqd, { locale })}` : t('cart.checkout')}
        onPress={() => (guest ? void requireSignIn('/checkout') : router.push('/checkout'))}
      />
    </View>
  );

  return (
    <Screen edges={['bottom']} footer={footer} testID="cart">
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ flex: 1 }}>
            <Text variant="heading" numberOfLines={1}>
              {merchant.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="shield" size={14} color="textMuted" />
              <Text variant="caption" color="textMuted">
                {t('cart.one_merchant_note')}
              </Text>
            </View>
          </View>
          <Button size="sm" variant="secondary" icon="plus" label={t('cart.add_more')} onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: merchant.id } })} testID="cart-add-more" />
        </View>
        {closed && menu.data ? (
          <Text variant="footnote" color="warningText">
            {t('error.merchant_closed', { time: menu.data.restaurant.opensAt ?? '' })}
          </Text>
        ) : null}
        <DealBadges deals={deals} compact testID="cart-deals" />
      </View>

      <View style={{ gap: theme.space[4] }}>
        {groups.map((g) => (
          <View key={g.personId} style={{ gap: theme.space[2] }} testID={`cart-group-${g.personId}`}>
            {grouped ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                {g.personId === TABLE ? (
                  <Avatar size={32} icon="family" tone="accent" />
                ) : (
                  <Avatar size={32} name={g.person?.name ?? myName ?? t('item.for_me_chip')} tone={g.person ? undefined : 'accent'} />
                )}
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {g.personId === TABLE ? t('cart.for_table_section') : g.person ? t('cart.for_person_section', { name: g.person.name }) : t('cart.for_me_section')}
                </Text>
                <Text variant="label" color="textMuted" tabular>
                  {iqd(g.subtotalIqd, { locale })}
                </Text>
              </View>
            ) : null}
            <Card elevation={0} padding={0}>
              {g.lines.map((l, i) => (
                <CartLineRow key={l.key} line={l} savingIqd={savings.get(l.key) ?? 0} divider={i < g.lines.length - 1} onQty={(q) => setQty(l.key, q)} onRemove={() => remove(l.key)} />
              ))}
            </Card>
          </View>
        ))}
        {grouped ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="gift" size={16} color="successText" />
            <Text variant="footnote" color="successText">
              {t('cart.points_by_person')}
            </Text>
          </View>
        ) : null}
        {grouped ? (
          <Text variant="footnote" color="textMuted" testID="cart-organizer">
            {t('cart.organizer_bonus')}
          </Text>
        ) : null}
      </View>

      {upsell.length ? (
        <View style={{ gap: theme.space[3] }} testID="cart-upsell">
          <Text variant="title">{shortfall > 0 ? t('cart.upsell_close_gap') : t('cart.upsell_title')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -theme.space[5] }} contentContainerStyle={{ paddingHorizontal: theme.space[5], gap: theme.space[3], paddingVertical: theme.space[1] }}>
            {upsell.map((item) => (
              <Card key={item.id} padding={0} style={{ width: 132, overflow: 'hidden' }} onPress={() => quickAdd(item)} accessibilityLabel={t('restaurant.add_item', { name: item.name })} testID={`upsell-${item.id}`}>
                <View style={{ height: 84 }}>
                  <FoodArt {...artOf(item)} photoUrl={item.photoUrl} />
                </View>
                <View style={{ padding: theme.space[2], gap: 2 }}>
                  <Text variant="label" weight={600} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text variant="caption" color="textMuted" tabular>
                      {iqd(item.priceIqd, { locale })}
                    </Text>
                    <IconButton icon="plus" size={36} variant="tonal" accessibilityLabel={t('restaurant.add_item', { name: item.name })} onPress={() => quickAdd(item)} />
                  </View>
                </View>
              </Card>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <Card elevation={0} padding={0}>
        <DeliverToRow place={place} />
      </Card>

      <View style={{ gap: theme.space[2] }} testID="cart-total">
        {totals && totals.discountIqd > 0 ? (
          <DealApplied
            label={totals.discount ? (locale === 'en' ? totals.discount.label_en : totals.discount.label_ar) : null}
            savingIqd={totals.dealIqd || totals.discountIqd}
            others={otherDeals(deals, totals.discount).map((d) => (locale === 'en' ? d.label_en : d.label_ar))}
          />
        ) : nextDeal && shortfall === 0 ? (
          <Card elevation={0} padding={3} style={{ backgroundColor: theme.colors.accentTint }} testID="cart-deal-unlock">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Icon name="gift" size={18} color="accentText" />
              <Text variant="label" color="accentText" style={{ flex: 1 }}>
                {t('cart.deal_unlock', { amount: amountParam(nextDeal.missingIqd), label: locale === 'en' ? nextDeal.label_en : nextDeal.label_ar })}
              </Text>
            </View>
          </Card>
        ) : null}
        {!dropoff ? (
          <Text variant="label" color="textMuted" testID="cart-price-pending">
            {guest ? t('cart.price_after_sign_in') : t('cart.pick_place')}
          </Text>
        ) : totals ? (
          <PriceBreakdown items={priceItems(totals, t, locale)} total={totals.totalIqd} change={totals.changeIqd} totalLabel={t('quote.total')} note={t('quote.quote_locked')} testID="cart-price" />
        ) : stopped ? null : quote.isError ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="label" color="dangerText" style={{ flex: 1 }}>
              {t('cart.quote_failed')}
            </Text>
            <Button size="sm" variant="secondary" label={t('action.retry')} onPress={() => void quote.refetch()} />
          </View>
        ) : (
          <View style={{ gap: theme.space[2] }}>
            <Skeleton height={16} />
            <Skeleton height={16} width="70%" />
            <Skeleton height={28} width="50%" />
          </View>
        )}
        <Text variant="caption" color="textMuted" align="center">
          {t('checkout.cash_on_arrival')}
        </Text>
      </View>
    </Screen>
  );
}

/**
 * C-06: which deal applied and why another did not — deals never combine; the server applied the one
 * that saves most ("العروض ما تنجمع — طبّقنا الأوفر إلك").
 */
function DealApplied({ label, savingIqd, others }: { label: string | null; savingIqd: number; others: string[] }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card elevation={0} padding={3} style={{ backgroundColor: theme.colors.successTint }} testID="cart-deal-saving">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
        <View style={{ marginTop: 2 }}>
          <Icon name="gift" size={18} color="successText" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={600} color="successText">
            {label ? t('cart.deal_applied', { label }) : t('cart.deal_saving', { amount: amountParam(savingIqd) })}
          </Text>
          {label ? (
            <Text variant="footnote" weight={600} color="successText" testID="cart-deal-amount">
              {t('cart.deal_applied_saving', { amount: amountParam(savingIqd) })}
            </Text>
          ) : null}
          {others.length > 0 ? (
            <Text variant="footnote" color="textMuted" testID="cart-deal-not-stacked">
              {t('cart.deals_dont_stack', { other: others.join('، ') })}
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}
