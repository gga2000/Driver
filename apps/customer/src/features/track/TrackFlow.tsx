import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { orderTicketNumber, type OrderTracking, type ShareLink } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Avatar, Button, EmptyState, formatClock, Icon, ModalSheet, Rule, Skeleton, Text, Timeline, useTheme, useToast } from '@driver/ui';
import { useMyPlaces } from '@/features/account/queries';
import { newClientId, threadOf } from '@/features/chat/logic';
import { useChatThreads } from '@/features/chat/queries';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { useGift } from '@/features/gift/gift-store';
import { useGiftHeadsUp } from '@/features/gift/GiftHeadsUp';
import { liveProgress } from '@/features/home/live-card';
import { currentSosFix } from '@/features/safety/fix';
import { ShareCardPanel } from '@/features/share-card/ShareCardPanel';
import { SharePanel } from '@/features/share/SharePanel';
import { apiErrorCode, apiErrorMessage, useApi, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import { useTrackingMoments } from './AlmostThere';
import { lateMinutes, liveEta, signalLostMinutes } from './eta';
import { mapMinutesLabel } from './eta-range';
import { LateBanner, useLatePromiseToast } from './LatePromise';
import { CancelPanel, DisputePanel, UNREACHABLE_PANEL_H, UnreachablePanel } from './Panels';
import { isLive, useCourierPosition, useLiveOrder, useTracking } from './queries';
import { ActionRow, DegradedBanner, OrderItems, PriceSection } from './SheetParts';
import { ThanksCard } from './ThanksCard';
import { buildTimeline, phaseOf, statusLine, type Phase } from './timeline';
import { TrackMap } from './TrackMap';
import { DockedCourier, DoorCash, MoneyLineView, NearCard, RoadDots, TimeBox, TrackFooter, TrackTopBar } from './TrackParts';
import { doorNote, moneyLine, roadDots, trackMode } from './track-v2';

function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

type Panel = 'cancel' | 'dispute' | 'share' | null;
type SheetName = 'details' | 'help' | null;

/**
 * The live food order, redesigned (after-order design Step 3, switch `track_v2`; rides keep their own
 * screen). One calm story from the kitchen to the door:
 * - while it cooks, the kitchen card with your dish in a saffron ring and the four-dot road (t1, t4);
 *   no still map;
 * - once the courier has it, the map slides in with one card under it (t1, t3, t5);
 * - near the door, «حيدر قريب» with the cash in big digits (a1); at the door, the cash card (a2);
 * - then one thank-you card: the picture, what you paid, the stars, the kind words and the tip
 *   (a3, a5, r1, r3).
 * One status line, one time, one money line on every step (t3); the honest-delay banner on top when
 * late (t8); everything else behind «التفاصيل» and «تحتاج شي؟» (t10). The reads, the clock, the chat
 * threads, the panels and the unreachable protocol are the old screen's, so its fixes carry over.
 */
export function TrackFlow({ id }: { id: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const qc = useQueryClient();
  const client = useApiClient();
  useLiveOrder(id);
  const track = useTracking(id);
  const v = track.data;
  const live = isLive(v);
  const pos = useCourierPosition(id, Boolean(live && v?.courier));
  const fix = live && v?.courier ? (pos.data ?? null) : null;

  // Server-corrected clock for the time box and the late bar.
  const tick = useNow(1000);
  const offset = useMemo(() => (v ? v.serverNow.getTime() - track.dataUpdatedAt : 0), [v, track.dataUpdatedAt]);
  const now = tick + offset;
  const clock = useMemo(() => () => Date.now() + offset, [offset]);
  const ageSec = fix ? fix.ageSec + Math.max(0, (tick - pos.dataUpdatedAt) / 1000) : null;
  const lostMin = signalLostMinutes(ageSec);
  const eta = v ? (fix?.etaAt ?? liveEta(v, fix?.pin ?? null, new Date(now))) : null;
  const lateMin = v ? lateMinutes(eta, v.promisedAt) : 0;
  const phase = v ? phaseOf(v) : null;
  const mode = v && phase ? trackMode(v, phase) : null;
  // The buzz and soft sound at each step (joy f3), and which door card shows.
  const moments = useTrackingMoments(v, phase, fix?.pin ?? null, eta, now);
  useLatePromiseToast(v);

  const threads = useChatThreads(id, Boolean(v && !track.isError));
  const courierThread = threadOf(threads.data, 'customer_courier');
  const merchantThread = threadOf(threads.data, 'customer_merchant');
  const supportThread = threadOf(threads.data, 'customer_support');
  const canChat = Boolean(courierThread && courierThread.status !== 'not_open');
  const openChat = (kind: 'customer_courier' | 'customer_merchant' | 'customer_support') => router.push({ pathname: '/chat/[orderId]', params: { orderId: id, kind } });

  const [panel, setPanel] = useState<Panel>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const gift = useGift(v?.order.id);
  const giftHeadsUp = useGiftHeadsUp(v?.order.id, gift, v?.merchant?.name ?? '');
  const places = useMyPlaces();

  const share = async () => {
    try {
      setShareLink(shareLink && !shareLink.revokedAt ? shareLink : await client.tracking.createShareLink.mutate({ orderId: id }));
      setPanel('share');
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' });
    }
  };
  // The unreachable protocol (f18): «أني نازل» buys 2 minutes once and says so in the chat too.
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
      .catch((err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' }));
    return true;
  };
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
  // Calls are postponed (before-launch §1): the unreachable panel's call says so.
  const callSoon = () => toast.show({ message: t('track.call_soon'), tone: 'info', icon: 'phone' });

  if (track.isError) {
    const code = apiErrorCode(track.error);
    const missing = code === 'forbidden' || code === 'not_found' || code === 'order_not_found';
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: theme.space[4] }}>
        <Stack.Screen options={{ headerShown: false }} />
        <TrackTopBar top={insets.top} />
        <EmptyState
          icon="receipt"
          title={missing ? t('track.not_found') : apiErrorMessage(track.error, t('error.network'), locale)}
          action={missing ? { label: t('nav.orders'), onPress: () => router.replace('/orders') } : { label: t('action.retry'), onPress: () => void track.refetch() }}
        />
      </View>
    );
  }

  if (!v || !phase || !mode) {
    return (
      <View testID="order-live" style={{ flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: theme.space[4] }}>
        <Stack.Screen options={{ headerShown: false }} />
        <TrackTopBar top={insets.top} />
        <View style={{ gap: theme.space[3], paddingTop: theme.space[2] }}>
          <Skeleton height={260} radius={theme.radius['2xl']} />
          <Skeleton height={20} width="70%" />
          <Skeleton height={64} />
        </View>
      </View>
    );
  }

  const orderNo = t('order.number', { id: orderTicketNumber(v.order.id) });
  const courierName = v.courier?.firstName ?? null;
  const money = moneyLine(v.order);
  const canCancel = !v.order.pickedUpAt && live && phase !== 'unreachable';
  const happy = phase === 'arrived' || phase === 'done';
  const onShare = v.courier && live ? () => void share() : undefined;
  const late = lateMin > 0 && phase !== 'reassigning' && eta ? <LateBanner view={v} lateMin={lateMin} eta={eta} now={now} /> : null;
  const courierLine = phase === 'to_pickup' ? t('track2.courier_to_kitchen') : phase === 'at_pickup' ? t('track2.courier_at_kitchen') : (v.courier?.vehicleLabel ?? null);
  const docked = v.courier ? <DockedCourier courier={v.courier} line={courierLine} unread={courierThread?.unread ?? 0} canChat={canChat} onChat={() => openChat('customer_courier')} /> : null;
  const footer = <TrackFooter onDetails={() => setSheet('details')} onHelp={() => setSheet('help')} />;

  // Shared overlays: the help and details sheets, the old panels, the share link and the picture to share.
  const overlays = (
    <>
      <HelpSheet
        visible={sheet === 'help'}
        onClose={() => setSheet(null)}
        rows={[
          merchantThread && merchantThread.status !== 'not_open' ? { icon: 'chat', label: t('track.message_merchant'), hint: merchantThread.unread > 0 ? t('chat.unread_label', { count: merchantThread.unread }) : undefined, onPress: () => openChat('customer_merchant'), testID: 'help-chat-merchant' } : null,
          canChat && v.courier && !happy ? { icon: 'chat', label: t('track.message_courier'), onPress: () => openChat('customer_courier'), testID: 'help-chat-courier' } : null,
          onShare ? { icon: 'share', label: t('track2.share_a11y'), onPress: onShare, testID: 'help-share' } : null,
          gift && !happy ? { icon: 'gift', label: t('gift.send_title', { name: gift.name }), onPress: () => void giftHeadsUp.send('whatsapp'), testID: 'help-gift' } : null,
          supportThread && (supportThread.status === 'open' || supportThread.lastMessageAt)
            ? { icon: 'chat', label: t('track.support'), hint: supportThread.unread > 0 ? t('chat.unread_label', { count: supportThread.unread }) : t('track.support_hint'), onPress: () => openChat('customer_support'), testID: 'help-support' }
            : null,
          { icon: 'flag', label: t('order.report_problem'), onPress: () => setPanel('dispute'), testID: 'help-report' },
          canCancel ? { icon: 'x', tone: 'dangerText', label: t('trip.cancel'), onPress: () => setPanel('cancel'), testID: 'help-cancel' } : null,
        ]}
      />
      <DetailsSheet visible={sheet === 'details'} onClose={() => setSheet(null)} view={v} eta={eta} lateMin={lateMin} courierName={courierName} />
      {panel === 'cancel' ? <CancelPanel orderId={v.order.id} onClose={() => setPanel(null)} /> : null}
      {panel === 'dispute' ? (
        <DisputePanel
          view={v}
          onClose={() => setPanel(null)}
          onSupport={
            supportThread && supportThread.status === 'open'
              ? () => {
                  setPanel(null);
                  openChat('customer_support');
                }
              : undefined
          }
        />
      ) : null}
      {panel === 'share' && shareLink ? (
        <SharePanel
          link={shareLink}
          preview={v.courier ? { driverName: v.courier.firstName, photoUrl: v.courier.photoUrl ?? null, vehicle: v.courier.vehicleLabel, plate: v.courier.plate } : null}
          message={(url) => t('track.share_message', { url })}
          onClose={() => setPanel(null)}
          onChanged={setShareLink}
        />
      ) : null}
      {v.merchant ? <ShareCardPanel moment={{ kind: 'food', dishName: v.items[0]?.name ?? null, merchant: v.merchant.name }} id={v.order.id} visible={cardOpen} onClose={() => setCardOpen(false)} /> : null}
    </>
  );

  // ── On the way: the map slides in with one card under it ──
  if (mode === 'map') {
    return (
      <MapMode
        view={v}
        phase={phase}
        fix={fix}
        stale={lostMin !== null}
        minutes={fix && eta && eta.getTime() > now ? mapMinutesLabel(t, Math.max(1, Math.round((eta.getTime() - now) / 60_000)), fix.etaAt ? fix.etaBasis : 'estimated', locale) : null}
        orderNo={orderNo}
        onShare={onShare}
        banners={
          <>
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
            {late}
          </>
        }
        near={moments.card === 'near' ? { onClose: moments.closeCard } : null}
        card={
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="heading" numberOfLines={2} testID="status-line" accessibilityLiveRegion="polite">
                  {statusLine(v, t, { now })}
                </Text>
                {v.order.pickedUpAt ? (
                  <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
                    {t('track2.sub_picked', { name: courierName ?? t('track.courier_fallback'), time: formatClock(v.order.pickedUpAt) })}
                  </Text>
                ) : null}
              </View>
              {eta ? <TimeBox eta={eta} now={now} late={lateMin > 0} /> : null}
            </View>
            <RoadDots dots={roadDots(v.order)} />
            {docked}
            <MoneyLineView money={money} compact />
            {footer}
          </>
        }
        unreachable={phase === 'unreachable' ? <UnreachablePanel view={v} clock={clock} courier={fix?.pin ?? null} onCall={callSoon} onComingOut={comingOut} onSendLocation={sendLocation} /> : null}
        money={money}
        courierName={courierName}
        overlays={overlays}
      />
    );
  }

  // ── Every other step: one calm column, the two quiet buttons pinned at the bottom ──
  return (
    <View testID="order-live" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[6], gap: theme.space[4], maxWidth: 560, width: '100%', alignSelf: 'center' }} showsVerticalScrollIndicator={false} testID="track-scroll">
        <TrackTopBar top={insets.top} orderNo={orderNo} onShare={mode === 'kitchen' || mode === 'door' ? onShare : undefined} />
        {mode === 'kitchen' ? (
          <>
            {late}
            <KitchenHero view={v} phase={phase} eta={eta} now={now} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View style={{ flex: 1 }}>
                <MoneyLineView money={money} />
              </View>
              {eta && phase !== 'waiting_merchant' ? <TimeBox eta={eta} now={now} late={lateMin > 0} /> : null}
            </View>
            {docked}
          </>
        ) : mode === 'door' ? (
          <DoorMode view={v} note={doorNote(v.dropoff, places.data ?? [])} canChat={canChat} onChat={() => openChat('customer_courier')} />
        ) : mode === 'thanks' ? (
          <>
            <ThanksCard view={v} canRate={phase === 'arrived'} />
            <View>
              <ActionRow icon="heart" label={t('sharecard.action')} onPress={() => setCardOpen(true)} testID="action-share-card" />
              <ActionRow icon="gift" label={t('account.invite_row')} hint={t('account.invite_row_hint')} onPress={() => router.push('/invite')} testID="action-invite" />
            </View>
          </>
        ) : (
          <EndedCard view={v} />
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: Math.max(insets.bottom, theme.space[3]), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.bg }}>
        <View style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          {mode === 'thanks' ? (
            <TrackFooter onDetails={() => setSheet('details')} onHelp={() => setSheet('help')}>
              <Button label={t('action.done')} fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/orders'))} testID="thanks-done" />
            </TrackFooter>
          ) : (
            footer
          )}
        </View>
      </View>
      {overlays}
    </View>
  );
}

// ───────────────────────── while it cooks (t1, t4) ─────────────────────────

const RING = 148;
const RING_STROKE = 7;

/**
 * The kitchen card: your first dish drawn in a saffron ring that fills with the road (#7's
 * `liveProgress`, the same as home's live card), the kitchen's own words for where it is, and when it
 * said yes and should be ready, then the four dots.
 */
function KitchenHero({ view, phase, eta, now }: { view: OrderTracking; phase: Phase; eta: Date | null; now: number }) {
  const theme = useTheme();
  const t = useT();
  const o = view.order;
  const merchant = view.merchant?.name ?? '';
  const title =
    phase === 'reassigning'
      ? t('track.reassigning')
      : phase === 'waiting_merchant'
        ? o.heldForPayer
          ? t('order.status.awaiting_payer')
          : t('track2.title_placed', { merchant })
        : o.readyAt
          ? t('track2.title_ready')
          : o.preparingAt || o.state === 'preparing'
            ? t('track2.title_cooking', { merchant })
            : t('track2.title_accepted', { merchant });
  const sub =
    phase === 'reassigning'
      ? t('track.reassigning_note')
      : phase === 'waiting_merchant'
        ? t(o.heldForPayer ? 'order.status.awaiting_payer_hint' : 'order.status.placed_hint')
        : o.acceptedAt
          ? o.promisedReadyAt && !o.readyAt
            ? t('track2.sub_accepted', { time: formatClock(o.acceptedAt), ready: formatClock(o.promisedReadyAt) })
            : t('track2.sub_accepted_only', { time: formatClock(o.acceptedAt) })
          : null;
  const first = view.items[0];
  const art = artOf({ id: first?.lineId ?? o.id, name: first?.name ?? '' });
  const r = (RING - RING_STROKE) / 2;
  const length = 2 * Math.PI * r;
  const progress = liveProgress(o, eta, now);
  return (
    <Animated.View
      entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.base)}
      testID="track-kitchen"
      style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[5], paddingHorizontal: theme.space[4], borderRadius: theme.radius['2xl'], backgroundColor: theme.colors.accentTint }}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={RING} height={RING} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={theme.colors.surface} strokeWidth={RING_STROKE} fill="none" />
          <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={theme.colors.accent} strokeWidth={RING_STROKE} strokeLinecap="round" fill="none" strokeDasharray={`${length} ${length}`} strokeDashoffset={length * (1 - progress)} />
        </Svg>
        <View style={{ width: RING - 28, height: RING - 28, borderRadius: (RING - 28) / 2, overflow: 'hidden', backgroundColor: theme.colors.surface }}>
          <FoodArt {...art} stage={theme.colors.surface} />
        </View>
      </View>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text variant="heading" align="center" testID="status-line" accessibilityLiveRegion="polite">
          {title}
        </Text>
        {sub ? (
          <Text variant="footnote" color="textMuted" align="center" tabular>
            {sub}
          </Text>
        ) : null}
      </View>
      <RoadDots dots={roadDots(o)} />
    </Animated.View>
  );
}

// ───────────────────────── on the way (t1, t3, t5, a1) ─────────────────────────

function MapMode({
  view,
  phase,
  fix,
  stale,
  minutes,
  orderNo,
  onShare,
  banners,
  near,
  card,
  unreachable,
  money,
  courierName,
  overlays,
}: {
  view: OrderTracking;
  phase: Phase;
  fix: Parameters<typeof TrackMap>[0]['fix'];
  stale: boolean;
  minutes: string | null;
  orderNo: string;
  onShare?: () => void;
  banners: ReactNode;
  near: { onClose: () => void } | null;
  card: ReactNode;
  unreachable: ReactNode;
  money: ReturnType<typeof moneyLine>;
  courierName: string | null;
  overlays: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [cardH, setCardH] = useState(360);
  const [bannersH, setBannersH] = useState(0);
  const topBar = insets.top + theme.space[3] + 44 + theme.space[2];
  const bottom = phase === 'unreachable' ? UNREACHABLE_PANEL_H + insets.bottom : cardH;
  return (
    <View testID="order-live" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(500)} style={StyleSheet.absoluteFill}>
        <TrackMap view={view} fix={fix} stale={stale} topInset={topBar + bannersH} bottomInset={bottom} minutes={minutes} spotlight={phase === 'unreachable'} />
      </Animated.View>
      <TrackTopBar floating top={insets.top} orderNo={orderNo} onShare={onShare} />
      <View pointerEvents="none" onLayout={(e) => setBannersH(Math.round(e.nativeEvent.layout.height))} style={{ position: 'absolute', top: topBar, left: theme.space[4], right: theme.space[4], gap: theme.space[2], maxWidth: 520 }}>
        {banners}
      </View>
      {near ? <NearCard name={courierName} money={money} top={topBar + bannersH + (bannersH > 0 ? theme.space[2] : 0)} onClose={near.onClose} /> : null}
      {phase !== 'unreachable' ? (
        <Animated.View
          entering={theme.reduceMotion ? undefined : SlideInDown.springify().damping(18)}
          onLayout={(e) => setCardH(Math.round(e.nativeEvent.layout.height))}
          testID="track-card"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            gap: theme.space[3],
            paddingTop: theme.space[4],
            paddingHorizontal: theme.space[4],
            paddingBottom: Math.max(insets.bottom, theme.space[3]),
            backgroundColor: theme.colors.bg,
            borderTopLeftRadius: theme.radius['2xl'],
            borderTopRightRadius: theme.radius['2xl'],
            shadowColor: theme.colors.text,
            shadowOpacity: 0.12,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: -4 },
            elevation: 10,
          }}
        >
          <View style={{ gap: theme.space[3], maxWidth: 560, width: '100%', alignSelf: 'center' }}>{card}</View>
        </Animated.View>
      ) : null}
      {unreachable}
      {overlays}
    </View>
  );
}

// ───────────────────────── at the door (a2) ─────────────────────────

function DoorMode({ view, note, canChat, onChat }: { view: OrderTracking; note: string | null; canChat: boolean; onChat: () => void }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const name = view.courier?.firstName ?? t('track.courier_fallback');
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.base)} testID="track-door" style={{ alignItems: 'center', gap: theme.space[4] }}>
      <View style={{ alignItems: 'center', gap: theme.space[2], paddingTop: theme.space[2] }}>
        <Avatar name={name} uri={apiPhoto(view.courier?.photoUrl) ?? undefined} size={96} ring />
        <Text variant="display" align="center" accessibilityRole="header" testID="status-line" accessibilityLiveRegion="assertive" style={{ fontSize: 30, lineHeight: 44 }}>
          {t('track.door_title', { name })}
        </Text>
        {note ? (
          <Text variant="body" color="textMuted" align="center">
            {note}
          </Text>
        ) : null}
      </View>
      <DoorCash money={moneyLine(view.order)} />
      <View style={{ flexDirection: 'row', gap: theme.space[2], alignSelf: 'stretch' }}>
        {canChat ? (
          <View style={{ flex: 1 }}>
            <Button label={t('track2.door_chat', { name })} icon="chat" variant="secondary" fullWidth onPress={onChat} testID="door-chat" />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('track.call_soon')}
            onPress={() => toast.show({ message: t('track.call_soon'), tone: 'info', icon: 'phone' })}
            testID="door-call-soon"
            style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken, opacity: pressed ? 0.7 : 1 })}
          >
            <Icon name="phone" size={18} color="textMuted" />
            <Text variant="label" weight={600} color="textMuted">
              {t('track2.call_label')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

// ───────────────────────── ended ─────────────────────────

const ENDED_HINT: Partial<Record<string, MessageKey>> = {
  merchant_rejected: 'order.status.merchant_rejected_hint',
  platform_cancelled: 'order.status.platform_cancelled_hint',
};

/** Rejected, cancelled, failed or under review: what happened and what it means, calmly. */
function EndedCard({ view }: { view: OrderTracking }) {
  const theme = useTheme();
  const t = useT();
  const hint = ENDED_HINT[view.order.state];
  return (
    <View testID="track-ended" style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[6], paddingHorizontal: theme.space[4], borderRadius: theme.radius['2xl'], backgroundColor: theme.colors.surfaceSunken }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }}>
        <Icon name="receipt" size={26} color="textMuted" />
      </View>
      <Text variant="heading" align="center" testID="status-line">
        {statusLine(view, t)}
      </Text>
      {hint ? (
        <Text variant="body" color="textMuted" align="center">
          {t(hint)}
        </Text>
      ) : null}
      <Button label={t('track2.ended_orders')} variant="secondary" onPress={() => router.replace('/orders')} testID="ended-orders" />
    </View>
  );
}

// ───────────────────────── «تحتاج شي؟» and «التفاصيل» (t10) ─────────────────────────

interface HelpRow {
  icon: 'chat' | 'share' | 'gift' | 'flag' | 'x';
  label: string;
  hint?: string;
  tone?: 'text' | 'dangerText';
  onPress: () => void;
  testID: string;
}

/** Every way to get help in one sheet: the restaurant, the courier, share, support, a problem, cancel. */
function HelpSheet({ visible, onClose, rows }: { visible: boolean; onClose: () => void; rows: ReadonlyArray<HelpRow | null> }) {
  const t = useT();
  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('track.actions_title')} testID="help-sheet">
      <View>
        {rows
          .filter((r): r is HelpRow => r !== null)
          .map((r) => (
            <ActionRow
              key={r.testID}
              icon={r.icon}
              label={r.label}
              {...(r.hint ? { hint: r.hint } : {})}
              {...(r.tone ? { tone: r.tone } : {})}
              testID={r.testID}
              onPress={() => {
                onClose();
                r.onPress();
              }}
            />
          ))}
      </View>
    </ModalSheet>
  );
}

/** The whole order behind one button: the steps with their times, the dishes, the receipt. */
function DetailsSheet({ visible, onClose, view, eta, lateMin, courierName }: { visible: boolean; onClose: () => void; view: OrderTracking; eta: Date | null; lateMin: number; courierName: string | null }) {
  const theme = useTheme();
  const t = useT();
  const timeline = buildTimeline(view, { eta, lateMin, courierName }, t, formatClock);
  const ended = phaseOf(view) === 'cancelled';
  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('track.items_title')} testID="details-sheet">
      <View style={{ gap: theme.space[4] }}>
        {!ended ? <Timeline steps={timeline.steps} current={timeline.current} /> : null}
        {view.items.length > 0 ? (
          <>
            <Rule />
            <OrderItems view={view} />
          </>
        ) : null}
        <PriceSection view={view} />
      </View>
    </ModalSheet>
  );
}
