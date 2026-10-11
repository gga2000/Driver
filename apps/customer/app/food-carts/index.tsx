import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import type { CartCard } from '@driver/contracts';
import { Button, EmptyState, RetryState, retryKindFor, SegmentedControl, SketchScene, Skeleton, Text, useNetwork, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { HeaderBack } from '@/features/food/HeaderBack';
import { CartRow } from '@/features/food-carts/CartRow';
import { FollowedStrip } from '@/features/food-carts/FollowedStrip';
import { useCarts } from '@/features/food-carts/queries';
import { TicketBanner } from '@/features/food-carts/TicketBanner';
import { useGrantedPosition } from '@/features/ride/phone-position';
import { useLocale, useT } from '@/lib/i18n';

type Show = 'open' | 'all';

/**
 * «عربانات العزيزية» (food carts, look B, Ali 2026-10-11): the carts open now, nearest first by
 * walking minutes when the phone already shares its place; the ones this person follows as a strip
 * of round photos; the closed ones under «كل العربانات». A bell follows a cart («أبو حيدر فتح»), a row
 * opens it, and «شوفهم عالخريطة» shows them on the golden map. Public, like the food list.
 */
export default function FoodCartsPage() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const here = useGrantedPosition();
  // No position (refused, failed): the list is by name, without walking minutes.
  const carts = useCarts(here.isError ? null : (here.data ?? null));
  const [show, setShow] = useState<Show>('open');
  const list = carts.data;
  const followed: CartCard[] = list ? [...list.open, ...list.closed].filter((c) => c.following) : [];
  const near = here.data != null;

  return (
    <Screen
      testID="food-carts"
      edges={['top', 'bottom']}
      refreshControl={<RefreshControl refreshing={carts.isRefetching} onRefresh={() => void carts.refetch()} />}
      footer={
        list && list.open.length > 0 ? (
          <Button testID="carts-map" variant="secondary" icon="map-pin" label={t('carts.map_cta')} fullWidth onPress={() => router.push('/food-carts/map')} />
        ) : undefined
      }
    >
      <View style={{ flexDirection: 'row', marginStart: -theme.space[2] }}>
        <HeaderBack fallback="/" />
      </View>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="display" face="display" accessibilityRole="header">
          {t('carts.title')}
        </Text>
        <Text variant="body" color="textMuted">
          {t('carts.sub')}
        </Text>
      </View>

      <TicketBanner />

      {carts.isError && !list ? (
        <RetryState
          kind={retryKindFor({ net, error: carts.error })}
          locale={locale}
          art={net.state !== 'online' ? <SketchScene name="offline" /> : undefined}
          {...(retryKindFor({ net, error: carts.error }) === 'server' ? { title: t('carts.load_error') } : {})}
          onRetry={() => void carts.refetch()}
        />
      ) : !list ? (
        <View style={{ gap: theme.space[3] }} testID="carts-loading">
          <Skeleton height={48} />
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      ) : (
        <View style={{ gap: theme.space[4] }}>
          <SegmentedControl<Show>
            testIDPrefix="carts-show"
            accessibilityLabel={t('carts.title')}
            value={show}
            onChange={setShow}
            options={[
              { value: 'open', label: t('carts.show_open', { n: list.open.length }) },
              { value: 'all', label: t('carts.show_all') },
            ]}
          />
          <FollowedStrip cards={followed} />

          <View style={{ gap: theme.space[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text variant="section" face="display">
                {near ? t('carts.near_title') : t('carts.open_title')}
              </Text>
              {near && list.open.length > 0 ? (
                <Text variant="footnote" color="textMuted">
                  {t('carts.by_walk')}
                </Text>
              ) : null}
            </View>
            {list.open.length === 0 ? (
              <EmptyState icon="bell" title={t('carts.empty_open_title')} body={t('carts.empty_open_body')} />
            ) : (
              list.open.map((c) => <CartRow key={c.id} card={c} />)
            )}
          </View>

          {show === 'all' && list.closed.length > 0 ? (
            <View style={{ gap: theme.space[3] }} testID="carts-closed">
              <Text variant="section" face="display">
                {t('carts.closed_title')}
              </Text>
              {list.closed.map((c) => (
                <CartRow key={c.id} card={c} />
              ))}
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
