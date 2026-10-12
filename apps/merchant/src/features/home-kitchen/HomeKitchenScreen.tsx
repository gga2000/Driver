import { router } from 'expo-router';
import { Image } from 'expo-image';
import { View } from 'react-native';
import type { HomeKitchenDish } from '@driver/contracts';
import { Button, EmptyState, Skeleton, Stepper, Text, useTheme } from '@driver/ui';
import { Page } from '@/components/Page';
import { Switch } from '@/components/Switch';
import { Panel, PanelTitle } from '@/features/menu/parts';
import { absoluteUrl } from '@/features/menu/photo';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useCounterToast } from '@/lib/toast';
import { dayWhen } from './logic';
import { useHomeKitchen, useHomeKitchenActions } from './queries';

/** Plates a dish starts with when she turns it on for today (she changes it with the stepper). */
const FIRST_PLATES = 10;

/**
 * «أكلاتي» (أكل بيت, the cook's side): today's ready dishes, each switched on with how many plates she
 * has now; her reserved dishes with how many are booked; the pickup times she cooks for; «زيدي أكلة».
 * Orders themselves come on the normal board.
 */
export function HomeKitchenScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const view = useHomeKitchen(storeId);
  const { today } = useHomeKitchenActions(storeId);
  const pom = theme.services.home;

  const setLeft = (d: HomeKitchenDish, left: number | null) => {
    if (!storeId) return;
    theme.haptic('selection');
    today.mutate(
      {
        merchantOrgId: storeId,
        itemId: d.id,
        left,
        ...(left !== null && d.sale.mode === 'ready' && !d.sale.cookingToday
          ? { cooked: left }
          : {}),
      },
      {
        onError: (err) =>
          toast.show({
            message: apiErrorMessage(err, t('merchant.common.error'), locale),
            tone: 'danger',
          }),
      },
    );
  };

  let body: React.ReactNode;
  if (!view.data) {
    body = view.isError ? (
      <EmptyState
        icon="x"
        title={t('merchant.home_kitchen.load_failed')}
        action={{ label: t('merchant.menu.retry'), onPress: () => void view.refetch() }}
      />
    ) : (
      <View style={{ gap: theme.space[3] }} testID="home-kitchen-loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={88} radius={theme.radius.xl} />
        ))}
      </View>
    );
  } else {
    const ready = view.data.dishes.filter((d) => d.sale.mode === 'ready');
    const reserve = view.data.dishes.filter((d) => d.sale.mode === 'reserve');
    body = (
      <View style={{ gap: theme.space[4] }}>
        {view.data.dishes.length === 0 ? (
          <EmptyState icon="food" title={t('merchant.home_kitchen.empty')} />
        ) : null}
        {ready.length > 0 ? (
          <Panel testID="home-kitchen-ready">
            <PanelTitle title={t('merchant.home_kitchen.ready_title')} hint={t('merchant.home_kitchen.ready_hint')} />
            {ready.map((d) => {
              const on = d.sale.mode === 'ready' && d.sale.cookingToday;
              const left = d.view.mode === 'ready' ? d.view.left : 0;
              const cooked = d.sale.mode === 'ready' ? d.sale.cooked : null;
              return (
                <View
                  key={d.id}
                  style={{ gap: theme.space[2] }}
                  testID={`home-kitchen-dish-${d.id}`}
                >
                  <DishRow
                    dish={d}
                    line={
                      on
                        ? cooked
                          ? t('merchant.home_kitchen.left_of', { left, cooked })
                          : t('merchant.home_kitchen.left', { left })
                        : t('merchant.home_kitchen.not_today')
                    }
                  >
                    <Switch
                      value={on}
                      onValueChange={(v) => setLeft(d, v ? (cooked ?? FIRST_PLATES) : null)}
                      accessibilityLabel={t('merchant.home_kitchen.cooking_a11y', { name: d.nameAr })}
                      testID={`home-kitchen-on-${d.id}`}
                    />
                  </DishRow>
                  {on ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: theme.space[3],
                        paddingStart: 72,
                      }}
                    >
                      <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                        {t('merchant.home_kitchen.plates_now')}
                      </Text>
                      <Stepper
                        value={left}
                        min={0}
                        max={200}
                        onChange={(n) => setLeft(d, n)}
                        accessibilityLabel={t('merchant.home_kitchen.plates_now')}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Panel>
        ) : null}
        {reserve.length > 0 ? (
          <Panel testID="home-kitchen-reserve">
            <PanelTitle
              title={t('merchant.home_kitchen.reserve_title')}
              hint={t('merchant.home_kitchen.reserve_hint')}
            />
            {reserve.map((d) => (
              <DishRow
                key={d.id}
                dish={d}
                line={
                  d.view.mode === 'reserve' && d.view.next
                    ? t('merchant.home_kitchen.next_free', dayWhen(d.view.next.at, new Date(), t))
                    : t('merchant.home_kitchen.week_full')
                }
              >
                {d.booked > 0 ? (
                  <View
                    style={{
                      backgroundColor: pom.card.bg,
                      borderRadius: theme.radius.pill,
                      paddingHorizontal: theme.space[3],
                      minHeight: 30,
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      variant="caption"
                      weight={700}
                      color={theme.scheme === 'dark' ? pom.card.dot : pom.fill}
                      tabular
                    >
                      {t('merchant.home_kitchen.booked', { n: d.booked })}
                    </Text>
                  </View>
                ) : null}
              </DishRow>
            ))}
          </Panel>
        ) : null}
        <Panel testID="home-kitchen-reservations">
          <PanelTitle
            title={t('merchant.home_kitchen.reservations_title')}
            hint={t('merchant.home_kitchen.reservations_hint')}
          />
          {view.data.reservations.length === 0 ? (
            <Text variant="body" color="textMuted">
              {t('merchant.home_kitchen.reservations_none')}
            </Text>
          ) : (
            view.data.reservations.map((r) => {
              const w = dayWhen(r.at, new Date(), t);
              return (
                <View
                  key={`${r.at.getTime()}-${r.itemId}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space[3],
                    padding: theme.space[3],
                    borderRadius: theme.radius.lg,
                    backgroundColor: pom.card.bg,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong" tabular>{`${w.day} ${w.time}`}</Text>
                    <Text variant="footnote" color="textMuted">
                      {t('merchant.home_kitchen.slot_line', { dish: r.nameAr, orders: r.orders })}
                    </Text>
                  </View>
                  <Text
                    variant="title"
                    face="display"
                    tabular
                    color={theme.scheme === 'dark' ? pom.card.dot : pom.fill}
                    accessibilityLabel={t('merchant.home_kitchen.plates_a11y', { n: r.plates })}
                  >
                    {String(r.plates)}
                  </Text>
                </View>
              );
            })
          )}
        </Panel>
      </View>
    );
  }

  return (
    <Page
      title={t('merchant.home_kitchen.title')}
      subtitle={store?.name}
      back
      testID="home-kitchen"
      maxWidth={720}
    >
      {body}
      {store?.role === 'owner' ? (
        <Button
          fullWidth
          size="lg"
          icon="plus"
          label={t('merchant.home_kitchen.add')}
          onPress={() => router.push('/home-kitchen/dish')}
          testID="home-kitchen-add"
        />
      ) : null}
    </Page>
  );
}

/** Her photo, the dish name and one line, with the dish's control at the end; tapping opens the dish (owner). */
function DishRow({
  dish,
  line,
  children,
}: {
  dish: HomeKitchenDish;
  line: string;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const { store } = useCurrentStore();
  const owner = store?.role === 'owner';
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 64 }}
    >
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceSunken,
        }}
      >
        {dish.photoUrl ? (
          <Image
            source={{ uri: absoluteUrl(dish.photoUrl) }}
            style={{ width: 60, height: 60 }}
            contentFit="cover"
          />
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          variant="bodyStrong"
          numberOfLines={1}
          onPress={
            owner
              ? () => router.push({ pathname: '/home-kitchen/dish', params: { id: dish.id } })
              : undefined
          }
          accessibilityRole={owner ? 'link' : undefined}
        >
          {dish.nameAr}
        </Text>
        <Text variant="footnote" color="textMuted" numberOfLines={1} tabular>
          {line}
        </Text>
      </View>
      {children}
    </View>
  );
}
