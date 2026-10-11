import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MenuItem } from '@driver/contracts';
import { Button, Card, EmptyState, Icon, IconButton, ModalSheet, RetryState, retryKindFor, SketchScene, Skeleton, Text, useLoadTimeout, useNetwork, useNow, useTheme } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { cartMerchantOf, ME, type CartMerchant } from '@/features/food/cart';
import { cartStore, useCartSelect } from '@/features/food/cart-store';
import { FoodArt, dishArt, motifForKitchen, type DishArt } from '@/features/food/FoodArt';
import { HeaderBack } from '@/features/food/HeaderBack';
import { ItemSheet } from '@/features/food/ItemSheet';
import { CartButton, LiveCartBar } from '@/features/food/menu-live';
import { useMenu } from '@/features/food/queries';
import { splitMenu } from '@/features/home-food/format';
import { HomeDishRow, type HomeDishActions } from '@/features/home-food/HomeDishRow';
import { Monogram, usePom } from '@/features/home-food/parts';
import { reservationStore } from '@/features/home-food/reservation';
import { ReserveSheet } from '@/features/home-food/ReserveSheet';
import { appNow } from '@/lib/dev-clock';
import { useLocale, useT } from '@/lib/i18n';

const HERO_H = 200;

type Section = 'ready' | 'reserve';
/** A cart change that needs a yes first: another kitchen's or another time's food is in the cart. */
type Pending = { kind: 'ready'; item: MenuItem } | { kind: 'reserve'; item: MenuItem; at: Date; qty: number };

/**
 * A home kitchen (v3): her dish photo, her letter and kitchen name, then her few dishes in two parts —
 * «جاهز هسه» (cooked today, plates left, «+» to the cart) and «بالحجز» (cooked when booked: the next
 * free time, «احجز» opens the day-and-time sheet). Her home is never shown.
 */
export default function HomeKitchenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const net = useNetwork();
  const pom = usePom();
  const menu = useMenu(id);
  const [slow, restartSlow] = useLoadTimeout(menu.isPending);
  const tick = useNow(true, 60_000);
  const now = useMemo(() => appNow(tick), [tick]);
  const [open, setOpen] = useState<MenuItem | null>(null);
  const [reserving, setReserving] = useState<MenuItem | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [active, setActive] = useState<Section>('ready');
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<Section, number>>({ ready: 0, reserve: 0 });
  const bubbleRef = useRef<View>(null);
  const [landings, setLandings] = useState(0);
  const barVisible = useCartSelect((st) => st.cart.merchant?.id === id && st.cart.lines.length > 0);

  const restaurant = menu.data?.restaurant;
  const merchant = restaurant ? cartMerchantOf(restaurant) : null;
  const categories = useMemo(() => menu.data?.categories ?? [], [menu.data]);
  const split = useMemo(() => splitMenu(categories), [categories]);
  const readyNow = split.ready.filter((i) => i.available).length;
  const artById = useMemo(() => {
    const rows = categories.flatMap((c) => c.items.map((i) => ({ id: i.id, name: i.name, category: c.name })));
    const art = dishArt(rows);
    return new Map<string, DishArt>(rows.map((r, i) => [r.id, art[i]!]));
  }, [categories]);
  const photoById = useMemo(() => new Map(categories.flatMap((c) => c.items).map((i) => [i.id, i.photoUrl])), [categories]);

  const lineOf = (item: MenuItem, qty: number) => ({ itemId: item.id, name: item.name, basePriceIqd: item.priceIqd, modifiers: [], qty, note: null, personId: ME });
  const landed = () => {
    setLandings((n) => n + 1);
    theme.haptic('light');
  };
  const addReady = (m: CartMerchant, item: MenuItem, replace: boolean) => {
    if (replace) {
      cartStore.clear();
      reservationStore.set(null);
    }
    const res = cartStore.add(m, lineOf(item, 1));
    if (!res.ok) return setPending({ kind: 'ready', item });
    landed();
  };
  const book = (m: CartMerchant, item: MenuItem, at: Date, qty: number, replace: boolean) => {
    const cart = cartStore.getSnapshot().cart;
    const held = reservationStore.get();
    const sameTime = held?.merchantId === m.id && held.at === at.toISOString();
    const clash = cart.lines.length > 0 && !(cart.merchant?.id === m.id && sameTime);
    if (clash && !replace) return setPending({ kind: 'reserve', item, at, qty });
    if (clash) cartStore.clear();
    cartStore.add(m, lineOf(item, qty));
    reservationStore.set({ merchantId: m.id, at: at.toISOString() });
    setReserving(null);
    landed();
  };

  const actions = useMemo<HomeDishActions>(
    () => ({
      open: (item) => setOpen(item),
      add: (item) => {
        if (!merchant) return;
        const held = reservationStore.get();
        const cart = cartStore.getSnapshot().cart;
        if (held && cart.merchant?.id === held.merchantId && cart.lines.length > 0) return setPending({ kind: 'ready', item });
        addReady(merchant, item, false);
      },
      remove: (item) => {
        const line = [...cartStore.getSnapshot().cart.lines].reverse().find((l) => l.itemId === item.id);
        if (line) cartStore.setQty(line.key, line.qty - 1);
      },
      reserve: (item) => setReserving(item),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [merchant?.id],
  );

  const jumpTo = (s: Section) => {
    setActive(s);
    scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[s] - 8), animated: !theme.reduceMotion });
  };

  if ((menu.isError || slow) && !menu.data) {
    const kind = retryKindFor({ net, error: menu.error, slow });
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} testID="home-kitchen-error">
        <Stack.Screen options={{ headerShown: true, title: '', headerLeft: () => <HeaderBack /> }} />
        <RetryState
          kind={kind}
          locale={locale}
          art={kind === 'offline' || kind === 'unreachable' ? <SketchScene name="offline" /> : undefined}
          {...(kind === 'server' ? { title: t('restaurant.load_failed') } : {})}
          onRetry={() => {
            restartSlow();
            void menu.refetch();
          }}
        />
      </SafeAreaView>
    );
  }

  const closed = restaurant ? !restaurant.open : false;
  const metaParts = restaurant
    ? [restaurant.rating ? `${restaurant.rating.avg.toFixed(1)}` : t('restaurant.rating_new'), restaurant.rating ? t('home_food.orders_count', { n: restaurant.rating.count }) : null, t('home_food.minutes', { n: restaurant.etaMinMinutes ?? restaurant.prepMinMinutes })].filter(Boolean)
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }} testID="home-kitchen">
      <Stack.Screen options={{ headerShown: false, title: restaurant?.name ?? '' }} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y + 80;
          const next: Section = split.reserve.length > 0 && y >= sectionY.current.reserve ? 'reserve' : 'ready';
          if (next !== active) setActive(next);
        }}
      >
        <View style={{ height: HERO_H + insets.top }}>
          {restaurant ? <FoodArt variant="hero" motif={motifForKitchen(restaurant.tags, restaurant.cuisine)} photoUrl={restaurant.photoUrl} /> : <Skeleton height={HERO_H + insets.top} radius={0} />}
          <View style={{ position: 'absolute', top: insets.top + theme.space[2], start: theme.space[4], end: theme.space[4], flexDirection: 'row', justifyContent: 'space-between' }}>
            <IconButton icon="arrow-back" variant="outline" accessibilityLabel={t('action.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/home-food'))} testID="home-kitchen-back" />
            <View style={{ flex: 1 }} />
            <CartButton />
          </View>
        </View>

        <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: theme.space[5], gap: theme.space[4], paddingTop: theme.space[4] }}>
          {restaurant ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }} testID="home-kitchen-head">
              <Monogram letter={restaurant.home?.monogram ?? restaurant.name.slice(0, 1)} size={64} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="heading" face="display" accessibilityRole="header" numberOfLines={2}>
                  {restaurant.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="star" size={15} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
                  <Text variant="footnote" color="textMuted" tabular numberOfLines={1}>
                    {metaParts.join(' · ')}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
              <Skeleton height={64} width={64} radius={20} />
              <View style={{ flex: 1, gap: theme.space[2] }}>
                <Skeleton height={24} width="60%" />
                <Skeleton height={14} width="40%" />
              </View>
            </View>
          )}

          {closed && restaurant ? (
            <Card elevation={0} tone="sunken" padding={3} testID="home-kitchen-closed">
              <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
                <Icon name="clock" size={20} color="warningText" />
                <Text variant="label" weight={600} style={{ flex: 1 }}>
                  {restaurant.opensAt ? t('home_food.closed_until', { time: restaurant.opensAt }) : t('home_food.closed')}
                </Text>
              </View>
            </Card>
          ) : null}

          {menu.data && split.ready.length > 0 && split.reserve.length > 0 ? (
            <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 4, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }} testID="home-kitchen-tabs">
              {(['ready', 'reserve'] as const).map((s) => {
                const on = active === s;
                const n = s === 'ready' ? readyNow : split.reserve.length;
                return (
                  <Pressable
                    key={s}
                    testID={`home-kitchen-tab-${s}`}
                    accessibilityRole="tab"
                    aria-selected={on}
                    onPress={() => jumpTo(s)}
                    style={{ flex: 1, minHeight: 48, borderRadius: theme.radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], backgroundColor: on ? theme.colors.text : 'transparent' }}
                  >
                    <Text variant="label" weight={700} color={on ? theme.colors.bg : 'text'} compact>
                      {t(s === 'ready' ? 'home_food.seg_ready' : 'home_food.seg_reserve')}
                    </Text>
                    <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: s === 'ready' ? theme.services.back.fill : pom.wash }}>
                      <Text variant="caption" weight={700} fixed color={s === 'ready' ? theme.services.back.on : pom.ink} tabular>
                        {String(n)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {menu.isPending ? (
            [0, 1, 2].map((i) => <Skeleton key={i} height={96} radius={theme.radius.xl} />)
          ) : (
            <>
              <View onLayout={(e) => (sectionY.current.ready = e.nativeEvent.layout.y + HERO_H + insets.top)} testID="home-section-ready">
                {split.ready.length > 0 ? (
                  <>
                    <SectionHead title={t('home_food.seg_ready')} hint={t('home_food.ready_hint')} />
                    {split.ready.map((item) => (
                      <HomeDishRow key={item.id} merchantId={id} item={item} now={now} actions={actions} closed={closed} />
                    ))}
                  </>
                ) : split.reserve.length > 0 ? null : (
                  <EmptyState icon="food" title={t('home_food.no_ready_title')} body={t('home_food.no_ready_body')} />
                )}
              </View>
              {split.reserve.length > 0 ? (
                <View onLayout={(e) => (sectionY.current.reserve = e.nativeEvent.layout.y + HERO_H + insets.top)} testID="home-section-reserve">
                  <SectionHead title={t('home_food.seg_reserve')} hint={t('home_food.reserve_hint')} />
                  {split.reserve.map((item) => (
                    <HomeDishRow key={item.id} merchantId={id} item={item} now={now} actions={actions} closed={closed} />
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start', paddingTop: theme.space[2] }} testID="home-kitchen-privacy">
                <Icon name="lock" size={16} color="textMuted" />
                <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
                  {t('home_food.privacy')}
                </Text>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {barVisible ? (
        <View style={{ position: 'absolute', bottom: insets.bottom + theme.space[4], start: 0, end: 0, alignItems: 'center', paddingHorizontal: theme.space[5] }} pointerEvents="box-none">
          <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH - 40 }}>
            <LiveCartBar artById={artById} photoById={photoById} bubbleRef={bubbleRef} pulseKey={landings} />
          </View>
        </View>
      ) : null}

      {open && merchant ? <ItemSheet item={open} merchant={merchant} onClose={() => setOpen(null)} onAdded={() => { setOpen(null); landed(); }} /> : null}
      {reserving && merchant ? <ReserveSheet merchantId={id} item={reserving} now={now} onClose={() => setReserving(null)} onBook={({ at, qty }) => book(merchant, reserving, at, qty, false)} /> : null}
      {pending && merchant ? (
        <ModalSheet visible onClose={() => setPending(null)} title={t('home_food.clash_title')} subtitle={t('home_food.reserve_other_cart')} layout="sheet" sheetMaxWidth={MAX_CONTENT_WIDTH} closeLabel={t('action.close')} testID="home-cart-clash">
          <View style={{ gap: theme.space[2] }}>
            <Button
              fullWidth
              label={t('cart.start_new')}
              testID="home-cart-clash-replace"
              onPress={() => {
                const p = pending;
                setPending(null);
                if (p.kind === 'ready') addReady(merchant, p.item, true);
                else book(merchant, p.item, p.at, p.qty, true);
              }}
            />
            <Button fullWidth variant="secondary" label={t('cart.keep_current')} onPress={() => setPending(null)} />
          </View>
        </ModalSheet>
      ) : null}
    </View>
  );
}

function SectionHead({ title, hint }: { title: string; hint: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2], paddingTop: theme.space[4], flexWrap: 'wrap' }}>
      <Text variant="section" face="display" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="footnote" color="textMuted">
        {hint}
      </Text>
    </View>
  );
}
