import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Share, View } from 'react-native';
import { Button, Card, CountdownRing, EmptyState, Icon, Rule, Skeleton, StatusPill, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { bookingStateLabel, plate, prepayLabel, routeLabel, seatsList, vehicleLine } from '@/features/rajaa/labels';
import { cancelRule, clockLabel, boardingOpensAt, haversineM, RAJAA_RULES, publicPlaceName } from '@/features/rajaa/logic';
import { currentLocation } from '@/features/rajaa/location';
import { garageName, useBoardingPass, useBooking, useCancelSeat, useImHere, useNetwork } from '@/features/rajaa/queries';
import { shareUrl } from '@/features/rajaa/share';
import { useNow } from '@/features/rajaa/useNow';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';

const MIN = 60_000;

function Field({ label, value, icon }: { label: string; value: string; icon: IconName }) {
  const theme = useTheme();
  return (
    <View style={{ flexBasis: '46%', flexGrow: 1, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} size={14} color="textMuted" />
        <Text variant="caption" color="textMuted">
          {label}
        </Text>
      </View>
      <Text variant="label" weight={600} style={{ paddingStart: theme.space[1] }}>
        {value}
      </Text>
    </View>
  );
}

/**
 * My trip / boarding pass (spec §2, decisions §8, review C-44/45): the PIN big enough to read in a
 * crowded garage, seat, garage, how it's paid, the grace and late-meter rules for this seat, the
 * live car from T−30, "أني بالكراج", share, and cancel with its rule shown before the button.
 */
export default function BoardingPassScreen() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const client = useApiClient();
  const locale = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = String(id ?? '');
  const booking = useBooking(bookingId);
  const b = booking.data ?? null;
  const live = !!b && (b.state === 'booked' || b.state === 'checked_in');
  const pass = useBoardingPass(bookingId, live);
  const network = useNetwork();
  const imHere = useImHere();
  const cancel = useCancelSeat();
  const [asking, setAsking] = useState(false);
  const now = useNow(1000);

  if (booking.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Skeleton height={320} radius={24} />
        <Skeleton height={120} radius={20} />
      </Screen>
    );
  }
  if (!b) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState icon="receipt" title={t('error.generic')} action={{ label: t('rajaa.back_to_board'), onPress: () => router.replace('/rajaa') }} />
      </Screen>
    );
  }

  const p = pass.data ?? null;
  const corridor = network.data?.corridors.find((c) => c.id === b.departure.corridorId);
  const route = corridor ? routeLabel(t, corridor.cityId, b.departure.direction) : '';
  const garage = garageName(network.data, b.departure.garageId);
  const rule = cancelRule(b, now);
  const opensAt = boardingOpensAt(b.departure.departAt);
  const atPoint = b.pickup.kind !== 'garage';
  const stopName = b.pickup.kind === 'garage' ? garage : (b.pickup.nameAr ? publicPlaceName(b.pickup.nameAr) : null) ?? t('rajaa.pickup_door');
  const prepaid = p ? p.prepayRail !== 'cash_reservation' : b.prepaid;
  const graceMs = p?.graceEndsAt ? p.graceEndsAt.getTime() - b.departure.departAt.getTime() : RAJAA_RULES.prepaidGraceMin * MIN;

  const carKm = p?.car ? haversineM(p.car, p.myStop) / 1000 : null;
  const carAgeS = p?.car ? Math.max(0, Math.round((now.getTime() - p.car.at.getTime()) / 1000)) : null;

  const onImHere = async () => {
    const at = await currentLocation();
    if (!at) {
      toast.show({ message: t('error.location_off'), tone: 'warning', icon: 'location-arrow' }, 5000);
      return;
    }
    imHere.mutate(
      { bookingId: b.id, lat: at.lat, lng: at.lng },
      {
        onSuccess: (r) => {
          if (r.warning === 'meeting_point_mismatch') toast.show({ message: t('intercity.meeting_point_mismatch', { place: stopName }), tone: 'warning' }, 6000);
          else if (atPoint) toast.show({ message: t('rajaa.im_here_point_ok'), tone: 'success' });
          else toast.show({ message: r.atGarage ? t('rajaa.im_here_ok') : t('rajaa.im_here_far'), tone: r.atGarage ? 'success' : 'warning' }, 5000);
        },
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }),
      },
    );
  };

  const onShare = async () => {
    // A signed link that stops working 30 min after arrival (`tracking.createShareLink`).
    let link: string;
    try {
      link = shareUrl((await client.tracking.createShareLink.mutate({ bookingId: b.id })).path);
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' });
      return;
    }
    const message = t('rajaa.share_message', { route, time: clockLabel(b.departure.departAt), plate: plate(b.departure.vehicle.plate), link });
    try {
      await Share.share({ message });
    } catch {
      toast.show({ message: t('rajaa.share_copied', { link }) }, 6000);
    }
  };

  const onCancel = () =>
    cancel.mutate(
      { bookingId: b.id },
      {
        onSuccess: () => {
          toast.show({ message: t('rajaa.cancelled_toast') });
          router.replace('/rajaa');
        },
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000),
      },
    );

  const cancelText =
    rule.kind === 'prepaid'
      ? rule.canCancel
        ? t('rajaa.cancel_rule_prepaid', { time: clockLabel(rule.until) })
        : t('rajaa.cancel_rule_closed')
      : rule.kind === 'cash'
        ? t('rajaa.cancel_rule_cash')
        : null;

  return (
    <Screen testID="rajaa-pass" edges={['bottom']}>
      {/* The ticket. */}
      <Card padding={0} elevation={2} testID="rajaa-ticket">
        <View style={{ padding: theme.space[5], gap: theme.space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="label" color="textMuted" style={{ flex: 1 }}>
              {route}
            </Text>
            <StatusPill size="sm" tone={b.state === 'checked_in' ? 'success' : 'accent'} icon="check" label={bookingStateLabel(t, b.state)} />
          </View>
          <Text variant="display" tabular>
            {clockLabel(b.departure.departAt)}
          </Text>
          <Text variant="footnote" color="textMuted">
            {t('intercity.leaves_at_or_full', { time: clockLabel(b.departure.departAt) })} · {t('intercity.latest_departure', { time: clockLabel(b.departure.latestDepartureAt) })}
          </Text>
        </View>
        <Rule kind="dashed" color="borderStrong" />
        <View style={{ padding: theme.space[5], alignItems: 'center', gap: theme.space[1], backgroundColor: theme.colors.accentTint }}>
          <Text variant="caption" color="accentText" weight={600}>
            {t('rajaa.pin_label')}
          </Text>
          <Text testID="rajaa-pin" variant="numeralLg" style={{ letterSpacing: 14, paddingStart: 14 }}>
            {p?.pin ?? b.pin ?? '····'}
          </Text>
          <Text variant="footnote" color="accentText">
            {t('rajaa.pin_hint')}
          </Text>
        </View>
        <Rule kind="dashed" color="borderStrong" />
        <View style={{ padding: theme.space[5], flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.space[4], columnGap: theme.space[3] }}>
          <Field icon="seat" label={t('rajaa.seat_label')} value={seatsList(t, b.seatIds)} />
          <Field icon={atPoint ? 'map-pin' : 'garage'} label={atPoint ? t('rajaa.stop_label') : t('rajaa.garage_label')} value={stopName} />
          <Field icon="wallet" label={t('rajaa.payment_label')} value={`${prepayLabel(t, p?.prepayRail ?? (b.prepaid ? 'wallet' : 'cash_reservation'))} · ${iqd(b.totalIqd, { locale })}`} />
          <Field icon="car" label={t('rajaa.car_label')} value={vehicleLine(t, b.departure.vehicle)} />
        </View>
        {b.pickup.status === 'pending' ? (
          <View style={{ paddingHorizontal: theme.space[5], paddingBottom: theme.space[4] }}>
            <StatusPill tone="warning" icon="clock" label={t('intercity.pickup_pending')} />
          </View>
        ) : null}
      </Card>

      {/* Live car from T−30 (the car only, never other riders' stops). */}
      <Card padding={4} elevation={0} testID="rajaa-live-car">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p?.car ? theme.colors.successTint : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="car" size={22} color={p?.car ? 'successText' : 'textMuted'} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            {!p?.boardingOpen ? (
              <Text variant="footnote" color="textMuted">
                {t('rajaa.pass_opens', { time: clockLabel(opensAt) })}
              </Text>
            ) : p.car && carKm !== null ? (
              <>
                <Text variant="label" weight={600}>
                  {carKm < 0.15 ? t('rajaa.car_here') : t('rajaa.car_live', { km: carKm.toFixed(1) })}
                </Text>
                <Text variant="caption" color="textMuted" tabular>
                  {t('rajaa.car_seen', { s: carAgeS ?? 0 })}
                </Text>
              </>
            ) : (
              <Text variant="footnote" color="textMuted">
                {t('rajaa.car_waiting')}
              </Text>
            )}
          </View>
          {p?.boardingOpen ? <StatusPill size="sm" tone="success" live label={t('rajaa.live')} /> : null}
        </View>
      </Card>

      {/* Grace and the late meter, stated before anyone is late. */}
      <Card padding={4} elevation={0} testID="rajaa-grace">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
          {prepaid ? (
            <CountdownRing
              mode="late"
              size={92}
              strokeWidth={7}
              startedAt={b.departure.departAt.getTime()}
              config={{
                graceMs,
                stepMs: RAJAA_RULES.meterBlockMin * MIN,
                stepAmount: RAJAA_RULES.riderLateToDriverPerBlockIqd,
                forfeitMs: RAJAA_RULES.meterCapMin * MIN,
              }}
            />
          ) : (
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.warningTint, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="clock" size={26} color="warningText" />
            </View>
          )}
          <View style={{ flex: 1, gap: theme.space[1] }}>
            <Text variant="footnote">
              {prepaid
                ? t('rajaa.grace_prepaid', {
                    amount: amountParam(RAJAA_RULES.riderLateToDriverPerBlockIqd),
                    each: amountParam(RAJAA_RULES.riderLateToEachRiderPerBlockIqd),
                  })
                : t('rajaa.grace_cash')}
            </Text>
            <Text variant="caption" color="textMuted">
              {t('rajaa.driver_late_note', { amount: amountParam(RAJAA_RULES.driverLateToEachRiderPerBlockIqd) })}
            </Text>
            {p?.meterMinutes ? (
              <Text variant="caption" color="warningText" weight={600}>
                {t('rajaa.meter_running')}: {t('unit.minutes', { n: p.meterMinutes })}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], justifyContent: 'center' }}>
        <Icon name="shield" size={16} color="textMuted" />
        <Text variant="footnote" color="textMuted">
          {t('intercity.id_reminder')}
        </Text>
      </View>

      <View style={{ gap: theme.space[3] }}>
        {b.state === 'booked' ? (
          <Button testID="rajaa-im-here" size="lg" fullWidth icon="location-arrow" label={atPoint ? t('rajaa.im_at_point') : t('intercity.im_at_garage')} loading={imHere.isPending} onPress={() => void onImHere()} />
        ) : null}
        <Button testID="rajaa-share" variant="secondary" fullWidth icon="share" label={t('rajaa.share_trip')} onPress={() => void onShare()} />
      </View>

      {cancelText ? (
        <View style={{ gap: theme.space[2] }} testID="rajaa-cancel">
          <Text variant="footnote" color="textMuted" align="center">
            {cancelText}
          </Text>
          {rule.canCancel ? (
            asking ? (
              <View style={{ gap: theme.space[2] }}>
                <Text variant="label" align="center">
                  {t('rajaa.cancel_ask')}
                </Text>
                <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                  <Button style={{ flex: 1 }} variant="destructive" label={t('rajaa.cancel_confirm')} loading={cancel.isPending} onPress={onCancel} />
                  <Button style={{ flex: 1 }} variant="secondary" label={t('action.back')} onPress={() => setAsking(false)} />
                </View>
              </View>
            ) : (
              <Button variant="ghost" size="sm" label={t('intercity.cancel_rider')} onPress={() => setAsking(true)} />
            )
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
