import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FOOD_RATED_TYPES, orderTicketNumber, quickRepliesFor, quickReplyText, type QuickReplyKey, type ShareLink } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, EmptyState, formatClock, IconButton, Rule, Sheet, Skeleton, Text, Timeline, useTheme, useToast } from '@driver/ui';
import { newClientId, threadOf } from '@/features/chat/logic';
import { RideRoute, rideVehicleLabel, SearchCounter, searchElapsedSec, useSearchNote, WaitCounter, WaitNote } from '@/features/ride/LiveParts';
import { useConfirmRideArrived } from '@/features/ride/queries';
import { useRideMemo } from '@/features/ride/store';
import { useChatThreads } from '@/features/chat/queries';
import { useMaskedCall } from '@/features/chat/useMaskedCall';
import { SharePanel } from '@/features/share/SharePanel';
import { ArrivalOverlay, RatingPanel } from '@/features/track/Arrival';
import { lateMinutes, liveEta, signalLostMinutes } from '@/features/track/eta';
import { CancelPanel, DisputePanel, StreetPanel, UnreachablePanel } from '@/features/track/Panels';
import { isLive, useCourierPosition, useLiveOrder, useTracking } from '@/features/track/queries';
import { ActionRow, CourierCard, DegradedBanner, OrderItems, PriceSection, SheetHeader } from '@/features/track/SheetParts';
import { buildTimeline, phaseOf, statusLine } from '@/features/track/timeline';
import { TrackMap } from '@/features/track/TrackMap';
import { apiErrorCode, apiErrorMessage, useApi, useApiClient } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/** Collapsed sheet: handle + status line + ETA (plus the bottom safe area). */
const COLLAPSED = 108;
/** Each degraded-state banner over the map pushes the camera's top edge down by about this much. */
const BANNER_H = 84;
const TOP_BAR = 64;

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
  const eta = v ? liveEta(v, fix?.pin ?? null, new Date(now)) : null;
  const lateMin = v ? lateMinutes(eta, v.promisedAt) : 0;
  const phase = v ? phaseOf(v) : null;
  const ride = v?.order.type === 'ride';
  const courierName = v?.courier?.firstName ?? null;
  // Rides (customer spec §5): the vehicle asked for, the honest search line and counter, "وصلت".
  const memo = useRideMemo(id);
  const searching = Boolean(ride && phase === 'searching');
  const pickupArrivedAt = ride ? (v?.trip?.stops.find((s) => s.mine && s.type === 'pickup')?.arrivedAt ?? null) : null;
  const searchNote = useSearchNote(searching ? v : undefined, now);
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
  const [arrivalSeen, setArrivalSeen] = useState(false);
  const [rating, setRating] = useState(false);
  const arrived = phase === 'arrived' && !v?.order.rating;
  const prevPhase = useRef(phase);
  useEffect(() => {
    // The arrival moment fires once, live or on opening a delivered, unrated order.
    if (phase === 'arrived' && prevPhase.current !== 'arrived') setArrivalSeen(false);
    prevPhase.current = phase;
  }, [phase]);

  // Chat, masked call and share-trip (notifications & support §2; safety §5).
  const client = useApiClient();
  const threads = useChatThreads(id, Boolean(v && (v.courier || v.merchant) && !track.isError));
  const courierThread = threadOf(threads.data, 'customer_courier');
  const merchantThread = threadOf(threads.data, 'customer_merchant');
  const { call: maskedCall } = useMaskedCall(id, 'customer_courier', Boolean(ride));
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const share = async () => {
    if (ride) {
      try {
        setShareLink(shareLink && !shareLink.revokedAt ? shareLink : await client.tracking.createShareLink.mutate({ orderId: id }));
        setPanel('share');
      } catch (err) {
        toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' });
      }
      return;
    }
    try {
      await Share.share({ message: t('track.share_message', { url: Linking.createURL(`/order/${id}`) }) });
    } catch {
      toast.show({ message: t('error.network'), tone: 'warning' });
    }
  };
  const call = () => void maskedCall();
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
  const canCancel = v ? !v.order.pickedUpAt && live && phase !== 'unreachable' : false;
  const canStreet = v ? (FOOD_RATED_TYPES as readonly string[]).includes(v.order.type) && !v.order.pickedUpAt && live : false;
  const statusHint = v && phase === 'cancelled' ? hintFor(v.order.state) : null;
  const banners = (lostMin !== null ? 1 : 0) + (phase === 'reassigning' ? 1 : 0) + (lateMin > 0 && phase !== 'reassigning' && eta ? 1 : 0);
  const collapsed = COLLAPSED + insets.bottom + (searching && searchNote ? 22 : 0);

  return (
    <View testID="order-live" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      {v ? <TrackMap view={v} fix={fix} stale={lostMin !== null} topInset={insets.top + TOP_BAR + banners * BANNER_H} bottomInset={collapsed} searching={searching} /> : <View style={{ height: '62%', backgroundColor: theme.colors.surfaceSunken }} />}

      <TopBar orderNo={v ? t('order.number', { id: orderTicketNumber(v.order.id) }) : undefined}>
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
        {lateMin > 0 && phase !== 'reassigning' && eta ? (
          <DegradedBanner
            testID="running-late"
            icon="clock"
            tone="warning"
            title={t('track.running_late', { minutes: lateMin })}
            body={`${t('track.note_late', { minutes: lateMin, time: formatClock(eta) })} ${t('track.note_late_credit')}`}
          />
        ) : null}
      </TopBar>

      <Sheet
        snapPoints={[collapsed, 0.62, 0.9]}
        initialSnap={sheet === '2' ? 2 : sheet === '1' ? 1 : 0}
        testID="track-sheet"
        header={
          v && phase ? (
            <SheetHeader
              phase={phase}
              status={statusLine(v, t)}
              pill={[ride ? rideVehicleLabel(v, t, memo?.vertical) : t(`order.type.${v.order.type}` as MessageKey), v.merchant?.name].filter(Boolean).join(' · ')}
              eta={eta}
              now={now}
              lateMin={lateMin}
              note={searching ? searchNote : null}
              aside={searching ? <SearchCounter seconds={searchElapsedSec(v, now)} /> : ride && phase === 'at_pickup' && pickupArrivedAt ? <WaitCounter arrivedAt={pickupArrivedAt} now={now} /> : undefined}
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
            {ride ? <RideRoute view={v} /> : null}
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
            {v.courier && phase !== 'cancelled' ? (
              <>
                <Rule />
                <CourierCard
                  courier={v.courier}
                  ride={ride}
                  quickReplies={courierThread?.status === 'open' ? quickRepliesFor('customer', 'customer_courier', ride).slice(0, 3) : []}
                  unread={courierThread?.unread ?? 0}
                  canChat={Boolean(courierThread && courierThread.status !== 'not_open')}
                  onReply={(k) => void reply(k)}
                  onChat={() => openChat('customer_courier')}
                  onCall={call}
                  onShare={() => void share()}
                />
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
        <UnreachablePanel view={v} clock={clock} onCall={call} onImHere={() => toast.show({ message: t('track.unreachable_sent'), tone: 'success' })} />
      ) : null}
      {v && panel === 'cancel' ? <CancelPanel orderId={v.order.id} onClose={() => setPanel(null)} /> : null}
      {v && panel === 'dispute' ? <DisputePanel view={v} onClose={() => setPanel(null)} /> : null}
      {v && panel === 'street' ? <StreetPanel onClose={() => setPanel(null)} /> : null}
      {v && panel === 'share' && shareLink ? (
        <SharePanel link={shareLink} message={(url) => t('share.message', { url })} onClose={() => setPanel(null)} onChanged={setShareLink} />
      ) : null}
      {v && arrived && !arrivalSeen && !rating ? (
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
    </View>
  );
}

function hintFor(state: string): MessageKey | null {
  if (state === 'merchant_rejected') return 'order.status.merchant_rejected_hint';
  if (state === 'platform_cancelled') return 'order.status.platform_cancelled_hint';
  return null;
}

/** Back button over the map, the order number, and any degraded-state banners under them. */
function TopBar({ orderNo, children }: { orderNo?: string; children?: ReactNode }) {
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
      </View>
      <View pointerEvents="none" style={{ gap: theme.space[2], maxWidth: 520 }}>
        {children}
      </View>
    </View>
  );
}
