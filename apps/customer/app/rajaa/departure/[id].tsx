import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { IntercityDirection, IntercityRow, IntercitySeatId, PickupChoice, TravellingAs } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import {
  Button,
  Card,
  CarSeatArt,
  Chip,
  ChipGroup,
  EmptyState,
  Icon,
  PriceLine,
  Rule,
  SeatMap,
  SegmentedControl,
  Skeleton,
  Text,
  TextField,
  useTheme,
  useToast,
  type SeatInfo,
  type SelectRejection,
} from '@driver/ui';
import { Screen } from '@/components/Screen';
import { carArtFor } from '@/features/rajaa/car-art';
import { seatsList, TRAVELLING_AS, TRAVELLING_AS_ICON, travellingAsLabel } from '@/features/rajaa/labels';
import { RajaaDriver } from '@/features/rajaa/RajaaDriver';
import {
  bestSeat,
  blockedReason,
  carAvailable,
  clockLabel,
  doorFeeEstimate,
  maxSeatsFor,
  pickupPointsInOrder,
  PRIMARY_CORRIDOR,
  pruneSelection,
  quoteSelection,
  rowOptions,
  toSeatMap,
} from '@/features/rajaa/logic';
import { Section } from '@/features/rajaa/Option';
import { BagSwitch, BlockedLine, PickupTiles, WayPointRow, type PickupKind, type PickupTile } from '@/features/rajaa/SeatParts';
import { garageName, useBoard, useDriverCards, useHoldSeat, useNetwork } from '@/features/rajaa/queries';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { deliveryPointOf, profile, selectedPlace, useProfile } from '@/lib/profile';

type Mode = 'seats' | 'row' | 'car';
type Pickup = { kind: 'garage' } | { kind: 'meeting_point'; meetingPointId: string } | { kind: 'door' };

/**
 * Seat booking (spec §2, decisions §9): travelling-as first (it decides which seats are open to
 * this rider), then the seat map with blocked seats explained, row/car booking, the pickup, and a
 * free 10-minute hold. Nothing is paid here.
 */
export default function BookSeat() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const locale = useLocale();
  const prof = useProfile();
  const params = useLocalSearchParams<{ id: string; corridor?: string; direction?: string }>();
  const id = String(params.id ?? '');
  const corridorId = params.corridor || PRIMARY_CORRIDOR;
  const direction: IntercityDirection = params.direction === 'from_aziziyah' ? 'from_aziziyah' : 'to_aziziyah';

  // r1: the board's remembered «تسافر:» is pre-selected; a change here is remembered too.
  const [travellingAs, setTravellingAs] = useState<TravellingAs | null>(prof.rajaaTravellingAs);
  const [mode, setMode] = useState<Mode>('seats');
  const [selection, setSelection] = useState<IntercitySeatId[]>([]);
  const [row, setRow] = useState<IntercityRow | null>(null);
  const [pickup, setPickup] = useState<Pickup>({ kind: 'garage' });
  const [doorNote, setDoorNote] = useState('');
  const [largeBags, setLargeBags] = useState(false);
  const [blocked, setBlocked] = useState<'adjacency' | 'family_only' | null>(null);

  const network = useNetwork();
  const board = useBoard({ corridorId, direction, ...(travellingAs ? { travellingAs } : {}) });
  const hold = useHoldSeat();
  const dep = board.data?.departures.find((d) => d.id === id) ?? null;
  const driverCard = useDriverCards(dep ? [dep.id] : []).data?.get(dep?.id ?? '');
  const garage = network.data?.garages.find((g) => g.id === dep?.garageId) ?? null;

  // A refresh (someone else booked) or a new declaration can close seats the rider had picked.
  useEffect(() => {
    if (!dep) return;
    setSelection((s) => {
      const kept = pruneSelection(s, dep.seats);
      return kept.length === s.length ? s : kept;
    });
  }, [dep]);

  // c4: the app picks the best free seat once per car and «مسافر» choice; the rider can change or clear it.
  const autoPickedFor = useRef<string | null>(null);
  const [autoPicked, setAutoPicked] = useState<IntercitySeatId | null>(null);
  useEffect(() => {
    // Wait for the seats as seen by this «مسافر» choice (the board refetches when it changes).
    if (!dep || !travellingAs || mode !== 'seats' || board.isFetching) return;
    const key = `${dep.id}:${travellingAs}`;
    if (autoPickedFor.current === key) return;
    autoPickedFor.current = key;
    const pick = bestSeat(dep.vehicle.layout, dep.seats);
    setAutoPicked(pick);
    if (pick) setSelection((s) => (s.length === 0 ? [pick] : s));
  }, [dep, travellingAs, mode, board.isFetching]);

  const rows = useMemo(() => (dep && travellingAs ? rowOptions(dep.vehicle.layout, dep.seats, dep.familyOnly, travellingAs) : []), [dep, travellingAs]);
  const wholeCar = !!dep && !!travellingAs && carAvailable(dep.seats, dep.familyOnly, travellingAs);

  const seatIds: IntercitySeatId[] = !dep
    ? []
    : mode === 'car'
      ? wholeCar
        ? dep.seats.map((s) => s.id)
        : []
      : mode === 'row'
        ? (rows.find((r) => r.row === row && r.available)?.seatIds ?? [])
        : selection;

  const wayPoints = useMemo(
    () =>
      dep && garage
        ? pickupPointsInOrder(dep.meetingPoints, garage, (network.data?.garages ?? []).filter((g) => g.cityId === dep.toCityId))
        : [],
    [dep, garage, network.data],
  );
  const home = selectedPlace(prof);
  const homePin = direction === 'from_aziziyah' && home ? (deliveryPointOf(home).pin ?? null) : null;
  const doorFee = homePin && garage ? doorFeeEstimate(homePin, garage) : null;
  const doorOk = !!dep && dep.doorPickupsLeft > 0 && doorFee !== null;
  const mp = pickup.kind === 'meeting_point' ? dep?.meetingPoints.find((m) => m.id === pickup.meetingPointId) : undefined;
  const pickupFee = pickup.kind === 'meeting_point' ? (mp?.feeIqd ?? 0) : pickup.kind === 'door' ? (doorFee ?? 0) : 0;
  const quote = dep ? quoteSelection(seatIds, dep, pickupFee) : null;

  const onReject = (seat: SeatInfo['id'], reason: SelectRejection) => {
    if (!dep) return;
    if (reason === 'blocked') {
      setBlocked(blockedReason(dep.seats, seat as IntercitySeatId));
      return;
    }
    toast.show({ message: reason === 'max' ? t('rajaa.max_seats') : t('rajaa.seat_unavailable'), icon: 'seat' });
  };

  const submit = () => {
    if (!dep || !travellingAs || seatIds.length === 0) return;
    const choice: PickupChoice =
      pickup.kind === 'door' && homePin
        ? { kind: 'door', lat: homePin.lat, lng: homePin.lng, ...(doorNote.trim() ? { note: doorNote.trim() } : {}) }
        : pickup.kind === 'meeting_point'
          ? { kind: 'meeting_point', meetingPointId: pickup.meetingPointId }
          : { kind: 'garage' };
    hold.mutate(
      {
        departureId: dep.id,
        selection: mode === 'car' ? { kind: 'car' } : mode === 'row' && row ? { kind: 'row', row } : { kind: 'seats', seatIds },
        travellingAs,
        pickup: choice,
        largeBags,
      },
      {
        onSuccess: (b) => router.replace({ pathname: '/rajaa/booking/[id]', params: { id: b.id } }),
        onError: (err) => {
          const code = apiErrorCode(err);
          if (code === 'seat_adjacency_blocked') setBlocked('adjacency');
          if (code === 'family_only_departure') setBlocked('family_only');
          toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000);
          void board.refetch();
        },
      },
    );
  };

  if (board.isPending || network.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Skeleton height={120} radius={20} />
        <Skeleton height={260} radius={20} />
      </Screen>
    );
  }
  if (!dep) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="garage"
          title={board.isError ? apiErrorMessage(board.error, t('error.network'), locale) : t('rajaa.departure_gone')}
          action={{ label: t('rajaa.back_to_board'), onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  const max = travellingAs ? maxSeatsFor(travellingAs, dep.vehicle.layout) : 1;
  const ready = !!travellingAs && seatIds.length > 0;
  // The driver's own car under the seats when it has a picture (Ali, 2026-10-07); the drawn map otherwise.
  const art = carArtFor(dep.vehicle);
  const mapSeats = toSeatMap(dep.seats) as SeatInfo[];
  const mapSelection = mode === 'seats' ? selection : seatIds;
  const wayFee = wayPoints.length > 0 ? Math.min(...wayPoints.map((m) => m.feeIqd)) : null;
  const pickupTiles: PickupTile[] = [
    { kind: 'garage', detail: t('rajaa.pickup_free'), disabled: false },
    {
      kind: 'way',
      detail: wayFee === null ? t('rajaa.pickup_way_none') : wayPoints.some((m) => m.feeIqd !== wayFee) ? t('rajaa.pickup_from', { amount: amountParam(wayFee) }) : iqd(wayFee, { locale, sign: true }),
      disabled: wayFee === null,
    },
    {
      kind: 'door',
      detail: !homePin ? t('rajaa.pickup_door_short_location') : dep.doorPickupsLeft <= 0 ? t('rajaa.pickup_door_short_full') : iqd(doorFee ?? 0, { locale, sign: true }),
      disabled: !doorOk,
    },
  ];
  const pickupKind: PickupKind = pickup.kind === 'meeting_point' ? 'way' : pickup.kind;
  const onSeats =
    travellingAs && mode === 'seats'
      ? (s: SeatInfo['id'][]) => {
          const next = s as IntercitySeatId[];
          // A tap on another seat while only our pick is chosen moves the pick there, not adds a seat.
          const swap = autoPicked && selection.length === 1 && selection[0] === autoPicked && next.length === 2 && next.includes(autoPicked);
          setSelection(swap ? next.filter((x) => x !== autoPicked) : next);
          setAutoPicked(null);
          setBlocked(null);
        }
      : undefined;

  return (
    <Screen
      testID="rajaa-book"
      edges={['bottom']}
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button
            testID="rajaa-hold"
            label={seatIds.length > 1 ? t('rajaa.hold_cta_seats', { n: seatIds.length }) : t('rajaa.hold_cta')}
            icon="clock"
            size="lg"
            fullWidth
            disabled={!ready}
            loading={hold.isPending}
            onPress={submit}
          />
          <Text variant="caption" color="textMuted" align="center">
            {ready ? t('rajaa.hold_cta_hint') : !travellingAs ? t('rajaa.pick_traveller_first') : t('rajaa.pick_seat_first')}
          </Text>
        </View>
      }
    >
      {/* The car, at a glance. */}
      <Card padding={4} elevation={0}>
        <View style={{ gap: theme.space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
            <Text variant="heading" tabular>
              {clockLabel(dep.departAt)}
            </Text>
            <Text variant="label" color="textMuted" style={{ flex: 1 }}>
              {garageName(network.data, dep.garageId)}
            </Text>
            <Text variant="bodyStrong" tabular>
              {iqd(dep.seatPriceIqd, { locale })}
            </Text>
          </View>
          <Text variant="footnote" color="textMuted">
            {t('intercity.leaves_at_or_full', { time: clockLabel(dep.departAt) })} · {t('intercity.latest_departure', { time: clockLabel(dep.latestDepartureAt) })}
          </Text>
          <RajaaDriver dep={dep} card={driverCard} record={{ departureId: dep.id }} testID="rajaa-departure-driver" style={{ marginTop: theme.space[2] }} />
          {dep.familyOnly ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Icon name="user" size={16} color="infoText" />
              <Text variant="footnote" color="infoText" weight={600}>
                {t('intercity.family_only')}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>

      <Section title={t('intercity.travelling_as')} hint={t('rajaa.travelling_as_hint')} testID="rajaa-travelling-as">
        <ChipGroup
          accessibilityLabel={t('intercity.travelling_as')}
          required
          items={TRAVELLING_AS.map((v) => ({ id: v, label: travellingAsLabel(t, v), icon: TRAVELLING_AS_ICON[v] }))}
          value={travellingAs ? [travellingAs] : []}
          onChange={(next) => {
            const v = (next[0] as TravellingAs | undefined) ?? null;
            setTravellingAs(v);
            if (v) void profile.setRajaaTravellingAs(v);
            setBlocked(null);
          }}
        />
      </Section>

      <Section title={mode === 'seats' && max > 1 ? t('rajaa.choose_seats') : t('intercity.choose_seat')}>
        <SegmentedControl<Mode>
          accessibilityLabel={t('intercity.choose_seat')}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setBlocked(null);
          }}
          options={[
            { value: 'seats', label: t('rajaa.mode_seats') },
            { value: 'row', label: t('rajaa.mode_row') },
            { value: 'car', label: t('rajaa.mode_car') },
          ]}
        />
        {mode === 'row' && travellingAs ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {rows.map((r) => (
              <Chip
                key={r.row}
                testID={`row-${r.row}`}
                role="radio"
                label={r.available ? t(`rajaa.row_${r.row}` as MessageKey) : `${t(`rajaa.row_${r.row}` as MessageKey)} · ${t('rajaa.row_busy')}`}
                selected={row === r.row && r.available}
                disabled={!r.available}
                onPress={() => setRow(r.row)}
              />
            ))}
          </View>
        ) : null}
        {mode === 'car' && travellingAs && !wholeCar ? (
          <Text variant="footnote" color="textMuted">
            {t('rajaa.car_busy')}
          </Text>
        ) : null}
        <View style={{ opacity: travellingAs ? 1 : 0.45 }}>
          {art ? (
            <CarSeatArt
              art={art}
              carName={dep.vehicle.model ?? undefined}
              layout={dep.vehicle.layout}
              seats={mapSeats}
              selection={mapSelection}
              max={max}
              onChange={onSeats}
              onReject={onReject}
              {...(driverCard?.firstName ? { driverLabel: driverCard.firstName } : {})}
            />
          ) : (
            <SeatMap layout={dep.vehicle.layout} seats={mapSeats} selection={mapSelection} max={max} onChange={onSeats} onReject={onReject} />
          )}
        </View>
        {blocked ? (
          <BlockedLine reason={blocked} />
        ) : autoPicked && mode === 'seats' && selection.length === 1 && selection[0] === autoPicked ? (
          <View testID="rajaa-auto-picked" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="check" size={16} color="accentText" strokeWidth={2.5} />
            <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
              {t('rajaa.auto_picked', { seat: seatsList(t, [autoPicked]) })}
            </Text>
          </View>
        ) : null}
      </Section>

      <Section title={t('rajaa.pickup_title')}>
        <PickupTiles
          tiles={pickupTiles}
          value={pickupKind}
          onChange={(k) => {
            if (k === 'garage') setPickup({ kind: 'garage' });
            else if (k === 'door') setPickup({ kind: 'door' });
            else if (wayPoints[0]) setPickup({ kind: 'meeting_point', meetingPointId: mp?.id ?? wayPoints[0].id });
          }}
        />
        {pickup.kind === 'garage' ? (
          <Text variant="footnote" color="textMuted">
            {t('rajaa.pickup_garage_hint', { garage: garageName(network.data, dep.garageId) })}
          </Text>
        ) : pickup.kind === 'meeting_point' ? (
          <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('rajaa.pickup_way_which')}>
            {wayPoints.length > 1 ? (
              <Text variant="label" weight={600}>
                {t('rajaa.pickup_way_which')}
              </Text>
            ) : null}
            {wayPoints.map((m) => (
              <WayPointRow
                key={m.id}
                point={m}
                draftLabel={t('rajaa.pickup_draft')}
                selected={pickup.meetingPointId === m.id}
                onPress={() => setPickup({ kind: 'meeting_point', meetingPointId: m.id })}
              />
            ))}
          </View>
        ) : (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="footnote" color="textMuted">
              {t('rajaa.pickup_door_hint')}
            </Text>
            <TextField label={t('rajaa.door_note')} placeholder={t('rajaa.door_note_placeholder')} value={doorNote} onChangeText={setDoorNote} maxLength={200} />
          </View>
        )}
        <BagSwitch value={largeBags} onChange={setLargeBags} />
      </Section>

      {quote && quote.seats > 0 ? (
        <Card testID="rajaa-quote" elevation={0} padding={4}>
          <View style={{ gap: theme.space[1] }}>
            <Text variant="footnote" color="textMuted">
              {seatsList(t, seatIds)}
            </Text>
            <PriceLine label={t('rajaa.line_seats', { n: quote.seats, amount: amountParam(quote.seatPriceIqd) })} amount={quote.baseIqd} />
            {quote.frontIqd > 0 ? <PriceLine label={t('rajaa.line_front')} amount={quote.frontIqd} /> : null}
            {quote.pickupIqd > 0 ? (
              <PriceLine
                label={pickup.kind === 'door' ? t('rajaa.line_pickup_door') : t('rajaa.line_pickup_way')}
                amount={quote.pickupIqd}
                {...(pickup.kind === 'door' ? { reason: t('rajaa.pickup_door_hint') } : {})}
              />
            ) : null}
            <Rule style={{ marginVertical: theme.space[1] }} />
            <PriceLine label={t('rajaa.total')} amount={quote.totalIqd} strong />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
