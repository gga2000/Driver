import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Share, View } from 'react-native';
import { Button, Card, DepartureTime, EmptyState, Icon, QueryBoundary, Skeleton, StatusPill, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { bookingStateLabel, cityName, plate, prepayLabel, routeLabel, seatsList } from '@/features/rajaa/labels';
import { stopNameOf } from '@/features/rajaa/agree';
import { lateStages, passPhase } from '@/features/rajaa/pass';
import { LateBar, LeaveHomeCard } from '@/features/rajaa/PassParts';
import { endGarageFor, roadLine, type RoadPoint } from '@/features/rajaa/road';
import { RoadCard, type Watching } from '@/features/rajaa/RoadParts';
import { useMe } from '@/features/account/queries';
import { KeptStub, Perforation } from '@/features/rajaa/PassTicket';
import { SafeArrival } from '@/features/rajaa/SafeArrival';
import { ArmedRideCard } from '@/features/ride/ArmedRideCard';
import { GarageTaxiCard } from '@/features/ride/GarageTaxiCard';
import { DinnerCard, FavouriteToggle } from '@/features/ride-habits/Cards';
import { useDinnerChance, useFavourites } from '@/features/ride-habits/queries';
import { RajaaDriver } from '@/features/rajaa/RajaaDriver';
import { SosControl } from '@/features/safety/SosControl';
import { cancelRule, clockLabel, boardingOpensAt, endpoints, flip, haversineM, RAJAA_RULES, publicPlaceName } from '@/features/rajaa/logic';
import { ReturnBundleCard, ReturnPairedLine } from '@/features/rajaa/ReturnParts';
import { ShareMomentButton } from '@/features/share-card/ShareMomentButton';
import { currentLocation } from '@/features/rajaa/location';
import { garageName, useBoardingPass, useBooking, useCancelSeat, useDriverCards, useImHere, useMyBookings, useNetwork } from '@/features/rajaa/queries';
import { firstSeatId } from '@/features/firsts/firsts';
import { FirstMoment } from '@/features/firsts/FirstMoment';
import { shareUrl } from '@/features/rajaa/share';
import { useNow } from '@/features/rajaa/useNow';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { deliveryPointOf, selectedPlace, useProfile } from '@/lib/profile';
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
/** The pass's own toasts sit at the top and a good-news one leaves after 3 s, so none covers the pass or its cancel (C-38, R-10). */
const PASS_TOAST_MS = 3000;

export default function BoardingPassScreen() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const client = useApiClient();
  const locale = useLocale();
  // `booked=1`: straight from "احجز" — the confirmation sits above the ticket, never over it.
  const { id, booked } = useLocalSearchParams<{ id: string; booked?: string }>();
  const bookingId = String(id ?? '');
  const booking = useBooking(bookingId);
  const b = booking.data ?? null;
  const live = !!b && (b.state === 'booked' || b.state === 'checked_in');
  // «أول مرة» (joy g8): the person's first real seat, straight after «احجز».
  const myBookings = useMyBookings();
  const firstSeat = booked === '1' && b?.state === 'booked' && firstSeatId(myBookings.data ?? []) === b.id;
  const pass = useBoardingPass(bookingId, live);
  // سايقك (C-19): his first name and today's check-in, next to the car and plate.
  const driverCard = useDriverCards(b ? [b.departure.id] : []).data?.get(b?.departure.id ?? '');
  const network = useNetwork();
  const imHere = useImHere();
  const cancel = useCancelSeat();
  const [asking, setAsking] = useState(false);
  const now = useNow(1000);
  // Joy l9 / r6: the favourite heart after a good rating; dinner timed to the arrival home.
  const favs = useFavourites();
  const dinner = useDinnerChance(live && b?.departure.direction === 'to_aziziyah');
  const prof = useProfile();
  const me = useMe();

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
  const stopName = stopNameOf(b.pickup, garage, { pin: t('rajaa.agree_pin_title'), door: t('rajaa.pickup_door'), place: publicPlaceName });
  const prepaid = p ? p.prepayRail !== 'cash_reservation' : b.prepaid;
  const graceMs = p?.graceEndsAt ? p.graceEndsAt.getTime() - b.departure.departAt.getTime() : RAJAA_RULES.prepaidGraceMin * MIN;

  const carKm = p?.car ? haversineM(p.car, p.myStop) / 1000 : null;
  const carAgeS = p?.car ? Math.max(0, Math.round((now.getTime() - p.car.at.getTime()) / 1000)) : null;
  // t4: leaving Aziziyah from a garage, when to leave home (the saved place, never asked for here).
  const homePlace = selectedPlace(prof);
  const homePin = b.departure.direction === 'from_aziziyah' && b.pickup.kind === 'garage' && homePlace ? (deliveryPointOf(homePlace).pin ?? null) : null;
  const garagePin = network.data?.garages.find((g) => g.id === b.departure.garageId) ?? null;

  // r1/r2: the road as a line from this garage to the far city, with the checkpoints and the rider's
  // own stop; the car's fix counts only once it has left (before that it is driving to the garage).
  const phase = passPhase(b, now);
  const departed = b.departure.state === 'departed';
  const toCity = corridor ? endpoints(corridor.cityId, b.departure.direction).to : null;
  const endGarage = toCity ? endGarageFor(network.data?.garages ?? [], toCity) : null;
  const road =
    corridor && garagePin && endGarage && toCity && phase !== 'kept' && phase !== 'closed'
      ? roadLine({
          start: { id: 'start', kind: 'start', name: garage, lat: garagePin.lat, lng: garagePin.lng },
          end: { id: 'end', kind: 'end', name: cityName(t, toCity), lat: endGarage.lat, lng: endGarage.lng },
          between: [
            ...corridor.checkpoints.map((c): RoadPoint => ({ id: c.id, kind: 'checkpoint', name: publicPlaceName(c.nameAr), lat: c.lat, lng: c.lng })),
            ...(b.pickup.kind !== 'garage' ? [{ id: 'my_stop', kind: 'my_stop' as const, name: stopName, lat: b.pickup.lat, lng: b.pickup.lng }] : []),
          ],
          departAt: b.departure.departAt,
          departedAt: b.departure.departedAt,
          travelMin: corridor.travelMin,
          car: departed && p?.car ? p.car : null,
          now,
        })
      : null;
  // r3: who follows the trip, by name (the trusted people get its link when the rider gets in).
  const trusted = (me.data?.trustedContacts ?? []).map((c) => c.name);
  // Unknown (null) until the profile is in: never «nobody follows» just because the read failed.
  const watching: Watching | null = !me.data
    ? null
    : me.data.safety.autoShareRajaa && trusted.length > 0
      ? { kind: b.state === 'checked_in' ? 'now' : 'soon', names: trusted }
      : { kind: 'none' };
  // r4: the same SOS as a taxi ride: the car read out to the police, and a live link when no contact is set.
  const sosCar = [driverCard?.firstName ?? t('track.driver_fallback'), b.departure.vehicle.model, plate(b.departure.vehicle.plate)].filter(Boolean).join(' · ');

  const onImHere = async () => {
    const at = await currentLocation();
    if (!at) {
      toast.show({ message: t('error.location_off'), tone: 'warning', icon: 'location-arrow', placement: 'top' }, 5000);
      return;
    }
    imHere.mutate(
      { bookingId: b.id, lat: at.lat, lng: at.lng },
      {
        onSuccess: (r) => {
          if (r.warning === 'meeting_point_mismatch') toast.show({ message: t('intercity.meeting_point_mismatch', { place: stopName }), tone: 'warning', placement: 'top' }, 6000);
          else if (atPoint) toast.show({ message: t('rajaa.im_here_point_ok'), tone: 'success', placement: 'top' }, PASS_TOAST_MS);
          else toast.show({ message: r.atGarage ? t('rajaa.im_here_ok') : t('rajaa.im_here_far'), tone: r.atGarage ? 'success' : 'warning', placement: 'top' }, r.atGarage ? PASS_TOAST_MS : 5000);
        },
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger', placement: 'top' }),
      },
    );
  };

  const onShare = async () => {
    // A signed link that stops working 30 min after arrival (`tracking.createShareLink`).
    let link: string;
    try {
      link = shareUrl((await client.tracking.createShareLink.mutate({ bookingId: b.id })).path);
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning', placement: 'top' });
      return;
    }
    const message = t('rajaa.share_message', { route, time: clockLabel(b.departure.departAt), plate: plate(b.departure.vehicle.plate), link });
    try {
      await Share.share({ message });
    } catch {
      toast.show({ message: t('rajaa.share_copied', { link }), placement: 'top' }, 6000);
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
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger', placement: 'top' }, 5000),
      },
    );

  // After the trip (r3): the stub is kept; nothing live (car, meter, check-in, cancel) is left on it.
  if (phase === 'kept') {
    return (
      <Screen testID="rajaa-pass" edges={['bottom']}>
        <Stack.Screen options={{ title: t('rajaa.kept_title') }} />
        <SafeArrival booking={b} route={route} driverName={driverCard?.firstName ?? null} now={now} />
        {(b.rating?.stars ?? 0) >= 4 ? <FavouriteToggle source={{ bookingId: b.id }} driverId={b.departure.driverId} favourites={favs.data ?? []} name={driverCard?.firstName ?? null} /> : null}
        {/* Joy l5: a picture of the safe arrival to share (no address, the first name only if chosen). */}
        <ShareMomentButton moment={{ kind: 'rajaa', toCity: corridor ? cityName(t, endpoints(corridor.cityId, b.departure.direction).to) : null }} id={b.id} />
        <KeptStub booking={b} route={route} garage={garage} driver={driverCard} />
      </Screen>
    );
  }

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
      {/* SOS once the rider is with the car (scoring & safety §3): boarding at the garage, on the road. */}
      <Stack.Screen
        options={{
          headerRight:
            b.state === 'checked_in' || (live && (b.departure.state === 'boarding' || b.departure.state === 'departed'))
              ? () => <SosControl subject={{ kind: 'booking', id: b.id }} car={sosCar} onShareLocation={() => void onShare()} style={{ marginEnd: theme.space[3] }} />
              : undefined,
        }}
      />
      {booked === '1' && b.state === 'booked' ? (
        <View testID="rajaa-booked-note" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="check" size={18} color="successText" strokeWidth={2.4} />
          <Text variant="label" weight={600} color="successText" style={{ flexShrink: 1 }}>
            {t('rajaa.booked_toast')}
          </Text>
        </View>
      ) : null}
      {/* The ticket. */}
      <Card padding={0} elevation={2} testID="rajaa-ticket">
        <View style={{ padding: theme.space[5], gap: theme.space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="label" color="textMuted" style={{ flex: 1 }}>
              {route}
            </Text>
            <StatusPill size="sm" tone={b.state === 'checked_in' ? 'success' : 'accent'} icon="check" label={bookingStateLabel(t, b.state)} />
          </View>
          {/* The garage-board time (audit d-2): split-flap digits and the countdown to the car. */}
          <DepartureTime
            testID="rajaa-pass-time"
            at={departed && b.departure.departedAt ? b.departure.departedAt : b.departure.departAt}
            now={now.getTime()}
            size="card"
            label={departed ? t('departure_time.left') : t('departure_time.leaves')}
            countdown={!departed && b.state !== 'completed'}
            passStyle
            locale={locale}
          />
          {departed ? null : (
            <Text variant="footnote" color="textMuted">
              {t('rajaa.or_full_latest', { time: clockLabel(b.departure.latestDepartureAt) })}
            </Text>
          )}
        </View>
        <Perforation />
        <View style={{ padding: theme.space[5], alignItems: 'center', gap: theme.space[1], backgroundColor: theme.colors.accentTint }}>
          <Text variant="caption" color="accentText" weight={600}>
            {t('rajaa.pin_label')}
          </Text>
          <Text testID="rajaa-pin" variant="numeralLg" face="display" style={{ letterSpacing: 14, paddingStart: 14 }}>
            {p?.pin ?? b.pin ?? '····'}
          </Text>
          <Text variant="footnote" color="accentText">
            {t('rajaa.pin_hint')}
          </Text>
        </View>
        <Perforation />
        <View style={{ padding: theme.space[5], flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.space[4], columnGap: theme.space[3] }}>
          <Field icon="seat" label={t('rajaa.seat_label')} value={b.lapChildren > 0 ? `${seatsList(t, b.seatIds)} · ${t('rajaa.line_lap', { n: b.lapChildren })}` : seatsList(t, b.seatIds)} />
          <Field icon={atPoint ? 'map-pin' : 'garage'} label={atPoint ? t('rajaa.stop_label') : t('rajaa.garage_label')} value={stopName} />
          {b.dropoff ? (
            <Field icon="home" label={t('rajaa.drop_label')} value={b.dropoff.note ?? (toCity ? t('rajaa.agree_door_title', { city: cityName(t, toCity) }) : t('rajaa.agree_ask_door'))} />
          ) : null}
          <Field icon="wallet" label={t('rajaa.payment_label')} value={`${prepayLabel(t, p?.prepayRail ?? (b.prepaid ? 'wallet' : 'cash_reservation'))} · ${iqd(b.totalIqd, { locale })}`} />
        </View>
        {b.returnPairBookingId ? (
          <View style={{ paddingHorizontal: theme.space[5], paddingBottom: theme.space[4] }}>
            <ReturnPairedLine savedIqd={b.returnDiscountIqd} />
          </View>
        ) : null}
        <Perforation />
        <RajaaDriver dep={b.departure} card={driverCard} size="lg" eyebrow record={{ departureId: b.departure.id, line: true }} testID="rajaa-pass-driver" style={{ padding: theme.space[5], paddingBottom: theme.space[3] }} />
        {b.pickup.status === 'pending' ? (
          <View style={{ paddingHorizontal: theme.space[5], paddingBottom: theme.space[4] }}>
            <StatusPill tone="warning" icon="clock" label={t('intercity.pickup_pending')} />
          </View>
        ) : null}
        {/* The car's state, on the ticket (t1): from T−30 where it is (the car only, never other riders' stops).
            On the road the road card carries the car instead. */}
        {departed ? null : (
        <View testID="rajaa-live-car" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], marginHorizontal: theme.space[5], marginBottom: theme.space[5], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken }}>
          <Icon name="car" size={20} color={p?.car ? 'successText' : 'textMuted'} />
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
        )}
      </Card>

      {/* t2: the first-trip sticker comes after the pass, never pushing it down. */}
      <FirstMoment kind={firstSeat ? 'rajaa' : null} haptic />

      {homePin && garagePin && b.state === 'booked' ? <LeaveHomeCard home={homePin} garage={garagePin} departAt={b.departure.departAt} now={now} /> : null}

      {/* x2/x4 (docs/api/rajaa-taxi.md): a taxi to the garage on a seat leaving Aziziyah, a taxi home
          waiting at the garage on a seat coming back. Each hides itself where it doesn't apply. */}
      <GarageTaxiCard bookingId={b.id} />
      <ArmedRideCard bookingId={b.id} />

      {/* Step 5: before his car leaves, the way back booked now takes the percent off both seats. */}
      {b.returnOfferPercent !== null ? (
        <ReturnBundleCard
          percent={b.returnOfferPercent}
          onPress={() => router.push({ pathname: '/rajaa', params: { corridor: b.departure.corridorId, direction: flip(b.departure.direction) } })}
        />
      ) : null}
      {road && toCity ? <RoadCard line={road} city={cityName(t, toCity)} onRoad={departed} watching={watching}
          unknown={
            <QueryBoundary query={me} size="inline" skeleton={<Skeleton height={44} radius={12} />} testID="rajaa-watching-read">
              {() => null}
            </QueryBoundary>
          }
          onShare={() => void onShare()}
        /> : null}

      {/* Joy r6: «عشاك يوصل وياك» on the way back to Aziziyah. */}
      {dinner.data?.source.kind === 'rajaa' && dinner.data.source.bookingId === b.id ? <DinnerCard chance={dinner.data} now={now} testID="rajaa-dinner" /> : null}

      {/* Grace and the late meter as a bar with its times (t6), stated before anyone is late. */}
      {/* Once he is in the car nobody can be late any more: the bar goes. */}
      {phase === 'before' || phase === 'boarding' ? (
      <Card padding={4} elevation={0} testID="rajaa-grace">
        <View style={{ gap: theme.space[3] }}>
          <LateBar
            stages={lateStages(b.departure.departAt, prepaid, graceMs, RAJAA_RULES.meterCapMin)}
            prepaid={prepaid}
            now={now}
            a11y={
              prepaid
                ? t('rajaa.grace_prepaid', { amount: amountParam(RAJAA_RULES.riderLateToDriverPerBlockIqd), each: amountParam(RAJAA_RULES.riderLateToEachRiderPerBlockIqd) })
                : t('rajaa.grace_cash')
            }
          />
          {p?.meterMinutes ? (
            <Text variant="caption" color="warningText" weight={600}>
              {t('rajaa.meter_running')}: {t('unit.minutes', { n: p.meterMinutes })}
            </Text>
          ) : null}
          <Text variant="caption" color="textMuted">
            {t('rajaa.driver_late_note', { amount: amountParam(RAJAA_RULES.driverLateToEachRiderPerBlockIqd) })}
          </Text>
        </View>
      </Card>
      ) : null}

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
