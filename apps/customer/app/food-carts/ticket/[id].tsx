import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { WalkupView } from '@driver/contracts';
import { Button, EmptyState, Icon, RetryState, retryKindFor, Skeleton, Text, useNetwork, useNow, useTheme, useToast } from '@driver/ui';
import { GuestGate } from '@/components/GuestGate';
import { Screen } from '@/components/Screen';
import { HeaderBack } from '@/features/food/HeaderBack';
import { cartPalette } from '@/features/food-carts/palette';
import { useCancelWalkup, useMyWalkups } from '@/features/food-carts/queries';
import { appNow } from '@/lib/dev-clock';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useSignedIn } from '@/lib/session';

/**
 * A walk-over ticket (look A «امشي للعربانة», Ali 2026-10-11): how many minutes until it is ready (the
 * cart's own word once it says «جاهزة»), the walk and the cooking side by side, then the code to say at
 * the cart and the cash to hand over. «ألغي» only while the cart hasn't started. «وصلت» puts the code up
 * big for the cart owner to read.
 */
export default function WalkupTicketPage() {
  return useSignedIn() ? <Ticket /> : <GuestGate kind="account" />;
}

function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const mine = useMyWalkups();
  const w = mine.data?.find((x) => x.id === id) ?? null;

  return (
    <Screen testID="cart-ticket" edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', marginStart: -theme.space[2] }}>
        <HeaderBack fallback="/food-carts" />
      </View>
      {mine.isError && !mine.data ? (
        <RetryState kind={retryKindFor({ net, error: mine.error })} locale={locale} onRetry={() => void mine.refetch()} />
      ) : !mine.data ? (
        <View style={{ gap: theme.space[3] }}>
          <Skeleton height={200} />
          <Skeleton height={120} />
        </View>
      ) : !w ? (
        <EmptyState icon="receipt" title={t('carts.ticket_gone_title')} body={t('carts.ticket_gone_body')} action={{ label: t('carts.back_to_carts'), onPress: () => router.replace('/food-carts') }} />
      ) : (
        <TicketCard w={w} />
      )}
    </Screen>
  );
}

function TicketCard({ w }: { w: WalkupView }) {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const t = useT();
  const toast = useToast();
  const cancel = useCancelWalkup();
  const tick = useNow(true, 15_000);
  const now = useMemo(() => appNow(tick), [tick]);
  const [here, setHere] = useState(false);
  const left = Math.max(0, Math.ceil((w.readyBy.getTime() - now.getTime()) / 60_000));
  const open = w.state === 'placed' || w.state === 'ready';
  const ready = w.state === 'ready' || (w.state === 'placed' && left === 0);
  const what = w.lines.map((l) => `${l.qty > 1 ? `${l.qty} ${l.nameAr}` : l.nameAr}${l.choices.length ? ` (${l.choices.join('، ')})` : ''}`).join('، ');

  const head =
    w.state === 'ready'
      ? t('carts.ticket_ready')
      : w.state === 'collected'
        ? t('carts.ticket_collected')
        : w.state === 'cancelled'
          ? t('carts.ticket_cancelled')
          : w.state === 'expired'
            ? t('carts.ticket_expired')
            : ready
              ? t('carts.ticket_almost')
              : t('carts.ticket_cooking');

  return (
    <View style={{ gap: theme.space[4] }}>
      <View testID="cart-ticket-card" style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, ...theme.elevation[2] }}>
        <View style={{ padding: theme.space[5], flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
          <View style={{ flex: 1, gap: theme.space[1] }}>
            <Text variant="heading" face="display" accessibilityRole="header" testID="cart-ticket-head">
              {head}
            </Text>
            <Text variant="footnote" color="textMuted" numberOfLines={2}>
              {t('carts.ticket_what', { name: w.cartName, what })}
            </Text>
            {open && !ready ? (
              <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: theme.space[2] }}>
                <Pill>
                  <Icon name="walk" size={16} color={theme.colors.text} />
                  <Text variant="caption" weight={600} compact>
                    {w.spot?.label ?? w.cartName}
                  </Text>
                </Pill>
                <Pill>
                  <Icon name="flame" size={16} color={pal.text} />
                  <Text variant="caption" weight={600} compact tabular>
                    {t('carts.ready_by', { n: left })}
                  </Text>
                </Pill>
              </View>
            ) : null}
          </View>
          {open && !ready ? (
            <View style={{ alignItems: 'center' }} accessibilityLabel={t('carts.ready_by', { n: left })}>
              <Text variant="numeralLg" face="display" tabular fixed testID="cart-ticket-minutes">
                {String(left)}
              </Text>
              <Text variant="footnote" color="textMuted">
                {t('carts.minutes_word')}
              </Text>
            </View>
          ) : w.state === 'ready' ? (
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: pal.fill, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={28} color={pal.on} />
            </View>
          ) : null}
        </View>

        {/* The tear line between the order and the code, like a paper ticket. */}
        <View style={{ height: 1, marginHorizontal: theme.space[5], borderTopWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.border }} />

        <View style={{ padding: theme.space[5], flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="body" color="textMuted">
              {t('carts.say_code')}
            </Text>
            <Text variant="bodyStrong" tabular>
              {t('carts.pay_cash', { amount: amountParam(w.totalIqd) })}
            </Text>
          </View>
          <Text variant={here ? 'numeralLg' : 'numeralMd'} face="display" tabular fixed testID="cart-ticket-code" color={open ? 'text' : 'textMuted'} style={{ letterSpacing: 4 }}>
            {w.code}
          </Text>
        </View>
      </View>

      {open ? (
        <Button testID="cart-ticket-here" label={here ? t('carts.here_done') : t('carts.here')} icon={here ? undefined : 'map-pin'} fullWidth onPress={() => setHere((v) => !v)} />
      ) : (
        <Button testID="cart-ticket-back" variant="secondary" label={t('carts.back_to_carts')} fullWidth onPress={() => router.replace('/food-carts')} />
      )}
      {w.state === 'placed' ? (
        <Pressable
          testID="cart-ticket-cancel"
          accessibilityRole="button"
          disabled={cancel.status === 'pending'}
          onPress={() =>
            cancel.mutate(
              { walkupId: w.id },
              {
                onSuccess: () => toast.show({ message: t('carts.cancelled_toast'), tone: 'success' }),
                onError: () => toast.show({ message: t('carts.cancel_failed'), tone: 'danger' }),
              },
            )
          }
          style={{ alignSelf: 'center', minHeight: 44, paddingHorizontal: theme.space[5], borderRadius: 22, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text variant="label" weight={600}>
            {t('carts.cancel_free')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 32, borderRadius: 16, backgroundColor: theme.colors.surfaceSunken }}>{children}</View>;
}
