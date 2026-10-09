import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { lapChildrenAllowed, type IntercityDirection, type IntercityRow, type IntercitySeatId, type PickupChoice } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import {
  Button,
  Card,
  CarSeatArt,
  Chip,
  EmptyState,
  Icon,
  PriceLine,
  QueryBoundary,
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
import { cityName, seatsList } from '@/features/rajaa/labels';
import { RajaaDriver } from '@/features/rajaa/RajaaDriver';
import { TripChatEntry } from '@/features/chat/TripChatEntry';
import { agreementPhase } from '@/features/rajaa/agree';
import { AgreementSlot, FreeLine } from '@/features/rajaa/AgreeParts';
import {
  bestSeat,
  blockedReason,
  carAvailable,
  clockLabel,
  doorFeeEstimate,
  maxSeatsFor,
  pickupPointsInOrder,
  PRIMARY_CORRIDOR,
  RIDER_TRAVELLING_AS,
  pruneSelection,
  quoteSelection,
  rowOptions,
  toSeatMap,
} from '@/features/rajaa/logic';
import { OptionCard, Section } from '@/features/rajaa/Option';
import { BagSwitch, BlockedLine, PickupTiles, WayPointRow, type PickupKind, type PickupTile } from '@/features/rajaa/SeatParts';
import { garageName, useBoard, useDriverCards, useHoldSeat, useMyAgreements, useMyBookings, useNetwork } from '@/features/rajaa/queries';
import { returnOfferFor } from '@/features/rajaa/return-bundle';
import { LapChildRow, ReturnBundleStrip } from '@/features/rajaa/ReturnParts';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { deliveryPointOf, selectedPlace, useProfile } from '@/lib/profile';

type Mode = 'seats' | 'row' | 'car';
/** `way` = on the road with nothing picked yet; `pin` = his own spot at the price the driver named (step 4). */
type Pickup = { kind: 'garage' } | { kind: 'meeting_point'; meetingPointId: string } | { kind: 'door' } | { kind: 'way' } | { kind: 'pin'; agreementId: string };

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

  // Ali dropped «مسافر» (2026-10-07): every rider books as a group; see RIDER_TRAVELLING_AS.
  const travellingAs = RIDER_TRAVELLING_AS;
  const [mode, setMode] = useState<Mode>('seats');
  const [selection, setSelection] = useState<IntercitySeatId[]>([]);
  const [row, setRow] = useState<IntercityRow | null>(null);
  const [pickup, setPickup] = useState<Pickup>({ kind: 'garage' });
  const [doorNote, setDoorNote] = useState('');
  const [largeBags, setLargeBags] = useState(false);
  /** Step 5: small children on a lap (free). */
  const [lap, setLap] = useState(0);
  const [blocked, setBlocked] = useState<'adjacency' | 'family_only' | null>(null);
  /** Step 4: the agreed door drop he books with; null = the garage. */
  const [drop, setDrop] = useState<string | null>(null);

  const network = useNetwork();
  const board = useBoard({ corridorId, direction, travellingAs });
  const hold = useHoldSeat();
  const dep = board.data?.departures.find((d) => d.id === id) ?? null;
  const driverCard = useDriverCards(dep ? [dep.id] : []).data?.get(dep?.id ?? '');
  const garage = network.data?.garages.find((g) => g.id === dep?.garageId) ?? null;
  const agreements = useMyAgreements(dep?.id);
  const mine = useMyBookings();
  // Optional: when the read fails there is simply no offer line (the server prices the pair anyway).
  const returnOffer = mine.isError ? null : returnOfferFor(mine.data, corridorId, direction);
  const pinPhase = agreementPhase(agreements.data, 'pin_pickup');
  const doorPhase = agreementPhase(agreements.data, 'door_drop');
  const pinDeal = pinPhase.phase === 'agreed' ? pinPhase.agreement : null;
  const doorDeal = doorPhase.phase === 'agreed' ? doorPhase.agreement : null;
  const farGarages = (network.data?.garages ?? []).filter((g) => g.cityId === dep?.toCityId);
  const farGarage = farGarages.find((g) => !g.draft) ?? farGarages[0] ?? null;

  // A price that is no longer agreed (he asked again, it was replaced) leaves the choice it was. Only
  // once the list says so: right after «اتفقنا» the list may still show the price waiting.
  // A price he just agreed (or one agreed earlier for this car) becomes his choice once, when it appears.
  const seenPin = useRef<string | null>(null);
  const seenDoor = useRef<string | null>(null);
  useEffect(() => {
    if (!pinDeal || seenPin.current === pinDeal.id) return;
    seenPin.current = pinDeal.id;
    setPickup({ kind: 'pin', agreementId: pinDeal.id });
  }, [pinDeal]);
  useEffect(() => {
    if (!doorDeal || seenDoor.current === doorDeal.id) return;
    seenDoor.current = doorDeal.id;
    setDrop(doorDeal.id);
  }, [doorDeal]);
  const stillAgreed = (id: string, deal: { id: string } | null) => {
    const known = agreements.data?.find((a) => a.id === id);
    if (!known) return true;
    return (known.state === 'accepted' || known.state === 'used') && (!deal || deal.id === id);
  };
  const pinLost = pickup.kind === 'pin' && !stillAgreed(pickup.agreementId, pinDeal);
  const dropLost = !!drop && !stillAgreed(drop, doorDeal);
  useEffect(() => {
    if (pinLost) setPickup({ kind: 'way' });
  }, [pinLost]);
  useEffect(() => {
    if (dropLost) setDrop(null);
  }, [dropLost]);

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
  const pickupFee =
    pickup.kind === 'meeting_point' ? (mp?.feeIqd ?? 0) : pickup.kind === 'door' ? (doorFee ?? 0) : pickup.kind === 'pin' ? (pinDeal?.amountIqd ?? 0) : 0;
  const dropFee = drop && doorDeal ? (doorDeal.amountIqd ?? 0) : 0;
  const quote = dep ? quoteSelection(seatIds, dep, pickupFee, dropFee) : null;
  // Step 5: one child on a lap per seat, none on the front seat; fewer seats trim the count.
  const lapMax = lapChildrenAllowed(seatIds);
  const lapChildren = Math.min(lap, lapMax);
  const toCity = dep ? cityName(t, dep.toCityId) : '';
  /** Step 4: the pin screen opens on the road (the first meeting point) or at the far garage. */
  const askFor = (kind: 'pin_pickup' | 'door_drop') => {
    if (!dep) return;
    const at = kind === 'pin_pickup' ? (wayPoints[0] ?? garage) : farGarage;
    router.push({
      pathname: '/rajaa/agree',
      params: { departureId: dep.id, kind, lat: String(at?.lat ?? ''), lng: String(at?.lng ?? ''), city: toCity },
    });
  };

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
          : pickup.kind === 'pin'
            ? { kind: 'pin', agreementId: pickup.agreementId }
            : { kind: 'garage' };
    hold.mutate(
      {
        departureId: dep.id,
        selection: mode === 'car' ? { kind: 'car' } : mode === 'row' && row ? { kind: 'row', row } : { kind: 'seats', seatIds },
        travellingAs,
        pickup: choice,
        ...(drop ? { dropoff: { agreementId: drop } } : {}),
        largeBags,
        lapChildren,
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
  const ready = !!travellingAs && seatIds.length > 0 && pickup.kind !== 'way';
  // The flat car under the seats for a 4-seat run (Ali, 2026-10-09: no glossy pictures); the drawn map otherwise.
  const art = carArtFor(dep.vehicle);
  const mapSeats = toSeatMap(dep.seats) as SeatInfo[];
  const mapSelection = mode === 'seats' ? selection : seatIds;
  const wayFee = wayPoints.length > 0 ? Math.min(...wayPoints.map((m) => m.feeIqd)) : null;
  const pickupTiles: PickupTile[] = [
    { kind: 'garage', detail: t('rajaa.pickup_free'), disabled: false },
    {
      kind: 'way',
      // Step 4: with no meeting point on this road he can still ask the driver about his own spot.
      detail:
        wayFee === null
          ? pinDeal
            ? iqd(pinDeal.amountIqd ?? 0, { locale, sign: true })
            : t('rajaa.pickup_way_ask')
          : wayPoints.some((m) => m.feeIqd !== wayFee)
            ? t('rajaa.pickup_from', { amount: amountParam(wayFee) })
            : iqd(wayFee, { locale, sign: true }),
      disabled: false,
    },
    {
      kind: 'door',
      detail: !homePin ? t('rajaa.pickup_door_short_location') : dep.doorPickupsLeft <= 0 ? t('rajaa.pickup_door_short_full') : iqd(doorFee ?? 0, { locale, sign: true }),
      disabled: !doorOk,
    },
  ];
  const pickupKind: PickupKind = pickup.kind === 'meeting_point' || pickup.kind === 'pin' ? 'way' : pickup.kind;
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
            {ready
              ? t('rajaa.hold_cta_hint')
              : !travellingAs
                ? t('rajaa.pick_traveller_first')
                : seatIds.length === 0
                  ? t('rajaa.pick_seat_first')
                  : t('rajaa.pick_way_first')}
          </Text>
        </View>
      }
    >
      {returnOffer ? <ReturnBundleStrip percent={returnOffer.percent} outAt={returnOffer.booking.departure.departAt} /> : null}
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
          <TripChatEntry subject="departure" id={dep.id} />
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
            else if (pinDeal) setPickup({ kind: 'pin', agreementId: pinDeal.id });
            else setPickup({ kind: 'way' });
          }}
        />
        {pickup.kind === 'garage' ? (
          <Text variant="footnote" color="textMuted">
            {t('rajaa.pickup_garage_hint', { garage: garageName(network.data, dep.garageId) })}
          </Text>
        ) : pickup.kind === 'meeting_point' || pickup.kind === 'way' || pickup.kind === 'pin' ? (
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
                selected={pickup.kind === 'meeting_point' && pickup.meetingPointId === m.id}
                onPress={() => setPickup({ kind: 'meeting_point', meetingPointId: m.id })}
              />
            ))}
            <AgreementSlot
              kind="pin_pickup"
              phase={pinPhase}
              title={t('rajaa.agree_pin_title')}
              askTitle={t('rajaa.agree_ask_pin')}
              askHint={t('rajaa.agree_ask_pin_hint')}
              selected={pickup.kind === 'pin'}
              onSelect={(a) => setPickup({ kind: 'pin', agreementId: a.id })}
              onAsk={() => askFor('pin_pickup')}
            />
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
        <LapChildRow value={lapChildren} max={lapMax} onChange={setLap} />
      </Section>

      <Section title={t('rajaa.drop_title')} testID="rajaa-drop">
        <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('rajaa.drop_title')}>
          <OptionCard
            testID="drop-garage"
            icon="garage"
            title={t('rajaa.drop_garage', { garage: farGarage ? garageName(network.data, farGarage.id) : toCity })}
            trailing={t('rajaa.pickup_free')}
            selected={!drop}
            onPress={() => setDrop(null)}
          />
          {agreements.isError ? (
            <QueryBoundary query={agreements} size="inline" skeleton={null} testID="rajaa-agreements-read">
              {() => null}
            </QueryBoundary>
          ) : null}
          <AgreementSlot
            kind="door_drop"
            phase={doorPhase}
            title={t('rajaa.agree_door_title', { city: toCity })}
            askTitle={t('rajaa.agree_ask_door')}
            askHint={t('rajaa.agree_ask_door_hint')}
            selected={!!drop}
            onSelect={(a) => setDrop(a.id)}
            onAsk={() => askFor('door_drop')}
          />
        </View>
      </Section>

      {quote && quote.seats > 0 ? (
        <Card testID="rajaa-quote" elevation={0} padding={4}>
          <View style={{ gap: theme.space[1] }}>
            <Text variant="footnote" color="textMuted">
              {seatsList(t, seatIds)}
            </Text>
            <PriceLine label={t('rajaa.line_seats', { n: quote.seats, amount: amountParam(quote.seatPriceIqd) })} amount={quote.baseIqd} />
            {quote.frontIqd > 0 ? <PriceLine label={t('rajaa.line_front')} amount={quote.frontIqd} /> : null}
            {lapChildren > 0 ? <FreeLine label={t('rajaa.line_lap', { n: lapChildren })} testID="rajaa-quote-lap" /> : null}
            {quote.pickupIqd > 0 ? (
              <PriceLine
                label={pickup.kind === 'door' ? t('rajaa.line_pickup_door') : pickup.kind === 'pin' ? t('rajaa.line_pickup_pin') : t('rajaa.line_pickup_way')}
                amount={quote.pickupIqd}
                {...(pickup.kind === 'door' ? { reason: t('rajaa.pickup_door_hint') } : {})}
              />
            ) : null}
            {pickup.kind === 'pin' && quote.pickupIqd === 0 ? <FreeLine label={t('rajaa.line_pickup_pin')} /> : null}
            {quote.dropoffIqd > 0 ? (
              <PriceLine label={t('rajaa.line_dropoff_door')} amount={quote.dropoffIqd} />
            ) : drop ? (
              <FreeLine label={t('rajaa.line_dropoff_door')} testID="rajaa-quote-drop-free" />
            ) : null}
            <Rule style={{ marginVertical: theme.space[1] }} />
            <PriceLine label={t('rajaa.total')} amount={quote.totalIqd} strong />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
