import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  Card,
  EmptyState,
  formatAmount,
  PriceBreakdown,
  Skeleton,
  Text,
  TextField,
  useNetwork,
  useTheme,
} from '@driver/ui';
import { Screen } from '@/components/Screen';
import { DeliverToRow } from '@/features/food/DeliverToRow';
import { CITY_ID, useDeliverTo, usePlaceOrder } from '@/features/food/queries';
import { newRequestKey } from '@/features/food/place-attempt';
import { basket, breadCart, useBasket, useBreadCart } from '@/features/shopping/basket';
import {
  bakeryLines,
  shopOrderInput,
  stallLines,
  type ShopOrderFrom,
} from '@/features/shopping/checkout';
import { GreenBar } from '@/features/shopping/GreenBar';
import { useBakery, useStall } from '@/features/shopping/queries';
import { ShopHeader } from '@/features/shopping/ShopHeader';
import { useWeightText } from '@/features/shopping/WeightSheet';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * Checkout for the shopping side (2026-10-11): the stall basket or the hot bread, where it goes, and the
 * server's total. Cash at the door, rounded up to 250 with the change to the wallet like every cash
 * order. Weighed lines go with their grams; the server prices them from the stall's posted kilo price.
 * One tap places one order: the request key is kept until the server answers.
 */
export default function ShoppingCheckout() {
  const { from } = useLocalSearchParams<{ from?: ShopOrderFrom }>();
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const net = useNetwork();
  const weightText = useWeightText();
  const { place, dropoff } = useDeliverTo();
  const cart = useBasket();
  const bread = useBreadCart();
  const isBakery = from === 'bakery';
  const stall = useStall(isBakery ? undefined : (cart.stallId ?? undefined));
  const bakery = useBakery(isBakery ? (bread.bakeryId ?? undefined) : undefined);
  const placeOrder = usePlaceOrder();
  const [courierNote, setCourierNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);

  const shop = isBakery ? bakery.data : stall.data;
  const lines = useMemo(() => {
    if (isBakery) return bakery.data ? bakeryLines(bread, bakery.data) : [];
    return stall.data ? stallLines(cart, stall.data) : [];
  }, [isBakery, bakery.data, bread, stall.data, cart]);
  const input =
    shop && dropoff && lines.length
      ? shopOrderInput({ cityId: CITY_ID, merchantOrgId: shop.id, lines, dropoff, courierNote })
      : null;
  // The note does not change the price: quote without it so typing does not re-ask the server.
  const quoteInput = input ? { ...input, courierNote: undefined } : null;
  const quote = useQuery(api.orders.quote.queryOptions(quoteInput ?? skipToken));

  const empty = isBakery ? !bread.bakeryId : !cart.stallId;
  if (empty) {
    return (
      <Screen edges={['bottom']} testID="shopping-checkout">
        <EmptyState
          icon="bag"
          title={t('cart.empty')}
          action={{ label: t('shopping.title'), onPress: () => router.replace('/shopping') }}
        />
      </Screen>
    );
  }

  const loading =
    (isBakery ? bakery.isPending : stall.isPending) || (quoteInput !== null && quote.isPending);
  const names = new Map((shop?.items ?? []).map((i) => [i.id, i.name] as const));
  const perLot = new Map((bakery.data?.items ?? []).map((i) => [i.id, i.per] as const));
  const blocker =
    net.state === 'offline'
      ? t('checkout.offline_blocked')
      : !dropoff
        ? t('cart.pick_place')
        : stall.isError || bakery.isError
          ? apiErrorMessage(stall.error ?? bakery.error, t('error.generic'), locale)
          : quote.error
            ? apiErrorMessage(quote.error, t('error.generic'), locale)
            : null;

  const onPlace = async () => {
    if (!input || !quote.data || blocker || placeOrder.isPending) return;
    setProblem(null);
    requestKey.current ??= newRequestKey('shp');
    try {
      const order = await placeOrder.mutateAsync({
        ...input,
        deliveryFeeIqd: quote.data.deliveryFeeIqd,
        serviceFeeIqd: quote.data.serviceFeeIqd,
        discountIqd: quote.data.discountIqd,
        clientRequestId: requestKey.current,
      });
      requestKey.current = null;
      if (isBakery) breadCart.clear();
      else basket.clear();
      void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
      router.replace({ pathname: '/kitchen/[id]', params: { id: order.id } });
    } catch (err) {
      const code = apiErrorCode(err);
      // A refusal the server named placed nothing: a new tap is a new attempt. Anything else keeps the key.
      if (code) requestKey.current = null;
      if (code === 'price_changed' || code === 'catalog_item_unavailable') {
        await Promise.all([isBakery ? bakery.refetch() : stall.refetch(), quote.refetch()]);
        setProblem(t('checkout.price_changed'));
      } else {
        setProblem(
          code ? apiErrorMessage(err, t('error.generic'), locale) : t('checkout.lost_answer'),
        );
      }
    }
  };

  const q = quote.data;
  const priceItems = q
    ? [
        { key: 'items', label: t('quote.subtotal'), amount: q.itemsTotalIqd },
        { key: 'delivery', label: t('shopping.delivery'), amount: q.deliveryFeeIqd },
        ...(q.serviceFeeIqd
          ? [
              {
                key: 'service',
                label: t('quote.service_fee'),
                amount: q.serviceFeeIqd,
                reason: t('quote.reason.service_fee'),
              },
            ]
          : []),
        ...(q.discountIqd
          ? [{ key: 'discount', label: t('quote.promo'), amount: -q.discountIqd }]
          : []),
      ]
    : [];

  return (
    <Screen
      testID="shopping-checkout"
      edges={['bottom']}
      footer={
        <View style={{ gap: theme.space[2] }}>
          {(problem ?? blocker) && !(placeOrder.isError && !problem) ? (
            <Text
              variant="footnote"
              weight={600}
              color={problem ? 'danger' : 'textMuted'}
              align="center"
            >
              {problem ?? blocker}
            </Text>
          ) : null}
          {q && !blocker ? (
            <GreenBar
              label={placeOrder.isPending ? t('checkout.placing') : t('shopping.confirm_order')}
              amountIqd={q.totalIqd}
              onPress={() => void onPlace()}
            />
          ) : null}
        </View>
      }
    >
      <ShopHeader
        title={t('checkout.title')}
        sub={shop ? t('checkout.summary', { name: shop.name }) : ''}
        fallback={
          isBakery && shop
            ? `/shopping/bakery/${shop.id}`
            : shop
              ? `/shopping/stall/${shop.id}`
              : '/shopping'
        }
      />

      <Card elevation={0} padding={0}>
        <DeliverToRow place={place} />
      </Card>

      <Card elevation={0} style={{ gap: theme.space[2] }}>
        {loading && !shop ? (
          <Skeleton height={60} />
        ) : (
          lines.map((l) => {
            const amount = l.weightG ? weightText(l.weightG) : t('shopping.pieces', { n: l.qty });
            return (
              <View
                key={l.catalogItemId}
                style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}
              >
                <Text variant="body" weight={600} style={{ flex: 1 }} numberOfLines={1}>
                  {names.get(l.catalogItemId ?? '') ?? ''}
                </Text>
                <Text variant="footnote" color="textMuted">
                  {isBakery
                    ? t('shopping.pieces', { n: l.qty * (perLot.get(l.catalogItemId ?? '') ?? 1) })
                    : amount}
                </Text>
                <Text
                  variant="body"
                  weight={600}
                  tabular
                  style={{ minWidth: 56, textAlign: 'left' }}
                >
                  {formatAmount((l.unitPriceIqd ?? 0) * l.qty)}
                </Text>
              </View>
            );
          })
        )}
      </Card>

      <TextField
        label={t('checkout.note_courier')}
        placeholder={t('checkout.note_courier_placeholder')}
        value={courierNote}
        onChangeText={setCourierNote}
        maxLength={300}
      />

      <Card elevation={0}>
        {q ? (
          <PriceBreakdown
            items={priceItems}
            total={q.totalIqd}
            change={q.changeIqd ?? 0}
            note={t('checkout.cash_change_hint')}
            testID="shopping-checkout-price"
          />
        ) : (
          <View style={{ gap: theme.space[2] }}>
            <Skeleton height={16} />
            <Skeleton height={16} width="70%" />
            <Skeleton height={28} width="50%" />
          </View>
        )}
      </Card>
    </Screen>
  );
}
