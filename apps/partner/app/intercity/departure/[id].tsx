import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { DriverDepartureView, IntercitySeatId, TravellingAs } from '@driver/contracts';
import { Button, Card, DepartureTime, EmptyState, Icon, Rule, SegmentedControl, Skeleton, SlideToConfirm, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { DriverMap, type MapPin } from '@/features/map/DriverMap';
import { SosControl } from '@/features/safety/SosControl';
import { departureTone, SeatStrip, SectionHead } from '@/features/intercity/BoardParts';
import { PickupRoute, PinPad, RiderRow, StepRow } from '@/features/intercity/DepartureParts';
import { GarageLegend, GarageSeatMap, RiderSheet, WalkUpSheet } from '@/features/intercity/GarageParts';
import { blockerText, cityName, countdownLabel, departureState, riderName, seatName } from '@/features/intercity/labels';
import {
  ANNOUNCE_RULES,
  boardedSeats,
  clockLabel,
  corridorCity,
  departBlockerNote,
  departReadiness,
  destinationCity,
  hasPickupRun,
  legendStates,
  manifestOrder,
  meterMoney,
  minutesUntil,
  pickupRoute,
  pinPress,
  seatOccupants,
  type SeatOccupant,
} from '@/features/intercity/logic';
import { useDeparture, useDriverActions, useNetwork, useRiderNames } from '@/features/intercity/queries';
import { useNow } from '@/features/intercity/useNow';
import { useRunCall } from '@/features/intercity/useRunCall';
import { pickPhoto, uploadPhoto } from '@/features/account/photo';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { currentFix } from '@/lib/location';
import { amountParam } from '@/lib/money';

const POSITION_MS = 30_000;
type Tab = 'seats' | 'details';

/**
 * One departure, run from the garage (partner audit S-5, garage mode). The seat map IS the page: a
 * booked seat opens that rider's PIN sheet, an empty seat the walk-up sheet, a late seat goes red with
 * the meter and a call. "انطلقنا" stays pinned at the bottom and, while locked, names what is still in
 * the way ("3 ركاب بعدهم"). Riders, the pickup run and money live in "التفاصيل". Selfie and garage
 * check-in, door pickups, no-shows only when the server allows them, the server's late meter.
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
            <Skeleton height={110} radius={20} />
            <Skeleton height={44} radius={14} />
            <Skeleton height={420} radius={28} />
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
  const caller = useRunCall();
  const bookingIds = useMemo(() => dep.bookings.map((b) => b.bookingId), [dep.bookings]);
  const riders = useRiderNames(dep.id, bookingIds);
  const names = useMemo(() => new Map((riders.data ?? []).map((r) => [r.bookingId, r.firstName])), [riders.data]);
  const occupants = useMemo(() => seatOccupants(dep, riders.data ?? []), [dep, riders.data]);
  const garage = network.data?.garages.find((g) => g.id === dep.garageId);
  const toCity = destinationCity(corridorCity(dep.corridorId), dep.direction);
  const open = dep.state === 'scheduled' || dep.state === 'boarding';
  const live = open || dep.state === 'departed';
  const readiness = departReadiness(dep);

  const [tab, setTab] = useState<Tab>(live ? 'seats' : 'details');
  const [sheetSeat, setSheetSeat] = useState<IntercitySeatId | null>(null);
  const [walkUpAs, setWalkUpAs] = useState<TravellingAs>(dep.familyOnly ? 'aila' : 'rijal');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  // The general PIN pad in التفاصيل (a rider who doesn't know his seat).
  const [anyPin, setAnyPin] = useState('');
  const [anyPinError, setAnyPinError] = useState(false);

  const sheetOcc: SeatOccupant | null = sheetSeat ? (occupants.get(sheetSeat) ?? null) : null;
  const riderOcc = sheetOcc?.kind === 'rider' ? sheetOcc : null;
  const walkOcc = sheetOcc && sheetOcc.kind !== 'rider' && open ? sheetOcc : null;

  const fail = (err: unknown) => {
    theme.haptic('error');
    toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
  };

  // While the run is live and this screen is open, his fixes feed the garage check-in, the meter and
  // the riders' live car. No GPS (desktop browser): nothing is sent — never a made-up position.
  // His last fix, for the run's map (maps program d7).
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const depRef = useRef(dep);
  depRef.current = dep;
  useEffect(() => {
    if (!live) return;
    const send = async () => {
      const fix = await currentFix(4000);
      if (fix) setHere({ lat: fix.lat, lng: fix.lng });
      if (fix) await actions.position.mutateAsync({ departureId: depRef.current.id, ...fix }).catch(() => undefined);
    };
    void send();
    const timer = setInterval(() => void send(), POSITION_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep.id, dep.state]);

  const openSeat = (occ: SeatOccupant) => {
    if (occ.kind !== 'rider' && !open) return;
    setPin('');
    setPinError(false);
    setSheetSeat(occ.seatId);
  };
  const closeSheet = () => {
    setSheetSeat(null);
    setPin('');
    setPinError(false);
  };

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

  /** The seat sheet's pad: the 4th digit checks in THIS rider (the server refuses another rider's PIN here). */
  const onSeatPinKey = async (key: string) => {
    if (!riderOcc) return;
    setPinError(false);
    const next = pinPress(pin, key);
    setPin(next);
    if (next.length < 4) return;
    try {
      await actions.checkIn.mutateAsync({ departureId: dep.id, pin: next, bookingId: riderOcc.booking.bookingId });
      theme.haptic('success');
      toast.show({ message: t('partner.ic_pin_ok', { name: riderName(t, riderOcc.firstName) }), tone: 'success', icon: 'check' });
      closeSheet();
    } catch (err) {
      setPinError(true);
      if (apiErrorCode(err) !== 'pin_invalid') fail(err);
      else theme.haptic('error');
      setTimeout(() => setPin(''), 600);
    }
  };

  /** التفاصيل's pad: any rider's PIN (the old flow). */
  const onAnyPinKey = async (key: string) => {
    setAnyPinError(false);
    const next = pinPress(anyPin, key);
    setAnyPin(next);
    if (next.length < 4) return;
    try {
      const after = await actions.checkIn.mutateAsync({ departureId: dep.id, pin: next });
      const who = after.bookings.find((b) => b.state === 'checked_in' && !dep.bookings.some((x) => x.bookingId === b.bookingId && x.state === 'checked_in'));
      theme.haptic('success');
      toast.show({ message: t('partner.ic_pin_ok', { name: riderName(t, who ? names.get(who.bookingId) : null) }), tone: 'success', icon: 'check' });
      setAnyPin('');
    } catch (err) {
      setAnyPinError(true);
      if (apiErrorCode(err) !== 'pin_invalid') fail(err);
      else theme.haptic('error');
      setTimeout(() => setAnyPin(''), 600);
    }
  };

  const markWalkUp = async (seatId: IntercitySeatId, remove: boolean) => {
    try {
      await actions.walkUp.mutateAsync({ departureId: dep.id, seatId, ...(remove ? { remove: true } : { travellingAs: walkUpAs }) });
      theme.haptic('success');
      toast.show({ message: remove ? t('partner.ic_walkup_removed', { seat: seatName(t, seatId) }) : t('partner.walkup_marked'), tone: 'success' });
      closeSheet();
    } catch (err) {
      fail(err);
    }
  };

  const noShow = async (bookingId: string) => {
    try {
      await actions.noShow.mutateAsync({ departureId: dep.id, bookingId });
      toast.show({ message: t('partner.ic_noshow_done', { name: riderName(t, names.get(bookingId)) }), tone: 'neutral' });
      closeSheet();
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

  const callRider = (bookingId: string, name: string) => void caller.call(bookingId, name, () => client.routes.driver.callRider.mutate({ departureId: dep.id, bookingId }));

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
  const runPins: MapPin[] = route.map((s, i) =>
    s.kind === 'garage'
      ? { at: s.at, kind: 'garage', label: `${garage?.nameAr ?? ''} · ${dep.fill.booked + dep.fill.walkUps}/${dep.fill.seatsTotal}` }
      : { at: s.at, kind: 'stop', badge: String(i + 1), label: s.kind === 'door' ? riderName(t, names.get(s.bookings[0]!.bookingId)) : (s.nameAr ?? '') },
  );
  const late = dep.bookings.filter((b) => b.state === 'booked' && b.meterMinutes !== null);
  const meterOff = open && now.getTime() > dep.departAt.getTime() && dep.bookings.some((b) => b.state === 'booked' && b.pickup.kind === 'garage' && b.meterMinutes === null && (b.prepaid || b.prepayRail === 'trusted_cash'));
  const toLowFill = minutesUntil(new Date(dep.departAt.getTime() - ANNOUNCE_RULES.boardingWindowMin * 60_000), now);
  const lowFill = dep.state === 'scheduled' && toLowFill > 0 && dep.fill.filled < ANNOUNCE_RULES.minSeatsAtTMinus30;
  const busy = Object.values(actions).some((m) => m.isPending && m !== actions.position);
  const soon = minutesUntil(dep.departAt, now) <= 60;
  const checkedIn = boardedSeats(dep.bookings);
  const stepsDone = !!dep.selfieAt && !!dep.driverCheckedInAt && dep.driverInsideGarage !== false;
  const blocker = blockerText(t, departBlockerNote(readiness), dep.departAt);

  const footer = open ? (
    // Departing moves every rider's booking: a slide, never a pocket tap (P-08). Locked, it names the blocker.
    <SlideToConfirm testID="depart" label={t('partner.ic_depart_cta')} note={readiness.canDepart ? t('partner.gm_ready') : (blocker ?? undefined)} confirmHaptic="medium" disabled={!readiness.canDepart} loading={actions.depart.isPending} onConfirm={() => void depart()} />
  ) : dep.state === 'departed' ? (
    <SlideToConfirm testID="arrive" label={t('partner.ic_arrive_cta')} confirmHaptic="medium" loading={actions.arrive.isPending} onConfirm={() => void arrive()} />
  ) : (
    <Button label={t('partner.ic_back_board')} variant="secondary" size="lg" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/intercity'))} />
  );

  return (
    <Screen testID="intercity-departure" edges={['bottom']} footer={footer}>
      <Stack.Screen
        options={{
          title: t('partner.ic_dep_title', { time: clockLabel(dep.departAt) }),
          // SOS on the live run (scoring & safety §3): from boarding at the garage to arrival.
          headerRight: live ? () => <SosControl subject={{ kind: 'departure', id: dep.id }} style={{ marginEnd: theme.space[3] }} /> : undefined,
        }}
      />

      {/* The board: the time on split-flap tiles (audit d-2), where to, state and fill. */}
      <Card testID="departure-hero" padding={4}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
          <DepartureTime
            testID="departure-time"
            at={dep.departAt}
            now={now.getTime()}
            size="card"
            countdown={open}
            note={open && dep.departAt.getTime() < now.getTime() ? countdownLabel(t, dep.departAt, now) : undefined}
          />
          <View style={{ flex: 1, alignItems: 'flex-end', gap: theme.space[2] }}>
            <StatusPill label={departureState(t, dep.state)} tone={departureTone(dep.state)} live={dep.state === 'boarding' || dep.state === 'departed'} />
            <Text variant="label" weight={700} tabular align="end">
              {[t('intercity.fill', { filled: dep.fill.booked + dep.fill.walkUps, total: dep.fill.seatsTotal }), checkedIn > 0 ? t('partner.ic_fill_checked', { n: checkedIn }) : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: theme.space[3] }}>
          <Icon name="garage" size={18} color="textMuted" />
          <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {t('rajaa.route', { from: garage?.nameAr ?? '', to: cityName(t, toCity) })}
          </Text>
          {dep.familyOnly ? <StatusPill label={t('intercity.family_only')} tone="info" size="sm" /> : null}
        </View>
        {open ? (
          <Text variant="caption" color="textMuted" tabular style={{ marginTop: theme.space[1] }}>
            {t('partner.ic_dep_or_full', { time: clockLabel(dep.latestDepartureAt) })}
          </Text>
        ) : null}
      </Card>

      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'seats', label: t('partner.gm_tab_seats') },
          { value: 'details', label: t('partner.gm_tab_details') },
        ]}
      />

      {dep.state === 'departed' ? <Banner tone="info" icon="car" title={t('partner.ic_on_road_title', { city: cityName(t, toCity) })} body={t('partner.ic_on_road_body')} /> : null}
      {dep.state === 'arrived' || dep.state === 'closed' ? (
        <Banner tone="success" icon="check" title={t('partner.ic_arrived_title')} body={t('partner.ic_arrived_body', { n: dep.bookings.filter((b) => b.state === 'completed').length })} />
      ) : null}
      {dep.state === 'cancelled_low_fill' ? <Banner tone="danger" icon="x" title={departureState(t, dep.state)} body={t('partner.ic_cancelled_low_fill_body')} /> : null}
      {lowFill ? <Banner tone="warning" icon="clock" title={t('partner.low_fill_warn', { minutes: toLowFill, n: dep.fill.filled })} /> : null}

      {tab === 'seats' ? (
        <>
          {open && !stepsDone ? (
            <Card padding={0} style={{ paddingHorizontal: theme.space[4] }}>
              <StepRow testID="step-selfie" icon="user" title={t('partner.ic_selfie_title')} body={t('partner.ic_selfie_body')} done={!!dep.selfieAt} doneLabel={t('partner.ic_selfie_done')} cta={t('partner.ic_selfie_cta')} onPress={() => void takeSelfie()} busy={actions.selfie.isPending} />
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
            </Card>
          ) : null}
          <View testID="driver-seatmap" style={{ gap: theme.space[3] }}>
            <GarageSeatMap layout={dep.vehicle.layout} occupants={occupants} editable={open} onSeat={openSeat} />
            <GarageLegend states={legendStates(occupants)} />
            {open ? (
              <Text variant="footnote" color="textMuted" align="center">
                {t('partner.gm_hint')}
              </Text>
            ) : null}
          </View>
        </>
      ) : (
        <>
          <Card padding={4}>
            <View style={{ gap: theme.space[3] }}>
              <SeatStrip dep={dep} />
              <Text variant="label" weight={600} tabular>
                {[
                  t('intercity.fill', { filled: dep.fill.booked + dep.fill.walkUps, total: dep.fill.seatsTotal }),
                  checkedIn > 0 ? t('partner.ic_fill_checked', { n: checkedIn }) : null,
                  dep.fill.walkUps > 0 ? t('partner.ic_fill_walkups', { n: dep.fill.walkUps }) : null,
                  dep.fill.held > 0 ? t('partner.ic_fill_held', { n: dep.fill.held }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </Card>

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

          {live && waitingPin && soon ? (
            <View style={{ gap: theme.space[3] }}>
              <SectionHead title={t('partner.ic_pin_title')} sub={t('partner.ic_pin_hint')} />
              <Card testID="pin-pad" padding={5}>
                <PinPad pin={anyPin} onKey={(k) => void onAnyPinKey(k)} busy={actions.checkIn.isPending} error={anyPinError} />
              </Card>
            </View>
          ) : null}

          {hasPickupRun(route) && live ? (
            <View style={{ gap: theme.space[3] }}>
              <SectionHead title={t('partner.ic_route_title')} />
              <Card padding={4}>
                <PickupRoute stops={route} garageName={garage?.nameAr ?? ''} names={names} />
              </Card>
            </View>
          ) : null}
        </>
      )}

      {hasPickupRun(route) && (open || dep.state === 'departed') ? (
        <View style={{ gap: theme.space[3] }}>
          <SectionHead title={t('partner.ic_route_title')} />
          {/* Maps program d7: the run on the map — the garage with its seats, then each pickup in order. */}
          <View testID="ic-run-map" style={{ height: 240, borderRadius: theme.radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border }}>
            <DriverMap self={here} vehicleIcon="car" online pins={runPins} route={route.map((s) => s.at)} topInset={8} bottomInset={8} maxZoom={15} testID="ic-run-driver-map" />
          </View>
          <Card padding={4}>
            <PickupRoute stops={route} garageName={garage?.nameAr ?? ''} names={names} />
          </Card>
        </View>
      ) : null}
      <RiderSheet
        occ={riderOcc}
        open={!!riderOcc}
        onClose={closeSheet}
        pin={pin}
        pinError={pinError}
        onPinKey={(k) => void onSeatPinKey(k)}
        checkingIn={actions.checkIn.isPending}
        onCall={() => {
          if (!riderOcc) return;
          // The sheet steps aside so "دا نربطك ويا …" shows while the phone dials.
          closeSheet();
          callRider(riderOcc.booking.bookingId, riderName(t, riderOcc.firstName));
        }}
        calling={!!riderOcc && caller.busyKey === riderOcc.booking.bookingId}
        onNoShow={() => riderOcc && void noShow(riderOcc.booking.bookingId)}
        onPickup={(accept) => riderOcc && void respondPickup(riderOcc.booking.bookingId, accept)}
        busy={busy}
      />
      <WalkUpSheet
        dep={dep}
        occ={walkOcc}
        open={!!walkOcc}
        onClose={closeSheet}
        as={walkUpAs}
        onAs={setWalkUpAs}
        onConfirm={() => walkOcc && void markWalkUp(walkOcc.seatId, false)}
        onRemove={() => walkOcc && void markWalkUp(walkOcc.seatId, true)}
        busy={actions.walkUp.isPending}
      />
    </Screen>
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
