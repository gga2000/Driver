import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { RequestShareInvite } from '@driver/contracts';
import { Button, Card, EmptyState, Icon, QueryBoundary, Skeleton, Stepper, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useWalletBalance } from '@/features/account/queries';
import { HeaderBack } from '@/features/food/HeaderBack';
import { clockLabel } from '@/features/rajaa/logic';
import { RuleList } from '@/features/rajaa/Option';
import { RajaaDriver } from '@/features/rajaa/RajaaDriver';
import { DetailPills } from '@/features/rajaa/RequestParts';
import { currentFix } from '@/features/account/device';
import { useJoinShare, useLeaveShare, useShareBoarding, useShareInvite } from '@/features/rajaa/queries';
import { joinPhase, joinPlacesMax } from '@/features/rajaa/share-car';
import { useNow } from '@/features/rajaa/useNow';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { requireSignIn } from '@/lib/guest';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { countKey } from '@/lib/plural';
import { useSignedIn } from '@/lib/session';

/**
 * Step 6 (Ali's item 56, s1): a friend opens the booker's link. He sees the trip, the driver and one
 * place's price, picks his places and pays from his wallet (held until the trip ends, back if it is
 * cancelled). Once in, the same page is his ticket for the shared car.
 */
export default function JoinSharedCar() {
  const t = useT();
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = String(raw ?? '').toUpperCase();
  const signedIn = useSignedIn();
  const invite = useShareInvite(code);
  const header = <Stack.Screen options={{ title: t('rajaa.join_title'), headerLeft: () => <HeaderBack /> }} />;

  if (!signedIn) {
    return (
      <Screen edges={['bottom']} testID="rajaa-join-guest">
        {header}
        <EmptyState icon="share" title={t('rajaa.join_guest')} action={{ label: t('rajaa.join_sign_in'), onPress: () => void requireSignIn(`/rajaa/join/${code}`) }} />
      </Screen>
    );
  }

  // The booker (or his driver) opened his own link: his screen is the request.
  if (invite.isError && apiErrorCode(invite.error) === 'forbidden') {
    return (
      <Screen edges={['bottom']} testID="rajaa-join-yours">
        {header}
        <EmptyState icon="car" title={t('rajaa.join_yours')} body={t('rajaa.join_yours_body')} action={{ label: t('rajaa.join_yours_cta'), onPress: () => router.replace('/rajaa/request') }} />
      </Screen>
    );
  }

  if (invite.data) return <JoinBody v={invite.data} header={header} />;
  return (
    <Screen edges={['bottom']} testID="rajaa-join-loading">
      {header}
      <QueryBoundary
        query={invite}
        testID="rajaa-join-read"
        skeleton={
          <View style={{ gap: 16 }}>
            <Skeleton height={120} radius={20} />
            <Skeleton height={72} radius={16} />
            <Skeleton height={160} radius={20} />
          </View>
        }
        gone={{ icon: 'share', title: t('rajaa.join_gone'), body: t('rajaa.join_gone_body'), action: { label: t('rajaa.back_to_board'), onPress: () => router.replace('/rajaa') } }}
      >
        {() => null}
      </QueryBoundary>
    </Screen>
  );
}

function JoinBody({ v, header }: { v: RequestShareInvite; header: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  // Failures surface as a toast from each tap's onError.
  const { mutate: joinCar, isPending: joining } = useJoinShare();
  const { mutate: leaveCar, isPending: leaving } = useLeaveShare();
  const boarding = useShareBoarding();
  const wallet = useWalletBalance();
  const now = useNow(30_000);
  const phase = joinPhase(v);
  const max = joinPlacesMax(v);
  const [places, setPlaces] = useState(1);
  const n = Math.min(places, Math.max(1, max));
  const total = n * v.placeIqd;
  const balance = wallet.isError ? null : (wallet.data?.moneyIqd ?? null);
  const short = balance !== null ? Math.max(0, total - balance) : 0;
  const closes = clockLabel(v.closesAt);
  const sameDay = Math.floor((v.when.getTime() + 3 * 3600_000) / 86_400_000) === Math.floor((now.getTime() + 3 * 3600_000) / 86_400_000);
  const failed = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000);
  // Way C (Ali 2026-10-09): once the driver is here, each friend says «صعدت» next to the car.
  const canBoard = phase === 'joined' && v.state === 'driver_arrived' && v.myBoardedBy === null;
  const board = async () => {
    const fix = await currentFix();
    if (fix === 'denied' || fix === null) {
      toast.show({ message: t('rajaa.join_board_location'), tone: 'warning', icon: 'map-pin' }, 6000);
      return;
    }
    boarding.board.mutate({ code: v.code, ...fix.pin }, { onSuccess: () => theme.haptic('success'), onError: failed });
  };

  const footer =
    phase === 'join' ? (
      <View style={{ gap: theme.space[2] }}>
        {short > 0 ? (
          <Button testID="rajaa-join-topup" variant="secondary" icon="wallet" fullWidth label={t('rajaa.join_topup')} onPress={() => router.push('/topup')} />
        ) : null}
        <Button
          testID="rajaa-join-cta"
          size="lg"
          fullWidth
          icon="wallet"
          label={t('rajaa.join_cta', { amount: amountParam(total) })}
          disabled={short > 0}
          loading={joining}
          onPress={() => joinCar({ code: v.code, places: n }, { onError: failed })}
        />
      </View>
    ) : canBoard ? (
      <View style={{ gap: theme.space[2] }}>
        <Button testID="rajaa-join-board" size="lg" fullWidth icon="check" label={t('rajaa.join_board_cta')} loading={boarding.board.isPending} onPress={() => void board()} />
        <Text variant="caption" color="textMuted" align="center">
          {t('rajaa.join_board_hint')}
        </Text>
      </View>
    ) : phase === 'joined' && v.myBoardedBy === 'driver' ? (
      <Button
        testID="rajaa-join-not-boarded"
        variant="ghost"
        fullWidth
        label={t('rajaa.join_not_boarded')}
        loading={boarding.notBoarded.isPending}
        onPress={() => boarding.notBoarded.mutate({ code: v.code }, { onSuccess: () => toast.show({ message: t('rajaa.join_not_boarded_toast') }), onError: failed })}
      />
    ) : phase === 'joined' && v.open ? (
      <Button
        testID="rajaa-join-leave"
        variant="ghost"
        fullWidth
        label={t('rajaa.join_leave')}
        loading={leaving}
        onPress={() => leaveCar({ code: v.code }, { onSuccess: () => toast.show({ message: t('rajaa.join_left_toast') }), onError: failed })}
      />
    ) : null;

  return (
    <Screen edges={['bottom']} testID="rajaa-join" footer={footer}>
      {header}
      <View style={{ gap: theme.space[4] }}>
        <Card padding={4} elevation={1} testID="rajaa-join-trip">
          <View style={{ gap: theme.space[2] }}>
            <Text variant="caption" weight={600} color="accentText">
              {v.bookerName ? t('rajaa.join_heading', { name: v.bookerName }) : t('rajaa.join_heading_anon')}
            </Text>
            <Text variant="title" weight={700}>
              {t('rajaa.route', { from: v.from.label, to: v.to.label })}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t(sameDay ? 'rajaa.day_today' : 'rajaa.day_tomorrow')} {clockLabel(v.when)}
            </Text>
            <DetailPills details={v.details} when={v.when} testID="rajaa-join-details" />
            <RajaaDriver dep={{ vehicle: v.driver?.vehicle ?? null }} card={v.driver} testID="rajaa-join-driver" />
          </View>
        </Card>

        {phase === 'join' ? (
          <View style={{ gap: theme.space[3] }} testID="rajaa-join-form">
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space[2] }}>
              <View style={{ gap: 2 }}>
                <Text variant="caption" weight={600} color="textMuted">
                  {t('rajaa.join_place_price')}
                </Text>
                <Text variant="title" weight={700} testID="rajaa-join-price">
                  {iqd(v.placeIqd, { locale })}
                </Text>
              </View>
              <Text variant="footnote" color="textMuted">
                {t('rajaa.join_left', { n: v.placesLeft })}
              </Text>
            </View>
            {max > 1 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56 }} testID="rajaa-join-places">
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" weight={600}>
                    {t('rajaa.join_how_many')}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {t('rajaa.join_how_many_hint')}
                  </Text>
                </View>
                <Stepper size="sm" value={n} min={1} max={max} onChange={setPlaces} accessibilityLabel={t('rajaa.join_how_many')} />
              </View>
            ) : null}
            <View style={{ gap: theme.space[1], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken }} testID="rajaa-join-total">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[2] }}>
                <Text variant="footnote" weight={600}>
                  {t('rajaa.join_total')}
                </Text>
                <Text variant="label" weight={700}>
                  {iqd(total, { locale })}
                </Text>
              </View>
              {balance !== null ? (
                <Text variant="caption" color={short > 0 ? 'dangerText' : 'textMuted'} testID="rajaa-join-wallet">
                  {short > 0 ? t('rajaa.join_wallet_short', { amount: amountParam(short) }) : t('rajaa.join_wallet', { amount: amountParam(balance) })}
                </Text>
              ) : null}
            </View>
            <RuleList items={[t('rajaa.join_rule_hold'), t('rajaa.join_rule_leave', { time: closes }), t('rajaa.join_rule_cancel')]} />
          </View>
        ) : phase === 'joined' ? (
          <View testID="rajaa-join-joined" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={22} color="successText" strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight={700} color="successText">
                  {t('rajaa.join_joined')}
                </Text>
                <Text variant="footnote">
                  {v.myPlaces > 1 ? t('rajaa.join_joined_many', { places: t(countKey('rajaa.carshare_places', v.myPlaces), { n: v.myPlaces }), amount: amountParam(v.myAmountIqd) }) : t('rajaa.join_joined_one', { amount: amountParam(v.myAmountIqd) })}
                </Text>
              </View>
            </View>
            <Text variant="footnote" weight={600} testID="rajaa-join-meet">
              {v.myBoardedBy === 'self'
                ? t('rajaa.join_boarded_self')
                : v.myBoardedBy === 'driver'
                  ? t('rajaa.join_boarded_driver')
                  : v.driverArrivedAt
                    ? t('rajaa.join_arrived', { from: v.from.label })
                    : t('rajaa.join_meet', { from: v.from.label })}
            </Text>
            {v.open ? <RuleList items={[t('rajaa.join_rule_leave', { time: closes }), t('rajaa.join_rule_cancel')]} /> : null}
          </View>
        ) : (
          <EmptyState
            icon={phase === 'done' ? 'check' : phase === 'full' ? 'seat' : 'clock'}
            title={t(phase === 'done' ? 'rajaa.join_done' : phase === 'full' ? 'rajaa.join_full' : phase === 'closed' ? 'rajaa.join_closed' : 'rajaa.join_ended')}
            body={
              phase === 'done'
                ? t('rajaa.join_done_body', { amount: amountParam(v.myAmountIqd) })
                : t(phase === 'full' ? 'rajaa.join_full_body' : phase === 'closed' ? 'rajaa.join_closed_body' : 'rajaa.join_ended_body')
            }
            action={{ label: t('rajaa.back_to_board'), onPress: () => router.replace('/rajaa') }}
          />
        )}
      </View>
    </Screen>
  );
}
