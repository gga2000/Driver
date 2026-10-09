import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { BookingView, SeatPayment } from '@driver/contracts';
import { Button, Card, CountdownRing, EmptyState, PriceLine, QueryBoundary, Rule, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { useWalletBalance } from '@/features/account/queries';
import { Screen } from '@/components/Screen';
import { stopNameOf } from '@/features/rajaa/agree';
import { AgreedNote, FreeLine } from '@/features/rajaa/AgreeParts';
import { seatsList } from '@/features/rajaa/labels';
import { boardingOpensAt, clockLabel, holdCountdown, RAJAA_RULES, publicPlaceName } from '@/features/rajaa/logic';
import { Section } from '@/features/rajaa/Option';
import { PayCompare, walletShortBy } from '@/features/rajaa/PayParts';
import { garageName, useBookSeat, useBooking, useCancelSeat, useNetwork } from '@/features/rajaa/queries';
import { useApi } from '@/lib/api';
import { useNow } from '@/features/rajaa/useNow';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const HOLD_MS = RAJAA_RULES.holdMin * 60_000;

/**
 * The free 10-minute hold, then payment (spec §2, review C-35): wallet prepay (seat guaranteed,
 * 5-minute grace, free cancel until T−30) or a cash reservation, whose rules are stated plainly
 * before the rider commits. Booked → boarding pass.
 */
export default function HoldAndPay() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const locale = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = String(id ?? '');
  const booking = useBooking(bookingId);
  const network = useNetwork();
  const wallet = useWalletBalance();
  const balance = wallet.data ? wallet.data.moneyIqd : null;
  const api = useApi();
  const qc = useQueryClient();
  const book = useBookSeat();
  const release = useCancelSeat();
  const now = useNow(1000);
  const b = booking.data ?? null;
  // Cash is the default (p2); the wallet is one tap, marked «الأضمن».
  const [payment, setPayment] = useState<SeatPayment>('cash');

  useEffect(() => {
    if (b && (b.state === 'booked' || b.state === 'checked_in')) router.replace({ pathname: '/rajaa/pass/[id]', params: { id: b.id } });
  }, [b]);

  if (booking.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Skeleton height={180} radius={90} width={180} style={{ alignSelf: 'center' }} />
        <Skeleton height={200} radius={20} />
      </Screen>
    );
  }

  const cd = b?.heldUntil ? holdCountdown(b.heldUntil, now) : null;
  if (!b || b.state !== 'held' || !cd || cd.expired) {
    return (
      <Screen edges={['bottom']} testID="rajaa-hold-expired">
        <EmptyState
          icon="clock"
          title={b && b.state !== 'held' && b.state !== 'expired' ? t('rajaa.departure_gone') : t('intercity.hold_expired')}
          action={{ label: t('rajaa.back_to_board'), onPress: () => router.replace('/rajaa') }}
        />
      </Screen>
    );
  }

  const garage = garageName(network.data, b.departure.garageId);
  const seatsTotal = b.seatIds.length * b.seatPriceIqd;

  const confirm = () =>
    book.mutate(
      { bookingId: b.id, payment },
      {
        onSuccess: (done) => {
          // p4: the pass opens on the booked seat at once (no blank skeleton between the two screens).
          qc.setQueryData<BookingView[]>(api.routes.myBookings.queryKey(), (all) => (all ? all.map((x) => (x.id === done.id ? done : x)) : [done]));
          // The pass says "booked" in its own flow (`booked=1`): a toast here would sit over the car and plate.
          router.replace({ pathname: '/rajaa/pass/[id]', params: { id: done.id, booked: '1' } });
        },
        onError: (err) => {
          toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000);
          if (apiErrorCode(err) === 'wallet_insufficient') setPayment('cash');
        },
      },
    );

  const letGo = () =>
    release.mutate(
      { bookingId: b.id },
      {
        onSuccess: () => {
          toast.show({ message: t('rajaa.released') });
          router.replace('/rajaa');
        },
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }),
      },
    );

  return (
    <Screen
      testID="rajaa-hold"
      edges={['bottom']}
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button
            testID="rajaa-confirm"
            size="lg"
            fullWidth
            icon={payment === 'wallet' ? 'wallet' : 'check'}
            label={payment === 'wallet' ? t('rajaa.confirm_wallet', { amount: amountParam(b.totalIqd) }) : t('rajaa.confirm_cash')}
            loading={book.isPending}
            // p3: a wallet that can't cover the seat says so under the choice, with «اشحن»; no failing tap.
            disabled={payment === 'wallet' && walletShortBy(balance, b.totalIqd) > 0}
            onPress={confirm}
          />
          <Button testID="rajaa-release" variant="ghost" size="sm" label={t('rajaa.release_hold')} loading={release.isPending} onPress={letGo} />
        </View>
      }
    >
      <View style={{ alignItems: 'center', gap: theme.space[3], paddingTop: theme.space[2] }}>
        <CountdownRing
          testID="rajaa-hold-ring"
          mode="accept"
          format="clock"
          size={156}
          strokeWidth={9}
          urgentMs={60_000}
          startedAt={b.heldUntil!.getTime() - HOLD_MS}
          durationMs={HOLD_MS}
          caption={t('rajaa.hold_left')}
        />
        <View style={{ alignItems: 'center', gap: theme.space[1] }}>
          <Text variant="heading" align="center">
            {t('rajaa.hold_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('rajaa.hold_body')}
          </Text>
        </View>
      </View>

      <Card elevation={0} padding={4} testID="rajaa-hold-summary">
        <View style={{ gap: theme.space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
            <Text variant="title" tabular>
              {clockLabel(b.departure.departAt)}
            </Text>
            <Text variant="label" color="textMuted" style={{ flex: 1 }}>
              {garage}
            </Text>
          </View>
          <Text variant="footnote" color="textMuted">
            {t('rajaa.seat_label')}: {seatsList(t, b.seatIds)}
            {b.pickup.kind === 'pin'
              ? ` · ${stopNameOf(b.pickup, garage, { pin: t('rajaa.agree_pin_title'), door: t('rajaa.pickup_door'), place: publicPlaceName })}`
              : b.pickup.kind !== 'garage' && b.pickup.nameAr
                ? ` · ${publicPlaceName(b.pickup.nameAr)}`
                : ''}
          </Text>
          <Rule style={{ marginVertical: theme.space[2] }} />
          <PriceLine label={t('rajaa.line_seats', { n: b.seatIds.length, amount: amountParam(b.seatPriceIqd) })} amount={seatsTotal} />
          {b.frontPremiumIqd > 0 ? <PriceLine label={t('rajaa.line_front')} amount={b.frontPremiumIqd} /> : null}
          {b.lapChildren > 0 ? <FreeLine label={t('rajaa.line_lap', { n: b.lapChildren })} /> : null}
          {b.pickupFeeIqd > 0 ? (
            <PriceLine
              label={b.pickup.kind === 'door' ? t('rajaa.line_pickup_door') : b.pickup.kind === 'pin' ? t('rajaa.line_pickup_pin') : t('rajaa.line_pickup_way')}
              amount={b.pickupFeeIqd}
            />
          ) : null}
          {b.pickup.kind === 'pin' && b.pickupFeeIqd === 0 ? <FreeLine label={t('rajaa.line_pickup_pin')} /> : null}
          {b.dropoffFeeIqd > 0 ? (
            <PriceLine label={t('rajaa.line_dropoff_door')} amount={b.dropoffFeeIqd} />
          ) : b.dropoff ? (
            <FreeLine label={t('rajaa.line_dropoff_door')} />
          ) : null}
          {/* Step 5: priced by the server when his seat the other way is still booked; locked at «ثبّت». */}
          {b.returnDiscountIqd > 0 ? <PriceLine testID="rajaa-hold-return" label={t('rajaa.line_return_bundle')} amount={-b.returnDiscountIqd} /> : null}
          <PriceLine label={t('rajaa.total')} amount={b.totalIqd} strong />
          {b.pickup.kind === 'pin' || b.dropoff ? <AgreedNote /> : null}
          {b.pickup.status === 'pending' ? (
            <Text variant="caption" color="warningText">
              {t('intercity.pickup_pending')}
            </Text>
          ) : null}
        </View>
      </Card>

      <Section title={t('rajaa.pay_title')}>
        <PayCompare value={payment} onChange={setPayment} cancelUntil={clockLabel(boardingOpensAt(b.departure.departAt))} totalIqd={b.totalIqd} balanceIqd={balance} />
        {/* The balance line shows once the wallet read is in; until then a placeholder, and a retry if it failed. */}
        {wallet.data === undefined ? (
          <QueryBoundary query={wallet} size="inline" skeleton={<Skeleton height={44} radius={12} />} testID="rajaa-wallet-read">
            {() => null}
          </QueryBoundary>
        ) : null}
      </Section>
    </Screen>
  );
}
