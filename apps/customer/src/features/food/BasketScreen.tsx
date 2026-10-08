import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { MenuItem } from '@driver/contracts';
import { Button, Card, EmptyState, Icon, IconButton, SketchScene, Skeleton, Text, stageOf, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useMyOrders } from '@/features/home/queries';
import { requireSignIn } from '@/lib/guest';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { useSignedIn } from '@/lib/session';
import { basketGap, basketUpsell, pickHint, type BasketHint } from './basket-hint';
import { groupByPerson, itemCount, itemsTotal, ME, TABLE, type PersonGroup } from './cart';
import { CartLineRow } from './CartLineRow';
import { cartStore, useCart } from './cart-store';
import { NEW_CUSTOMER_CAP_IQD, checkoutTotals, lineSavings, otherDeals, overNewCustomerCap, priorCashOrders } from './checkout';
import { earnCopy } from './checkout-lines';
import { DeliverToRow } from './DeliverToRow';
import { FoodArt, artOf } from './FoodArt';
import { minOrderProgress } from './min-order';
import { MinOrderStrip } from './MinOrderStrip';
import { useCartQuote, useDeliverTo, useMenu, useOrderQuote } from './queries';

const ALL = 'all';

/**
 * The basket as a tray (after-order redesign, step 1; Ali voted Yes 2026-10-07: b1 b2 b4 b3 b6).
 * Every dish on the tray with its picture and who it is for; person tabs instead of headers; one hint
 * at a time; three same-kitchen dishes only when they close a gap; and one date-brown card with the
 * dishes' total. Delivery, fees and deals are added by the server and shown at checkout, as before.
 *
 * Same data and rules as the cart it replaces (`app/cart.tsx`): the button waits for the server's
 * price, a guest is asked for the phone first, below the minimum the order can still go with the
 * small-order fee, and removing a dish offers «رجّعه». Behind the `basket_v2` switch.
 */
export function BasketScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const cart = useCart();
  const { place, dropoff } = useDeliverTo();
  const quote = useCartQuote(cart, dropoff, false);
  const orderQuote = useOrderQuote(cart, dropoff, false);
  const menu = useMenu(cart.merchant?.id);
  const guest = !useSignedIn();
  const mine = useMyOrders();
  const [tab, setTab] = useState<string>(ALL);

  const { grouped, groups } = groupByPerson(cart);
  // The price waits for the server's deal (or its failure) so it never jumps after it shows.
  const totals = quote.data && (orderQuote.data || orderQuote.isError) ? checkoutTotals(cart, quote.data, orderQuote.data) : null;
  const savings = lineSavings(cart, orderQuote.data);
  const deals = menu.data?.restaurant.deals ?? [];
  const hint = useMemo(() => {
    if (!cart.merchant) return null;
    const next = orderQuote.data?.nextDeal ?? null;
    const applied = totals && totals.discountIqd > 0 ? { label: totals.discount ? (locale === 'en' ? totals.discount.label_en : totals.discount.label_ar) : null, savingIqd: totals.dealIqd || totals.discountIqd } : null;
    return pickHint({
      progress: minOrderProgress(itemsTotal(cart), cart.merchant.minOrderIqd),
      minOrderIqd: cart.merchant.minOrderIqd,
      // J-D6: below the minimum the order can still go with the server's small-order fee (guests: the card's).
      smallOrderFeeIqd: orderQuote.data?.smallOrder?.feeIqd ?? menu.data?.restaurant.smallOrderFeeIqd ?? 0,
      nextDeal: next ? { missingIqd: next.missingIqd, label: locale === 'en' ? next.label_en : next.label_ar } : null,
      applied,
      pointsEarn: orderQuote.data?.pointsEarn,
      grouped,
    });
  }, [cart, orderQuote.data, menu.data, totals, locale, grouped]);
  const gap = basketGap(hint);
  const upsell = useMemo(() => (menu.data ? basketUpsell(menu.data.categories, cart, gap) : []), [menu.data, cart, gap]);
  const closed = menu.data ? !menu.data.restaurant.open : false;

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
  const groupLabel = (g: PersonGroup) => (g.personId === TABLE ? t('cart.for_table_section') : g.person ? g.person.name : t('cart.for_me_section'));
  // A tab whose person left the basket falls back to all.
  const current = grouped && groups.some((g) => g.personId === tab) ? tab : ALL;
  const shown = current === ALL ? groups : groups.filter((g) => g.personId === current);
  const lines = shown.flatMap((g) => g.lines.map((line) => ({ line, who: grouped ? groupLabel(g) : null })));
  const canCheckout = guest || Boolean(totals);

  // The server's items deal comes off the big figure, so it agrees with the deal prices on the lines.
  const itemsDealIqd = totals?.discount?.target === 'items' ? totals.dealIqd : 0;
  const itemsIqd = Math.max(0, itemsTotal(cart) - itemsDealIqd);
  // c7: a new account's cash cap, said here instead of failing at the button (a hint: the server decides).
  const capHint = !guest && mine.data !== undefined && overNewCustomerCap(totals?.totalIqd ?? itemsIqd, priorCashOrders(mine.data), 'cash');
  const footer = (
    <View style={{ gap: theme.space[3] }}>
      {/* Always in view (the small-order fee warning sat in the old footer too). */}
      {hint ? <HintStrip hint={hint} others={hint.kind === 'deal_applied' ? otherDeals(deals, totals?.discount ?? null).map((d) => (locale === 'en' ? d.label_en : d.label_ar)) : []} /> : null}
      {capHint ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }} testID="basket-cash-cap" accessibilityLiveRegion="polite">
          <Icon name="cash" size={16} color="warningText" />
          <Text variant="footnote" color="warningText" style={{ flex: 1 }}>
            {t('basket.cash_cap_hint', { amount: amountParam(NEW_CUSTOMER_CAP_IQD) })}
          </Text>
        </View>
      ) : null}
      <TotalCard
        itemsIqd={itemsIqd}
        state={!dropoff ? (guest ? 'guest' : 'no_place') : totals ? 'ready' : quote.isError ? 'error' : 'loading'}
        onRetry={() => void quote.refetch()}
      />
      <Button
        testID="cart-checkout"
        size="lg"
        fullWidth
        disabled={!canCheckout}
        label={t('cart.checkout')}
        onPress={() => (guest ? void requireSignIn('/checkout') : router.push('/checkout'))}
      />
    </View>
  );

  return (
    <Screen edges={['bottom']} footer={footer} testID="cart">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ flex: 1 }}>
          <Text variant="heading" face="display" numberOfLines={1}>
            {t('basket.title')}
          </Text>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {`${merchant.name} · ${t('cart.one_merchant_note')}`}
          </Text>
        </View>
      </View>
      {closed && menu.data ? (
        <Text variant="footnote" color="warningText">
          {t('error.merchant_closed', { time: menu.data.restaurant.opensAt ?? '' })}
        </Text>
      ) : null}

      {grouped ? <PersonTabs count={itemCount(cart)} groups={groups} label={groupLabel} current={current} onPick={setTab} /> : null}

      <View testID="basket-tray" style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.xl, padding: theme.space[2], gap: theme.space[2] }}>
        {lines.map(({ line, who }) => (
          <CartLineRow key={line.key} tray who={who} line={line} savingIqd={savings.get(line.key) ?? 0} onQty={(q) => setQty(line.key, q)} onRemove={() => remove(line.key)} />
        ))}
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: merchant.id } })}
        testID="cart-add-more"
        hitSlop={8}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space[1], alignSelf: 'flex-start' }}
      >
        <Icon name="plus" size={16} color="accentText" />
        <Text variant="label" weight={600} color="accentText">
          {t('basket.add_same_kitchen')}
        </Text>
      </Pressable>

      {upsell.length ? (
        <View style={{ gap: theme.space[2] }} testID="cart-upsell">
          <Text variant="title">{hint?.kind === 'min' ? t('cart.upsell_close_gap') : t('basket.upsell_deal')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -theme.space[5] }} contentContainerStyle={{ paddingHorizontal: theme.space[5], gap: theme.space[3], paddingVertical: theme.space[1] }}>
            {upsell.map((item) => (
              <Card key={item.id} padding={0} style={{ width: 132, overflow: 'hidden' }} onPress={() => quickAdd(item)} accessibilityLabel={t('restaurant.add_item', { name: item.name })} testID={`upsell-${item.id}`}>
                <View style={{ height: 84 }}>
                  <FoodArt {...artOf(item)} photoUrl={item.photoUrl} stage={stageOf(item.id, theme.decor.stages)} />
                </View>
                <View style={{ padding: theme.space[2], gap: 2 }}>
                  <Text variant="label" weight={600} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text variant="caption" color="textMuted" tabular>
                      {iqd(item.priceIqd, { locale })}
                    </Text>
                    <IconButton icon="plus" size={44} variant="tonal" accessibilityLabel={t('restaurant.add_item', { name: item.name })} onPress={() => quickAdd(item)} />
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

    </Screen>
  );
}

/** «الكل 3 · إلي · سارة · للسفرة»: who the tray shows. Each tab is a 44 px target. */
function PersonTabs({ count, groups, label, current, onPick }: { count: number; groups: PersonGroup[]; label: (g: PersonGroup) => string; current: string; onPick: (id: string) => void }) {
  const theme = useTheme();
  const t = useT();
  const tabs = [{ id: ALL, text: t('basket.tab_all', { n: count }) }, ...groups.map((g) => ({ id: g.personId, text: label(g) }))];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }} accessibilityRole="tablist" testID="basket-tabs">
      {tabs.map((tab) => {
        const on = tab.id === current;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              theme.haptic('selection');
              onPick(tab.id);
            }}
            testID={`basket-tab-${tab.id}`}
            style={{
              minHeight: 44,
              paddingHorizontal: theme.space[4],
              borderRadius: theme.radius.pill,
              justifyContent: 'center',
              backgroundColor: on ? theme.colors.tabSelected : theme.colors.surface,
              borderWidth: 1,
              borderColor: on ? theme.colors.tabSelected : theme.colors.border,
            }}
          >
            <Text variant="label" weight={on ? 700 : 500} color={on ? 'onTabSelected' : 'text'} compact tabular>
              {tab.text}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** The one hint (b3), on the saffron tint: the minimum, a deal to unlock, the deal applied, or points. */
function HintStrip({ hint, others }: { hint: BasketHint; others: string[] }) {
  const theme = useTheme();
  const t = useT();
  const body = (() => {
    switch (hint.kind) {
      case 'min':
        return <MinOrderStrip progress={hint.progress} minOrderIqd={hint.minOrderIqd} feeIqd={hint.feeIqd} />;
      case 'deal_unlock':
        return <HintLine icon="gift" text={t('cart.deal_unlock', { amount: amountParam(hint.missingIqd), label: hint.label })} testID="cart-deal-unlock" />;
      case 'deal_applied':
        return (
          <View style={{ gap: 2 }}>
            <HintLine icon="gift" text={hint.label ? t('cart.deal_applied', { label: hint.label }) : t('cart.deal_saving', { amount: amountParam(hint.savingIqd) })} testID="cart-deal-saving" />
            {hint.label ? (
              <Text variant="footnote" weight={600} color="accentText" tabular testID="cart-deal-amount">
                {t('cart.deal_applied_saving', { amount: amountParam(hint.savingIqd) })}
              </Text>
            ) : null}
            {others.length ? (
              <Text variant="footnote" color="textMuted" testID="cart-deal-not-stacked">
                {t('cart.deals_dont_stack', { other: others.join('، ') })}
              </Text>
            ) : null}
          </View>
        );
      case 'points': {
        const copy = earnCopy(hint.points, hint.grouped);
        return copy ? <HintLine icon="gift" text={t(copy.key, copy.params)} testID="earn-pill" /> : null;
      }
    }
  })();
  return (
    <View testID="basket-hint" accessibilityLiveRegion="polite" style={{ backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
      {body}
    </View>
  );
}

function HintLine({ icon, text, testID }: { icon: 'gift'; text: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} testID={testID}>
      <Icon name={icon} size={18} color="accentText" />
      <Text variant="label" weight={600} color="accentText" style={{ flex: 1 }} tabular>
        {text}
      </Text>
    </View>
  );
}

/**
 * One date-brown card (b2): the dishes' total, large, with a line saying delivery and fees come at
 * checkout. Until the server has priced the order (the button waits for it) the line says why.
 */
function TotalCard({ itemsIqd, state, onRetry }: { itemsIqd: number; state: 'ready' | 'loading' | 'error' | 'no_place' | 'guest'; onRetry: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const note = state === 'guest' ? t('cart.price_after_sign_in') : state === 'no_place' ? t('cart.pick_place') : state === 'error' ? t('cart.quote_failed') : t('basket.fees_at_checkout');
  return (
    <View testID="basket-total" style={{ backgroundColor: theme.colors.inverse, borderRadius: theme.radius.xl, paddingVertical: theme.space[3], paddingHorizontal: theme.space[4], gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Text variant="label" color="onInverseMuted" style={{ flex: 1 }}>
          {t('basket.items_total')}
        </Text>
        <Text variant="amount" face="display" color="onInverse" tabular testID="basket-items-total">
          {iqd(itemsIqd, { locale })}
        </Text>
      </View>
      {state === 'loading' ? (
        <Skeleton height={14} width="60%" />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="footnote" color={state === 'error' ? 'onInverseCaution' : 'onInverseMuted'} style={{ flex: 1 }} testID={state === 'ready' ? 'cart-price' : 'cart-price-pending'}>
            {note}
          </Text>
          {state === 'error' ? <Button size="sm" variant="secondary" label={t('action.retry')} onPress={onRetry} /> : null}
        </View>
      )}
    </View>
  );
}
