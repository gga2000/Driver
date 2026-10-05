import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { DriverDepartureView, IntercitySeatId, TravellingAs } from '@driver/contracts';
import { Button, Card, Chip, EmptyState, Icon, Rule, Skeleton, SlideToConfirm, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { departureTone, SeatStrip, SectionHead } from '@/features/intercity/BoardParts';
import { DriverSeatMap, PickupRoute, PinPad, RiderRow, StepRow } from '@/features/intercity/DepartureParts';
import { cityName, countdownLabel, dayAndPeriod, departureState, paymentLabel, pickupLabel, riderName, seatName, statusLabel, travellingAsLabel } from '@/features/intercity/labels';
import {
  ANNOUNCE_RULES,
  clockLabel,
  corridorCity,
  departReadiness,
  destinationCity,
  hasPickupRun,
  manifestOrder,
  meterMoney,
  minutesUntil,
  pickupRoute,
  pinPress,
  riderStatus,
  seatOccupants,
} from '@/features/intercity/logic';
import { useDeparture, useDriverActions, useNetwork, useRiderNames } from '@/features/intercity/queries';
import { useNow } from '@/features/intercity/useNow';
import { pickPhoto, uploadPhoto } from '@/features/account/photo';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { currentFix } from '@/lib/location';
import { amountParam } from '@/lib/money';

const TRAVELLING_AS: readonly TravellingAs[] = ['rijal', 'nisa', 'aila'];
const POSITION_MS = 30_000;

/**
 * One departure, run from the garage: selfie and garage check-in, the seat map with every rider by
 * first name (walk-ups marked per seat), the PIN pad, door-pickup answers, no-shows only when the
 * server allows them, the ordered pickup run, the server's late meter, and "انطلقنا" — which stays
 * shut until every booked seat is checked in or resolved (and, before the time, the car is full).
 */
export default function DepartureScreen() {
  const theme = useTheme();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const dep = useDeparture(id ?? '');

  if (!dep.data) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: t('partner.hub_intercity') }} />
        {dep.isError ? (
          <EmptyState icon="garage" title={t('error.network')} action={{ label: t('action.retry'), onPress: () => void dep.refetch() }} />
        ) : (
          <View style={{ gap: theme.space[4] }}>
            <Skeleton height={140} radius={20} />
            <Skeleton height={320} radius={20} />
          </View>
        )}
      </Screen>
    );
  }
  return <DepartureView dep={dep.data} />;
}

function DepartureView({ dep }: { dep: DriverDepartureView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const now = useNow(5_000);
  const network = useNetwork();
  const actions = useDriverActions();
  const client = useApiClient();
  const bookingIds = useMemo(() => dep.bookings.map((b) => b.bookingId), [dep.bookings]);
  const riders = useRiderNames(dep.id, bookingIds);
  const names = useMemo(() => new Map((riders.data ?? []).map((r) => [r.bookingId, r.firstName])), [riders.data]);
  const occupants = useMemo(() => seatOccupants(dep, riders.data ?? []), [dep, riders.data]);
  const garage = network.data?.garages.find((g) => g.id === dep.garageId);
  const toCity = destinationCity(corridorCity(dep.corridorId), dep.direction);
  const open = dep.state === 'scheduled' || dep.state === 'boarding';
  const readiness = departReadiness(dep);

  const [selected, setSelected] = useState<IntercitySeatId | null>(null);
  const [walkUpAs, setWalkUpAs] = useState<TravellingAs>(dep.familyOnly ? 'aila' : 'rijal');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);

  const fail = (err: unknown) => {
    theme.haptic('error');
    toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
  };

  // While the run is live and this screen is open, his fixes feed the garage check-in, the meter and
  // the riders' live car. No GPS (desktop browser): nothing is sent — never a made-up position.
  const depRef = useRef(dep);
  depRef.current = dep;
  useEffect(() => {
    if (!(open || dep.state === 'departed')) return;
    const send = async () => {
      const fix = await currentFix(4000);
      if (fix) await actions.position.mutateAsync({ departureId: depRef.current.id, ...fix }).catch(() => undefined);
    };
    void send();
    const timer = setInterval(() => void send(), POSITION_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep.id, dep.state]);

  const takeSelfie = async () => {
    try {
      // Front camera on a phone, the file picker on the web; the photo is uploaded (signed PUT) and
      // its upload id is the run's selfie ref, so ops can see who drove.
      const photo = await pickPhoto('camera', { selfie: true });
      if (photo === 'denied') {
        toast.show({ message: t('partner.docs_camera_denied'), tone: 'warning' });
        return;
      }
      if (!photo) return;
      const uploadId = await uploadPhoto(photo, (input) => client.places.photoUpload.mutate(input));
      await actions.selfie.mutateAsync({ departureId: dep.id, selfieRef: uploadId });
      theme.haptic('success');
    } catch (err) {
      fail(err);
    }
  };

  const checkInGarage = async () => {
    const fix = await currentFix(6000);
    if (!fix) {
      toast.show({ message: t('partner.location_needed'), tone: 'warning' });
      return;
    }
    try {
      const after = await actions.position.mutateAsync({ departureId: dep.id, ...fix });
      if (!after.driverCheckedInAt) toast.show({ message: t('partner.ic_garage_far', { garage: garage?.nameAr ?? '' }), tone: 'warning' });
      else theme.haptic('success');
    } catch (err) {
      fail(err);
    }
  };

  const onPinKey = async (key: string) => {
    setPinError(false);
    const next = pinPress(pin, key);
    setPin(next);
    if (next.length < 4) return;
    try {
      const after = await actions.checkIn.mutateAsync({ departureId: dep.id, pin: next });
      const who = after.bookings.find((b) => b.state === 'checked_in' && !dep.bookings.some((x) => x.bookingId === b.bookingId && x.state === 'checked_in'));
      theme.haptic('success');
      toast.show({ message: t('partner.ic_pin_ok', { name: riderName(t, who ? names.get(who.bookingId) : null) }), tone: 'success' });
      setPin('');
    } catch (err) {
      setPinError(true);
      if (apiErrorCode(err) !== 'pin_invalid') fail(err);
      else theme.haptic('error');
      setTimeout(() => setPin(''), 600);
    }
  };

  const markWalkUp = async (seatId: IntercitySeatId, remove: boolean) => {
    try {
      await actions.walkUp.mutateAsync({ departureId: dep.id, seatId, ...(remove ? { remove: true } : { travellingAs: walkUpAs }) });
      theme.haptic('success');
      toast.show({ message: remove ? t('partner.ic_walkup_removed', { seat: seatName(t, seatId) }) : t('partner.walkup_marked'), tone: 'success' });
      setSelected(null);
    } catch (err) {
      fail(err);
    }
  };

  const noShow = async (bookingId: string) => {
    try {
      await actions.noShow.mutateAsync({ departureId: dep.id, bookingId });
      toast.show({ message: t('partner.ic_noshow_done', { name: riderName(t, names.get(bookingId)) }), tone: 'neutral' });
    } catch (err) {
      fail(err);
    }
  };

  const respondPickup = async (bookingId: string, accept: boolean) => {
    try {
      await actions.respondPickup.mutateAsync({ departureId: dep.id, bookingId, accept });
      toast.show({ message: accept ? t('partner.ic_door_accepted') : t('partner.ic_door_declined'), tone: accept ? 'success' : 'neutral' });
    } catch (err) {
      fail(err);
    }
  };

  const depart = async () => {
    try {
      await actions.depart.mutateAsync({ departureId: dep.id });
      theme.haptic('success');
      toast.show({ message: t('partner.ic_departed_toast'), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };

  const arrive = async () => {
    try {
      await actions.arrive.mutateAsync({ departureId: dep.id });
      theme.haptic('success');
    } catch (err) {
      fail(err);
    }
  };

  const manifest = manifestOrder(dep.bookings);
  const waitingPin = dep.bookings.some((b) => b.state === 'booked');
  const route = garage ? pickupRoute(garage, dep.bookings) : [];
  const late = dep.bookings.filter((b) => b.state === 'booked' && b.meterMinutes !== null);
  const meterOff = open && now.getTime() > dep.departAt.getTime() && dep.bookings.some((b) => b.state === 'booked' && b.pickup.kind === 'garage' && b.meterMinutes === null && (b.prepaid || b.prepayRail === 'trusted_cash'));
  const toLowFill = minutesUntil(new Date(dep.departAt.getTime() - ANNOUNCE_RULES.boardingWindowMin * 60_000), now);
  const lowFill = dep.state === 'scheduled' && toLowFill > 0 && dep.fill.filled < ANNOUNCE_RULES.minSeatsAtTMinus30;
  const busy = Object.values(actions).some((m) => m.isPending && m !== actions.position);
  const sel = selected ? occupants.get(selected) : undefined;
  // The PIN pad and the "before you leave" list matter from an hour before the run, not all day.
  const soon = minutesUntil(dep.departAt, now) <= 60;

  const footer = open ? (
    <View style={{ gap: theme.space[2] }}>
      {!readiness.canDepart && soon ? (
        <View testID="depart-blockers" style={{ gap: 4, paddingBottom: theme.space[1] }}>
          {readiness.notCheckedIn > 0 ? <Blocker text={readiness.notCheckedIn === 1 ? t('partner.ic_block_not_checked_one') : t('partner.ic_block_not_checked_few', { n: readiness.notCheckedIn })} /> : null}
          {readiness.pickupPending > 0 ? <Blocker text={t('partner.ic_block_pickup')} /> : null}
          {readiness.tooEarly ? <Blocker text={t('partner.ic_block_early', { time: clockLabel(dep.departAt) })} /> : null}
        </View>
      ) : null}
      {/* Departing and arriving move every rider's booking: a slide, never a pocket tap (P-08). */}
      <SlideToConfirm testID="depart" label={t('partner.ic_depart_cta')} confirmHaptic="medium" disabled={!readiness.canDepart} loading={actions.depart.isPending} onConfirm={() => void depart()} />
    </View>
  ) : dep.state === 'departed' ? (
    <SlideToConfirm testID="arrive" label={t('partner.ic_arrive_cta')} confirmHaptic="medium" loading={actions.arrive.isPending} onConfirm={() => void arrive()} />
  ) : (
    <Button label={t('partner.ic_back_board')} variant="secondary" size="lg" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/intercity'))} />
  );

  return (
    <Screen testID="intercity-departure" edges={['bottom']} footer={footer}>
      <Stack.Screen options={{ title: t('partner.ic_dep_title', { time: clockLabel(dep.departAt) }) }} />

      {/* Hero: time, route, state, countdown, seats */}
      <Card testID="departure-hero" padding={5}>
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
            <View style={{ flex: 1 }}>
              <Text variant="display" tabular style={{ lineHeight: 40 }}>
                {clockLabel(dep.departAt)}
              </Text>
              <Text variant="label" color="textMuted">
                {dayAndPeriod(t, dep.departAt, now)}
              </Text>
            </View>
            <StatusPill label={departureState(t, dep.state)} tone={departureTone(dep.state)} live={dep.state === 'boarding' || dep.state === 'departed'} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="garage" size={18} color="textMuted" />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t('rajaa.route', { from: garage?.nameAr ?? '', to: cityName(t, toCity) })}
            </Text>
            {dep.familyOnly ? <StatusPill label={t('intercity.family_only')} tone="info" size="sm" /> : null}
          </View>
          {open ? (
            <Text variant="footnote" weight={600} color={dep.departAt.getTime() < now.getTime() ? 'warningText' : 'textMuted'} tabular>
              {`${countdownLabel(t, dep.departAt, now)} · ${t('partner.ic_dep_or_full', { time: clockLabel(dep.latestDepartureAt) })}`}
            </Text>
          ) : null}
          <SeatStrip dep={dep} />
          <Text variant="label" weight={600} tabular>
            {[
              t('intercity.fill', { filled: dep.fill.booked + dep.fill.walkUps, total: dep.fill.seatsTotal }),
              dep.bookings.filter((b) => b.state === 'checked_in').length > 0 ? t('partner.ic_fill_checked', { n: dep.bookings.filter((b) => b.state === 'checked_in').length }) : null,
              dep.fill.walkUps > 0 ? t('partner.ic_fill_walkups', { n: dep.fill.walkUps }) : null,
              dep.fill.held > 0 ? t('partner.ic_fill_held', { n: dep.fill.held }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </Card>

      {dep.state === 'departed' ? (
        <Banner tone="info" icon="car" title={t('partner.ic_on_road_title', { city: cityName(t, toCity) })} body={t('partner.ic_on_road_body')} />
      ) : null}
      {dep.state === 'arrived' || dep.state === 'closed' ? (
        <Banner tone="success" icon="check" title={t('partner.ic_arrived_title')} body={t('partner.ic_arrived_body', { n: dep.bookings.filter((b) => b.state === 'completed').length })} />
      ) : null}
      {dep.state === 'cancelled_low_fill' ? <Banner tone="danger" icon="x" title={departureState(t, dep.state)} body={t('partner.ic_cancelled_low_fill_body')} /> : null}
      {lowFill ? <Banner tone="warning" icon="clock" title={t('partner.low_fill_warn', { minutes: toLowFill, n: dep.fill.filled })} /> : null}

      {open ? (
        <Card padding={0} style={{ paddingHorizontal: theme.space[4] }}>
          <StepRow
            testID="step-selfie"
            icon="user"
            title={t('partner.ic_selfie_title')}
            body={t('partner.ic_selfie_body')}
            done={!!dep.selfieAt}
            doneLabel={t('partner.ic_selfie_done')}
            cta={t('partner.ic_selfie_cta')}
            onPress={() => void takeSelfie()}
            busy={actions.selfie.isPending}
          />
          <Rule />
          <StepRow
            testID="step-garage"
            icon="garage"
            title={t('partner.ic_garage_title')}
            body={t('partner.ic_garage_body')}
            done={!!dep.driverCheckedInAt && dep.driverInsideGarage !== false}
            doneLabel={dep.driverCheckedInAt ? t('partner.ic_garage_in', { time: clockLabel(dep.driverCheckedInAt) }) : ''}
            cta={t('partner.ic_garage_cta')}
            onPress={() => void checkInGarage()}
            busy={actions.position.isPending}
          />
          {dep.driverCheckedInAt && dep.driverInsideGarage === false ? (
            <Text variant="caption" color="warningText" style={{ paddingBottom: theme.space[3] }}>
              {t('partner.ic_garage_out')}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {open && (late.length > 0 || meterOff) ? (
        <Card testID="late-meter">
          <View style={{ gap: theme.space[2] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Icon name="clock" size={18} color="dangerText" />
              <Text variant="label" weight={700} style={{ flex: 1 }}>
                {t('partner.ic_meter_title')}
              </Text>
            </View>
            {late.map((b) => {
              const m = meterMoney(b.meterMinutes);
              const name = riderName(t, names.get(b.bookingId));
              return (
                <View key={b.bookingId} style={{ gap: 2 }}>
                  <Text variant="footnote" weight={600} color={m.blocks > 0 ? 'dangerText' : 'text'} tabular>
                    {m.blocks > 0 ? t('partner.late_meter_driver', { name, minutes: b.meterMinutes ?? 0, amount: amountParam(m.toDriverIqd) }) : t('partner.ic_meter_grace', { name, n: m.graceLeftMin })}
                  </Text>
                  {b.canNoShow ? (
                    <Text variant="caption" weight={600} color="successText">
                      {t('partner.late_leave_allowed')}
                    </Text>
                  ) : null}
                </View>
              );
            })}
            <Text variant="caption" color="textMuted">
              {meterOff && late.length === 0 ? t('partner.ic_meter_off') : t('partner.ic_meter_blocks')}
            </Text>
          </View>
        </Card>
      ) : null}

      <View style={{ gap: theme.space[3] }}>
        <SectionHead title={t('partner.ic_seats_title')} sub={open ? t('partner.ic_seats_hint') : undefined} />
        <Card padding={4} testID="driver-seatmap">
          <View style={{ gap: theme.space[4] }}>
            <DriverSeatMap layout={dep.vehicle.layout} occupants={occupants} selected={selected} onSelect={(s) => setSelected(s === selected ? null : s)} editable={open} />
            {sel ? (
              <View testID="seat-panel" style={{ gap: theme.space[3], borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: theme.space[4] }}>
                {sel.kind === 'free' && open ? (
                  <>
                    <Text variant="label" weight={700}>
                      {t('partner.ic_walkup_title', { seat: seatName(t, sel.seatId) })}
                    </Text>
                    <View style={{ gap: theme.space[2] }}>
                      <Text variant="caption" color="textMuted">
                        {t('partner.ic_walkup_as')}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                        {TRAVELLING_AS.filter((v) => !dep.familyOnly || v === 'aila').map((v) => (
                          <Chip key={v} testID={`walkup-as-${v}`} role="radio" label={travellingAsLabel(t, v)} selected={walkUpAs === v} onPress={() => setWalkUpAs(v)} />
                        ))}
                      </View>
                    </View>
                    {!dep.selfieAt ? (
                      <Text variant="caption" color="warningText">
                        {t('partner.ic_walkup_not_counted')}
                      </Text>
                    ) : null}
                    <Button testID="walkup-confirm" label={t('partner.ic_walkup_confirm')} icon="garage" onPress={() => void markWalkUp(sel.seatId, false)} loading={actions.walkUp.isPending} fullWidth />
                  </>
                ) : sel.kind === 'walkup' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                    <Icon name="garage" size={22} color="infoText" />
                    <View style={{ flex: 1 }}>
                      <Text variant="label" weight={700}>
                        {`${t('partner.ic_seat_walkup')} · ${seatName(t, sel.seatId)}`}
                      </Text>
                      {sel.travellingAs ? (
                        <Text variant="caption" color="textMuted">
                          {travellingAsLabel(t, sel.travellingAs)}
                        </Text>
                      ) : null}
                    </View>
                    {open ? <Button testID="walkup-remove" label={t('partner.ic_walkup_remove')} variant="secondary" size="sm" onPress={() => void markWalkUp(sel.seatId, true)} loading={actions.walkUp.isPending} /> : null}
                  </View>
                ) : sel.kind === 'rider' ? (
                  <View style={{ gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                      <Text variant="label" weight={700} style={{ flex: 1 }}>
                        {`${riderName(t, sel.firstName)} · ${seatName(t, sel.seatId)}`}
                      </Text>
                      <StatusPill label={statusLabel(t, riderStatus(sel.booking), sel.booking)} tone="neutral" size="sm" />
                    </View>
                    <Text variant="caption" color="textMuted" tabular>
                      {[travellingAsLabel(t, sel.booking.travellingAs), paymentLabel(t, sel.booking), pickupLabel(t, sel.booking)].join(' · ')}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </Card>
      </View>

      {(open || dep.state === 'departed') && waitingPin && soon ? (
        <View style={{ gap: theme.space[3] }}>
          <SectionHead title={t('partner.ic_pin_title')} sub={t('partner.ic_pin_hint')} />
          <Card testID="pin-pad" padding={5}>
            <PinPad pin={pin} onKey={(k) => void onPinKey(k)} busy={actions.checkIn.isPending} error={pinError} />
          </Card>
        </View>
      ) : null}

      <View style={{ gap: theme.space[1] }}>
        <SectionHead title={t('partner.ic_riders_title')} />
        <Card padding={0} style={{ paddingHorizontal: theme.space[4], marginTop: theme.space[2] }}>
          {manifest.length === 0 ? (
            <Text variant="footnote" color="textMuted" style={{ paddingVertical: theme.space[4] }}>
              {t('partner.ic_riders_empty')}
            </Text>
          ) : (
            manifest.map((b, i) => (
              <View key={b.bookingId}>
                {i > 0 ? <Rule /> : null}
                <RiderRow booking={b} firstName={names.get(b.bookingId) ?? null} busy={busy} onNoShow={() => void noShow(b.bookingId)} onPickup={(accept) => void respondPickup(b.bookingId, accept)} />
              </View>
            ))
          )}
        </Card>
      </View>

      {hasPickupRun(route) && (open || dep.state === 'departed') ? (
        <View style={{ gap: theme.space[3] }}>
          <SectionHead title={t('partner.ic_route_title')} />
          <Card padding={4}>
            <PickupRoute stops={route} garageName={garage?.nameAr ?? ''} names={names} />
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

function Blocker({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
      <Icon name="clock" size={14} color="warningText" style={{ marginTop: 4 }} />
      <Text variant="footnote" color="warningText" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function Banner({ tone, icon, title, body }: { tone: 'info' | 'success' | 'warning' | 'danger'; icon: 'car' | 'check' | 'x' | 'clock'; title: string; body?: string }) {
  const theme = useTheme();
  const bg = { info: theme.colors.infoTint, success: theme.colors.successTint, warning: theme.colors.warningTint, danger: theme.colors.dangerTint }[tone];
  const fg = `${tone}Text` as const;
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', backgroundColor: bg, borderRadius: theme.radius.lg, padding: theme.space[4] }}>
      <Icon name={icon} size={22} color={fg} strokeWidth={2.2} />
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={700} color={fg}>
          {title}
        </Text>
        {body ? (
          <Text variant="caption" color="text">
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
