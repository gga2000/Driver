import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FOOD_RATED_TYPES, orderTicketNumber, quickRepliesFor, quickReplyText, type QuickReplyKey, type ShareLink } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, EmptyState, formatClock, IconButton, Rule, Sheet, Skeleton, Text, Timeline, useTheme, useToast } from '@driver/ui';
import { newClientId, threadOf } from '@/features/chat/logic';
import { newRequestKey } from '@/features/food/place-attempt';
import { FREE_CANCEL_H, FreeCancelChip, NameThisPlace, RideRoute, rideVehicleLabel, SEARCH_PROGRESS_H, SearchProgress, searchElapsedSec, useSearchNote, useSearchProgress, WaitCounter, WaitNote } from '@/features/ride/LiveParts';
import { freeCancelLeftSec, switchOfferDue, type RideVertical } from '@/features/ride/logic';
import { useCityConfig, useConfirmRideArrived, useNearbyVehicles, useRideSwitchQuote, useSwitchRideVehicle } from '@/features/ride/queries';
import { rideStore, useRideMemo } from '@/features/ride/store';
import { SwitchOfferCard } from '@/features/ride/SwitchOffer';
import { useChatThreads } from '@/features/chat/queries';
import { useMaskedCall } from '@/features/chat/useMaskedCall';
import { SharePanel } from '@/features/share/SharePanel';
import { useGift } from '@/features/gift/gift-store';
import { useGiftHeadsUp } from '@/features/gift/GiftHeadsUp';
import { ShareCardPanel } from '@/features/share-card/ShareCardPanel';
import type { ShareMoment } from '@/features/share-card/share-card';
import { shareUrl } from '@/features/rajaa/share';
import { SosControl } from '@/features/safety/SosControl';
import { PushAskCard, usePushAsk } from '@/features/notify/PrePrompt';
import { rideAskOnLiveScreen } from '@/features/notify/prompt';
import { ArrivalOverlay, RatingPanel, useArrivalOnce } from '@/features/track/Arrival';
import { lateMinutes, liveEta, signalLostMinutes } from '@/features/track/eta';
import { rideArrivalCopy } from '@/features/track/arrival-copy';
import { mapMinutesLabel } from '@/features/track/eta-range';
import { CancelPanel, DisputePanel, StreetPanel, UNREACHABLE_PANEL_H, UnreachablePanel } from '@/features/track/Panels';
import { currentSosFix } from '@/features/safety/fix';
import { isLive, useCourierPosition, useLiveOrder, useTracking } from '@/features/track/queries';
import { ActionRow, COURIER_FLOAT_H, COURIER_FLOAT_PLATE_H, CourierCard, CourierFloat, DegradedBanner, OrderItems, PriceSection, SheetHeader } from '@/features/track/SheetParts';
import { DriverHereCard } from '@/features/track/DriverHere';
import { DriverRevealCard, useDriverReveal } from '@/features/track/DriverReveal';
import { floatMode, rideCanCancel } from '@/features/track/ride-actions';
import { buildTimeline, courierAtDoor, phaseOf, statusLine } from '@/features/track/timeline';
import { AlmostThereCard, useTrackingMoments } from '@/features/track/AlmostThere';
import { KITCHEN_PROGRESS_H, KitchenProgress } from '@/features/track/KitchenProgress';
import { kitchenStages, showKitchenProgress } from '@/features/track/kitchen-progress';
import { LateBanner, useLatePromiseToast } from '@/features/track/LatePromise';
import { TrackMap } from '@/features/track/TrackMap';
import { apiErrorCode, apiErrorMessage, useApi, useApiClient } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/** Collapsed sheet: handle + status line + the ETA box's three lines (plus the bottom safe area). */
const COLLAPSED = 132;
/** Each degraded-state banner over the map pushes the camera's top edge down by about this much until the stack is measured. */
const BANNER_H = 84;
const TOP_BAR = 64;
/** The inline notification ask in the collapsed sheet (rides, joy f1): two text lines and the buttons. */
const PUSH_ASK_H = 136;
/** The 3-minute offer card over the map (J-D7): the camera keeps the pickup above it. */
const SWITCH_OFFER_H = 290;

function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

type Panel = 'cancel' | 'dispute' | 'street' | 'share' | null;

/**
 * Live order / ride screen (customer app spec §4): map ≈ 60 % with the gliding courier, a
 * draggable sheet (collapsed: status + ETA; expanded: timeline, courier card, order, price,
 * actions), the unreachable protocol, the arrival moment and the two-tap rating.
 * `?sheet=1|2` opens the sheet at a detent (deep links from notifications, screenshots).
 */
export default function OrderLiveScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { id = '', sheet } = useLocalSearchParams<{ id: string; sheet?: string }>();
  useLiveOrder(id);
  const track = useTracking(id);
  const v = track.data;
  // The banners' real height (the late banner grows with its promise bar): the camera and the
  // almost-there card keep clear of all of it, so the minutes pill on the courier stays visible.
  const [bannerStackH, setBannerStackH] = useState(0);
  const live = isLive(v);
  const pos = useCourierPosition(id, Boolean(live && v?.courier));
  const fix = live && v?.courier ? (pos.data ?? null) : null;

  // Server-corrected clock for countdowns and ages.
  const tick = useNow(1000);
  const offset = useMemo(() => (v ? v.serverNow.getTime() - track.dataUpdatedAt : 0), [v, track.dataUpdatedAt]);
  const now = tick + offset;
  const clock = useMemo(() => () => Date.now() + offset, [offset]);

  const ageSec = fix ? fix.ageSec + Math.max(0, (tick - pos.dataUpdatedAt) / 1000) : null;
  const lostMin = signalLostMinutes(ageSec);
  // The server's ETA (one ETA everywhere, routed on real roads when available); the local estimate if it has none.
  const eta = v ? (fix?.etaAt ?? liveEta(v, fix?.pin ?? null, new Date(now))) : null;
  const lateMin = v ? lateMinutes(eta, v.promisedAt) : 0;
  const phase = v ? phaseOf(v) : null;
  // The courier over the map while he is coming (maps program SP5b, c6); the camera keeps clear of it.
  const showFloat = Boolean(v?.courier && fix && (phase === 'to_pickup' || phase === 'at_pickup' || phase === 'on_the_way'));
  // Moments (maps program SP5b): a buzz and a soft sound at each step; the "almost there" card.
  const moments = useTrackingMoments(v, phase, fix?.pin ?? null, eta, now);
  const atDoor = v ? courierAtDoor(v) : false;
  // Joy l2: who is coming, revealed once when he takes the job.
  const reveal = useDriverReveal(v, phase, clock);
  // Audit d-5: the honest-delay credit, said once when the server posts it.
  useLatePromiseToast(v);
  // Minutes on the courier (maps program SP5a): from the same ETA as the sheet, only while he is coming.
  // At the door there is nothing left to count down (joy f3): no pill.
  // A range when the ETA is a straight-line estimate (f19, maps c3): the server's basis, or ours when it gave none.
  const mapMinutes =
    fix && eta && eta.getTime() > now && !atDoor ? mapMinutesLabel(t, Math.max(1, Math.round((eta.getTime() - now) / 60_000)), fix.etaAt ? fix.etaBasis : 'estimated', locale) : null;
  const ride = v?.order.type === 'ride';
  // Joy f1 / ride idea m3: rides ask for notifications inside the collapsed sheet from the search on (food asked on the kitchen screen).
  const pushAsk = usePushAsk(rideAskOnLiveScreen(Boolean(ride), phase));
  const courierName = v?.courier?.firstName ?? null;
  // Rides (customer spec §5): the vehicle asked for, the honest search line and counter, "وصلت".
  const memo = useRideMemo(id);
  const rideFloat = phase ? floatMode(phase) : 'plate';
  const floatH = ride && rideFloat === 'plate' && v?.courier?.plate ? COURIER_FLOAT_PLATE_H : COURIER_FLOAT_H;
  const searching = Boolean(ride && phase === 'searching');
  const pickupArrivedAt = ride ? (v?.trip?.stops.find((s) => s.mine && s.type === 'pickup')?.arrivedAt ?? null) : null;
  const searchNote = useSearchNote(searching ? v : undefined, now);
  const searchBar = useSearchProgress(searching ? v : undefined, now);
  // Ride idea m4: the first minute after he accepts, cancelling is still free.
  const freeCancel = Boolean(ride && phase === 'to_pickup' && v?.trip && freeCancelLeftSec(v.trip.acceptedAt, now) !== null);
  // J-D7 / L-03: free cars around the pickup while searching, and the other vehicle at 3 minutes.
  const asked: RideVertical = v?.trip?.vertical === 'tuktuk' || (!v?.trip && memo?.vertical === 'tuktuk') ? 'tuktuk' : 'taxi';
  const ridePickupPin = ride ? (v?.trip?.stops.find((s) => s.mine && s.type === 'pickup')?.target ?? null) : null;
  const nearby = useNearbyVehicles(searching ? ridePickupPin : null, asked);
  const city = useCityConfig();
  const switchAfterSec = city.data?.dispatch?.[asked]?.customerFreeCancelAfterSec ?? null;
  const [keptSearching, setKeptSearching] = useState<string | null>(null);
  const offerDue = Boolean(searching && v && switchAfterSec !== null && switchOfferDue(searchElapsedSec(v, now), switchAfterSec, keptSearching === id));
  const switchQuote = useRideSwitchQuote(id, memo?.doorPickup ?? false, offerDue);
  const switchRide = useSwitchRideVehicle();
  const switchKey = useRef<string | null>(null);
  const doSwitch = (fareIqd: number, to: RideVertical) => {
    switchKey.current ??= newRequestKey('swt');
    switchRide.mutate(
      { orderId: id, doorPickup: memo?.doorPickup ?? false, fareIqd, clientRequestId: switchKey.current },
      {
        onSuccess: (next) => {
          switchKey.current = null;
          rideStore.remember(next.id, { vertical: to, from: memo?.from ?? t('ride.pickup_here'), to: memo?.to ?? t('track.destination_pin'), doorPickup: memo?.doorPickup ?? false, toHome: memo?.toHome ?? false, ...(memo?.dest ? { dest: memo.dest } : {}) });
          toast.show({ message: t('ride.switch_done', { vehicle: t(to === 'tuktuk' ? 'ride.vehicle_tuktuk' : 'ride.vehicle_taxi') }), tone: 'success', icon: 'check' });
          void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
          router.replace({ pathname: '/order/[id]', params: { id: next.id } });
        },
        onError: (e) => {
          // A changed fare is re-quoted before the next tap; the key stays for a plain retry.
          if (apiErrorCode(e) === 'price_changed') {
            switchKey.current = null;
            void switchQuote.refetch();
          }
          toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
        },
      },
    );
  };
  const confirmArrived = useConfirmRideArrived();
  const api = useApi();
  const qc = useQueryClient();
  const endRide = () =>
    confirmArrived.mutate(
      { orderId: id },
      {
        onSuccess: () => {
          toast.show({ message: t('ride.confirm_arrived_done'), tone: 'success', icon: 'check' });
          void qc.invalidateQueries({ queryKey: api.orders.track.queryKey({ orderId: id }) });
        },
        onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }),
      },
    );

  const [panel, setPanel] = useState<Panel>(null);
  // Joy g1: a gift sent from this phone can still send its heads-up while the meal is on its way.
  const gift = useGift(v?.order.id);
  const giftHeadsUp = useGiftHeadsUp(v?.order.id, gift, v?.merchant?.name ?? '');
  // Joy l5: after a good moment (delivered, finished ride), a picture to share; then the invite (g2).
  const [cardOpen, setCardOpen] = useState(false);
  const happy = phase === 'arrived' || phase === 'done';
  const moment: ShareMoment | null = !v
    ? null
    : ride
      ? { kind: 'ride', vehicle: v.courier?.vehicleClass === 'tuktuk' || v.trip?.vertical === 'tuktuk' ? 'tuktuk' : 'car' }
      : v.merchant
        ? { kind: 'food', dishName: v.items[0]?.name ?? null, merchant: v.merchant.name }
        : null;
  // "عباس وصل" (L-02): shown at the pickup until closed; "طالع هسة" goes once per order.
  const [hereClosedFor, setHereClosedFor] = useState<string | null>(null);
  const [hereH, setHereH] = useState(0);
  // Rides only: «طالع هسة» goes as the chat's coming-out message (food's «أني نازل» is orders.comingOut).
  const [rideComingOut, setRideComingOut] = useState<{ orderId: string; state: 'sending' | 'sent' } | null>(null);
  const [arrivalSeen, setArrivalSeen] = useState(false);
  const [rating, setRating] = useState(false);
  const arrived = phase === 'arrived' && !v?.order.rating;
  // Joy f2: the delivered moment plays once per order (live, or opened within 10 min); afterwards the
  // order opens on its calm receipt — the sheet at its middle detent with the rating offered on top.
  const arrivalPlays = useArrivalOnce(v, phase, clock);
  const showArrival = Boolean(v && arrived && arrivalPlays === true && !arrivalSeen && !rating);
  const receipt = arrived && arrivalPlays === false;

  // Chat, masked call and share-trip (notifications & support §2; safety §5).
  const client = useApiClient();
  const threads = useChatThreads(id, Boolean(v && (v.courier || v.merchant) && !track.isError));
  const courierThread = threadOf(threads.data, 'customer_courier');
  const merchantThread = threadOf(threads.data, 'customer_merchant');
  const { call: maskedCall } = useMaskedCall(id, 'customer_courier', Boolean(ride));
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  // A ride or a delivery: a signed link the family can open without the app (maps program SP3c).
  const share = async () => {
    try {
      setShareLink(shareLink && !shareLink.revokedAt ? shareLink : await client.tracking.createShareLink.mutate({ orderId: id }));
      setPanel('share');
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' });
    }
  };
  const call = () => void maskedCall();
  // SOS (L-17): the car to read out, and a live link for someone the rider trusts.
  const sosCar = v?.courier ? [v.courier.firstName ?? t('track.driver_fallback'), v.courier.vehicleLabel, v.courier.plate].filter(Boolean).join(' · ') : null;
  const shareMyLocation = async () => {
    try {
      const link = shareLink && !shareLink.revokedAt ? shareLink : await client.tracking.createShareLink.mutate({ orderId: id });
      setShareLink(link);
      await Share.share({ message: t('sos.share_message', { url: shareUrl(link.path) }) });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' });
    }
  };
  const openChat = (kind: 'customer_courier' | 'customer_merchant') => router.push({ pathname: '/chat/[orderId]', params: { orderId: id, kind } });
  const reply = async (key: QuickReplyKey) => {
    try {
      await client.chat.send.mutate({ orderId: id, kind: 'customer_courier', clientId: newClientId(), quickReplyKey: key });
      toast.show({ message: t('track.reply_sent', { text: quickReplyText(key, locale) }), tone: 'success', icon: 'chat' });
      void threads.refetch();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' });
    }
  };
  // Joy f18 / J-D8: «أني نازل» buys 2 more minutes on the server (once), then says so in the chat too.
  const comingOut = async (): Promise<boolean> => {
    try {
      const res = await client.orders.comingOut.mutate({ orderId: id });
      toast.show({ message: t(res.extended ? 'unreachable.coming_out_sent' : 'unreachable.coming_out_again'), tone: 'success', icon: 'check' });
      void qc.invalidateQueries({ queryKey: api.orders.track.queryKey({ orderId: id }) });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
      return false;
    }
    await client.chat.send
      .mutate({ orderId: id, kind: 'customer_courier', clientId: newClientId(), quickReplyKey: 'customer_coming_out' })
      .then(() => void threads.refetch())
      // The extra minutes are already his; the chat line is a courtesy, so a failure is only noted.
      .catch((err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' }));
    return true;
  };
  // «دزله لوكيشني»: the phone's own fix when it has one, else the saved drop-off pin.
  const sendLocation = async (): Promise<boolean> => {
    const here = await currentSosFix();
    const pin = here ? { lat: here.lat, lng: here.lng } : (v?.dropoff?.pin ?? null);
    if (!pin) {
      toast.show({ message: t('error.network'), tone: 'warning' });
      return false;
    }
    try {
      await client.chat.send.mutate({ orderId: id, kind: 'customer_courier', clientId: newClientId(), location: pin });
      void threads.refetch();
      return true;
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' });
      return false;
    }
  };

  if (track.isError) {
    const missing = apiErrorCode(track.error) === 'forbidden' || apiErrorCode(track.error) === 'not_found' || apiErrorCode(track.error) === 'order_not_found';
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top + TOP_BAR, paddingHorizontal: theme.space[5] }}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState
          icon="receipt"
          title={missing ? t('track.not_found') : apiErrorMessage(track.error, t('error.network'), locale)}
          action={missing ? { label: t('nav.orders'), onPress: () => router.replace('/orders') } : { label: t('action.retry'), onPress: () => void track.refetch() }}
        />
        <TopBar />
      </View>
    );
  }

  const timeline = v ? buildTimeline(v, { eta, lateMin, courierName }, t, formatClock) : null;
  // Rides: cancel until the rider is in the car (L-16; rides never set pickedUpAt).
  const canCancel = v && phase ? (ride ? rideCanCancel(phase) : !v.order.pickedUpAt) && live && phase !== 'unreachable' : false;
  const canStreet = v ? (FOOD_RATED_TYPES as readonly string[]).includes(v.order.type) && !v.order.pickedUpAt && live : false;
  const statusHint = v && phase === 'cancelled' ? hintFor(v.order.state) : null;
  const banners = (lostMin !== null ? 1 : 0) + (phase === 'reassigning' ? 1 : 0) + (lateMin > 0 && phase !== 'reassigning' && eta ? 1 : 0);
  const bannersH = banners === 0 ? 0 : bannerStackH > 0 ? bannerStackH + theme.space[2] : banners * BANNER_H;
  // Joy l3: the kitchen's real steps in the collapsed sheet, from its yes until the courier has it.
  const kitchen = v && showKitchenProgress(v.order, phase) ? kitchenStages(v.order) : null;
  const collapsed = COLLAPSED + insets.bottom + (searching && searchBar ? SEARCH_PROGRESS_H : 0) + (freeCancel ? FREE_CANCEL_H : 0) + (pushAsk.visible ? PUSH_ASK_H : 0) + (kitchen ? KITCHEN_PROGRESS_H + theme.space[3] : 0);
  // The unreachable panel keeps the map visible (f18): the camera frames him above it.
  const mapBottom = phase === 'unreachable' ? UNREACHABLE_PANEL_H + insets.bottom : collapsed + (showFloat ? floatH : 0) + (offerDue ? SWITCH_OFFER_H : 0);
  const showHere = Boolean(ride && v?.courier && phase === 'at_pickup' && hereClosedFor !== id);
  const sayComingOut = async () => {
    setRideComingOut({ orderId: id, state: 'sending' });
    try {
      await client.chat.send.mutate({ orderId: id, kind: 'customer_courier', clientId: newClientId(), quickReplyKey: 'customer_coming_out' });
      setRideComingOut({ orderId: id, state: 'sent' });
      void threads.refetch();
    } catch (err) {
      setRideComingOut(null);
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' });
    }
  };

  const courierCard = v?.courier ? (
    <CourierCard
      courier={v.courier}
      ride={ride}
      quickReplies={courierThread?.status === 'open' && !happy ? quickRepliesFor('customer', 'customer_courier', ride).slice(0, 3) : []}
      unread={courierThread?.unread ?? 0}
      canChat={Boolean(courierThread && courierThread.status !== 'not_open')}
      onReply={(k) => void reply(k)}
      onChat={() => openChat('customer_courier')}
      onCall={call}
      onShare={() => void share()}
    />
  ) : null;

  return (
    <View testID="order-live" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      {v ? (
        <TrackMap
          view={v}
          fix={fix}
          stale={lostMin !== null}
          // f1: the «السايق وصل» card sits over the top of the map: frame the pins below it.
          topInset={insets.top + TOP_BAR + bannersH + (showHere && hereH > 0 ? hereH + 8 : 0)}
          bottomInset={mapBottom}
          searching={searching}
          minutes={mapMinutes}
          spotlight={phase === 'unreachable'}
          nearby={searching ? { data: nearby.data, kind: asked === 'tuktuk' ? 'tuktuk' : 'car' } : null}
          wave={searching && searchBar ? { part: searchBar.part, asked: searchBar.asked } : null}
          destinationKind={memo?.toHome ? 'home' : 'destination'}
        />
      ) : (
        <View style={{ height: '62%', backgroundColor: theme.colors.surfaceSunken }} />
      )}

      <TopBar
        onBannersLayout={setBannerStackH}
        orderNo={v ? t('order.number', { id: orderTicketNumber(v.order.id) }) : undefined}
        // SOS on a ride with a driver (scoring & safety §3): from the match until a little after arrival.
        sos={
          ride && (phase === 'to_pickup' || phase === 'at_pickup' || phase === 'on_the_way' || phase === 'arrived' || phase === 'unreachable') ? (
            <SosControl subject={{ kind: 'order', id }} car={sosCar} onShareLocation={() => void shareMyLocation()} />
          ) : null
        }
      >
        {lostMin !== null ? (
          <DegradedBanner
            testID="signal-lost"
            icon="location-arrow"
            tone="warning"
            title={lostMin === 1 ? t('track.signal_lost_1') : lostMin === 2 ? t('track.signal_lost_2') : t('track.signal_lost_n', { minutes: lostMin })}
            body={t('track.signal_lost_hint')}
          />
        ) : null}
        {phase === 'reassigning' ? <DegradedBanner testID="reassigning" icon="user" tone="info" title={t('track.reassigning')} body={t('track.reassigning_note')} /> : null}
        {lateMin > 0 && phase !== 'reassigning' && eta && v ? <LateBanner view={v} lateMin={lateMin} eta={eta} now={now} /> : null}
      </TopBar>
      {v?.courier && showFloat ? (
        <CourierFloat
          courier={v.courier}
          ride={ride}
          unread={courierThread?.unread ?? 0}
          canChat={Boolean(courierThread && courierThread.status !== 'not_open')}
          onChat={() => openChat('customer_courier')}
          onCall={call}
          onShare={() => void share()}
          mode={rideFloat}
          bottom={collapsed + 8}
        />
      ) : null}
      {v?.courier && showHere ? (
        <DriverHereCard
          courier={v.courier}
          vehicle={v.courier.vehicleLabel ?? rideVehicleLabel(v, t, memo?.vertical)}
          top={insets.top + TOP_BAR + bannersH + 8}
          sent={rideComingOut?.orderId === id && rideComingOut.state === 'sent'}
          sending={rideComingOut?.orderId === id && rideComingOut.state === 'sending'}
          canReply={courierThread?.status === 'open'}
          onComingOut={() => void sayComingOut()}
          onCall={call}
          onClose={() => setHereClosedFor(id)}
          onHeight={setHereH}
        />
      ) : null}
      {v && offerDue ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: theme.space[4], right: theme.space[4], bottom: collapsed + 8 }}>
          <SwitchOfferCard
            asked={asked}
            quote={switchQuote.data}
            loading={switchQuote.isPending}
            switching={switchRide.isPending}
            onSwitch={(q) => doSwitch(q.fareIqd, q.vertical)}
            onKeep={() => setKeptSearching(id)}
            onCancel={() => setPanel('cancel')}
          />
        </View>
      ) : null}
      {v?.courier && reveal.show && !moments.card && !showHere ? <DriverRevealCard courier={v.courier} ride={ride} top={insets.top + TOP_BAR + bannersH + 8} onClose={reveal.close} /> : null}
      {v && moments.card ? (
        <AlmostThereCard
          order={v.order}
          variant={moments.card}
          name={courierName}
          photoUrl={v.courier?.photoUrl ?? null}
          top={insets.top + TOP_BAR + bannersH + 8}
          onClose={moments.closeCard}
        />
      ) : null}

      <Sheet
        // The calm receipt (f2) opens the sheet at its middle detent: remount once it is decided.
        key={receipt ? 'receipt' : 'live'}
        snapPoints={[collapsed, 0.62, 0.9]}
        initialSnap={sheet === '2' ? 2 : sheet === '1' || receipt ? 1 : 0}
        testID="track-sheet"
        header={
          v && phase ? (
            <SheetHeader
              phase={phase}
              status={statusLine(v, t, { now })}
              pill={[
                ride ? rideVehicleLabel(v, t, memo?.vertical) : t(`order.type.${v.order.type}` as MessageKey),
                v.merchant?.name,
                // g1: «عزيمة لـ أمي» (the recipient's label on the order; never a number).
                v.order.gift ? t('gift.for', { name: v.order.participants.find((p) => p.role === 'recipient')?.label ?? t('checkout.recipient_other') }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              // At the door there is no time left to show (f3): the card says what to do instead.
              // While searching there is no driver to time: the search bar below says where it is.
              eta={atDoor || searching ? null : eta}
              now={now}
              lateMin={lateMin}
              aside={ride && phase === 'at_pickup' && pickupArrivedAt ? <WaitCounter arrivedAt={pickupArrivedAt} now={now} /> : undefined}
              below={
                (searching && searchBar) || freeCancel || pushAsk.visible || kitchen ? (
                  <View style={{ gap: theme.space[3] }}>
                    {searching && searchBar ? <SearchProgress part={searchBar.part} fill={searchBar.fill} note={searchNote} seconds={searchElapsedSec(v, now)} /> : null}
                    {freeCancel && v.trip ? <FreeCancelChip acceptedAt={v.trip.acceptedAt} now={now} onPress={() => setPanel('cancel')} /> : null}
                    {pushAsk.visible ? (
                      <PushAskCard kind={searching ? 'ride_search' : 'ride'} busy={pushAsk.busy} onAllow={pushAsk.allow} onLater={pushAsk.later} />
                    ) : kitchen ? (
                      <KitchenProgress stages={kitchen} courierName={courierName} />
                    ) : null}
                  </View>
                ) : undefined
              }
            />
          ) : (
            <View style={{ gap: theme.space[2] }}>
              <Skeleton width={120} height={20} />
              <Skeleton width="70%" height={24} />
            </View>
          )
        }
      >
        {v && timeline ? (
          <ScrollView contentContainerStyle={{ gap: theme.space[5], paddingBottom: theme.space[10] + insets.bottom }} showsVerticalScrollIndicator={false} testID="sheet-body">
            {statusHint ? <Text color="textMuted">{t(statusHint)}</Text> : null}
            {arrived && !showArrival ? (
              <View testID="receipt-rate" style={{ gap: theme.space[2] }}>
                <Text variant="title">{t('order.rate_title')}</Text>
                <Button label={v.order.type === 'ride' ? rideArrivalCopy(t, v).rate : t('track.arrived_continue')} icon="star" fullWidth onPress={() => setRating(true)} testID="receipt-rate-button" />
              </View>
            ) : null}
            {/* Rides (C-19/C-20): who is coming — name, car, plate — comes first, before the route. */}
            {ride && v.courier && phase !== 'cancelled' ? courierCard : null}
            {ride ? <RideRoute view={v} /> : null}
            {ride && (phase === 'arrived' || phase === 'done') ? <NameThisPlace view={v} /> : null}
            {searching && canCancel ? (
              <View style={{ gap: theme.space[1] }}>
                <Button label={t('ride.cancel_free_button')} variant="secondary" icon="x" fullWidth onPress={() => setPanel('cancel')} testID="ride-cancel-searching" />
                <Text variant="caption" color="successText" align="center">
                  {t('ride.searching_cancel_free')}
                </Text>
              </View>
            ) : null}
            {ride && phase === 'at_pickup' ? <WaitNote vertical={v.courier?.vehicleClass === 'tuktuk' || v.trip?.vertical === 'tuktuk' ? 'tuktuk' : 'taxi'} /> : null}
            {phase !== 'cancelled' ? <Timeline steps={timeline.steps} current={timeline.current} /> : null}
            {v.courier && phase !== 'cancelled' && !ride ? (
              <>
                <Rule />
                {courierCard}
              </>
            ) : null}
            {v.items.length > 0 ? (
              <>
                <Rule />
                <Text variant="title">{t('track.items_title')}</Text>
                <OrderItems view={v} />
              </>
            ) : null}
            <PriceSection view={v} />
            <Rule />
            <View>
              <Text variant="title" style={{ marginBottom: theme.space[1] }}>
                {t('track.actions_title')}
              </Text>
              {canStreet ? (
                <ActionRow icon="location-arrow" label={t('track.switch_street')} hint={t('track.switch_street_hint', { amount: amountParam(250) })} onPress={() => setPanel('street')} testID="action-street" />
              ) : null}
              {merchantThread && merchantThread.status !== 'not_open' ? (
                <ActionRow
                  icon="chat"
                  label={t('track.message_merchant')}
                  hint={merchantThread.unread > 0 ? t('chat.unread_label', { count: merchantThread.unread }) : undefined}
                  onPress={() => openChat('customer_merchant')}
                  testID="action-chat-merchant"
                />
              ) : null}
              {ride && phase === 'on_the_way' ? (
                <ActionRow icon="check" label={t('ride.confirm_arrived')} hint={t('ride.confirm_arrived_hint')} onPress={endRide} testID="action-ride-arrived" />
              ) : null}
              {!v.courier || phase === 'cancelled' ? null : <ActionRow icon="share" label={t('trip.share')} onPress={() => void share()} testID="action-share" />}
              {gift && !happy && phase !== 'cancelled' ? (
                <ActionRow icon="gift" label={t('gift.send_title', { name: gift.name })} onPress={() => void giftHeadsUp.send('whatsapp')} testID="action-gift-heads-up" />
              ) : null}
              {happy && moment ? <ActionRow icon="heart" label={t('sharecard.action')} onPress={() => setCardOpen(true)} testID="action-share-card" /> : null}
              {happy ? <ActionRow icon="gift" label={t('account.invite_row')} hint={t('account.invite_row_hint')} onPress={() => router.push('/invite')} testID="action-invite" /> : null}
              <ActionRow icon="chat" label={t('order.report_problem')} onPress={() => setPanel('dispute')} testID="action-report" />
              {canCancel ? <ActionRow icon="x" tone="dangerText" label={ride ? t('trip.cancel') : t('trip.cancel')} onPress={() => setPanel('cancel')} testID="action-cancel" /> : null}
            </View>
          </ScrollView>
        ) : (
          <View style={{ gap: theme.space[3], paddingTop: theme.space[2] }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={18} width={i % 2 ? '60%' : '85%'} />
            ))}
          </View>
        )}
      </Sheet>

      {v && phase === 'unreachable' ? (
        <UnreachablePanel view={v} clock={clock} courier={fix?.pin ?? null} onCall={call} onComingOut={comingOut} onSendLocation={sendLocation} />
      ) : null}
      {v && panel === 'cancel' ? <CancelPanel orderId={v.order.id} onClose={() => setPanel(null)} /> : null}
      {v && panel === 'dispute' ? <DisputePanel view={v} onClose={() => setPanel(null)} /> : null}
      {v && panel === 'street' ? <StreetPanel onClose={() => setPanel(null)} /> : null}
      {v && panel === 'share' && shareLink ? (
        <SharePanel link={shareLink} preview={v.courier ? { driverName: v.courier.firstName, photoUrl: v.courier.photoUrl ?? null, vehicle: v.courier.vehicleLabel, plate: v.courier.plate } : null} message={(url) => t(shareLink.subject === 'delivery' ? 'track.share_message' : 'share.message', { url })} onClose={() => setPanel(null)} onChanged={setShareLink} />
      ) : null}
      {v && showArrival ? (
        <ArrivalOverlay
          view={v}
          onRate={() => {
            setArrivalSeen(true);
            setRating(true);
          }}
          onLater={() => setArrivalSeen(true)}
        />
      ) : null}
      {v && rating ? <RatingPanel view={v} onDone={() => setRating(false)} /> : null}
      {v && moment ? <ShareCardPanel moment={moment} id={v.order.id} visible={cardOpen} onClose={() => setCardOpen(false)} /> : null}
    </View>
  );
}

function hintFor(state: string): MessageKey | null {
  if (state === 'merchant_rejected') return 'order.status.merchant_rejected_hint';
  if (state === 'platform_cancelled') return 'order.status.platform_cancelled_hint';
  return null;
}

/** Back button over the map, the order number, and any degraded-state banners under them. */
function TopBar({ orderNo, sos, children, onBannersLayout }: { orderNo?: string; sos?: ReactNode; children?: ReactNode; onBannersLayout?: (height: number) => void }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + theme.space[3], left: theme.space[4], right: theme.space[4], gap: theme.space[2] }}>
      <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <IconButton
          icon="chevron-back"
          variant="outline"
          accessibilityLabel={t('action.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/orders'))}
          style={{ backgroundColor: theme.colors.surface }}
          testID="track-back"
        />
        {orderNo ? (
          <View style={{ paddingHorizontal: theme.space[3], height: 36, borderRadius: 18, justifyContent: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
            <Text variant="label" weight={600} tabular>
              {orderNo}
            </Text>
          </View>
        ) : null}
        {sos ? <View style={{ marginStart: 'auto' }}>{sos}</View> : null}
      </View>
      <View pointerEvents="none" style={{ gap: theme.space[2], maxWidth: 520 }} onLayout={onBannersLayout ? (e) => onBannersLayout(Math.round(e.nativeEvent.layout.height)) : undefined}>
        {children}
      </View>
    </View>
  );
}
