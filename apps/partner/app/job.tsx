import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LANDMARK_RULES } from '@driver/map';
import type { HandoverProof, PartnerJob, PartnerJobStop, ZoneCheckAnswer } from '@driver/contracts';
import { Button, Icon, IconButton, RetryState, retryKindFor, Skeleton, SlideToConfirm, StatusPill, Text, useLoadTimeout, useNetwork, useTheme, useToast, withAlpha } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { threadOf } from '@/features/chat/logic';
import { useChatThreads } from '@/features/chat/queries';
import { CALLS_LIVE } from '@/features/chat/calls';
import { useChatPing } from '@/features/chat/useChatPing';
import { useMaskedCall } from '@/features/chat/useMaskedCall';
import { DriverMap, type MapPin } from '@/features/map/DriverMap';
import { SosControl } from '@/features/safety/SosControl';
import { uploadPhoto, type PickedPhoto } from '@/features/account/photo';
import { useGuarantee } from '@/features/account/queries';
import { DonePanel, HandoverPanel, UnreachablePanel } from '@/features/work/JobPanels';
import { NavChooser } from '@/features/work/JobSheets';
import { JobActions, PickupCode, PlaceHeadline, ProblemSheet, ProgressRail, ReadyBar, RiderWait, type ProblemItem } from '@/features/work/JobParts';
import { doorHint, railStage, stepKey, stepSpeech } from '@/features/work/job-steps';
import { SlipNote } from '@/features/offer/SlipParts';
import { speakOffer, stopSpeaking } from '@/features/offer/speak';
import { openNav, setNavApp, useNavApp, type NavApp } from '@/features/work/nav';
import { DoorCard } from '@/features/work/DoorCard';
import { PickupSpotCard } from '@/features/work/PickupSpotCard';
import { StartCodePanel } from '@/features/work/StartCodePanel';
import { needsStartCode } from '@/features/work/start-code';
import { useAutoArrive } from '@/features/work/useAutoArrive';
import {
  canTopUpOnJob,
  cargoLine,
  isRide,
  jobAction,
  KIND_KEY,
  mapsUrl,
  taskProgress,
  VEHICLE_ICON,
  zoneCheckMoment,
  zoneName,
} from '@/features/work/logic';
import { tenderLine } from '@/features/work/cash-door';
import { giftNote, type GiftNote } from '@/features/work/gift';
import { applyQueued } from '@/features/work/offline-queue';
import { PayLines } from '@/features/work/OfferParts';
import { useActiveJob, useAnswerZoneCheck, useJobRoute, useRefreshWork, useStatus, useTripActions, useZoneCheck } from '@/features/work/queries';
import { ZoneCheckCard } from '@/features/work/ZoneCheckCard';
import { useJobQueue } from '@/features/work/useJobQueue';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT, type TFn } from '@/lib/i18n';
import { playDoneTink } from '@/lib/alert';
import { currentFix } from '@/lib/location';
import { amountParam } from '@/lib/money';

/**
 * On a job: one task at a time with a single advancing button (وصلت للمطعم → استلمت → وصلت للزبون →
 * سلّمت), the stop list, quick contact, open-in-maps, the handover photo + cash confirm at the door,
 * and the unreachable-customer protocol. Everything writes through `trips.*`.
 *
 * Offline (P-09): "وصلت" and "سلّمت" are saved on the phone with the tap's device time and sent in
 * order when the network is back (useJobQueue); the screen moves on with "محفوظ، يندز لما يرجع النت".
 * Steps that need the server's answer (the unreachable protocol) say they need internet.
 */
export default function JobScreen() {
  const theme = useTheme();
  const t = useT();
  const job = useActiveJob();
  const status = useStatus();
  const queue = useJobQueue();
  const net = useNetwork();
  const locale = useLocale();
  const [done, setDone] = useState<(JobDone & { at: number }) | null>(null);
  const finish = (d: JobDone) => setDone({ ...d, at: Date.now() });
  const goHome = () => router.replace('/');
  // S-3: the day line counts this job, so it waits for a status read that started after the job ended.
  const refetchStatus = status.refetch;
  useEffect(() => {
    if (done && !done.queued) void refetchStatus();
  }, [done, refetchStatus]);
  // undefined: no day line (saved offline, or the job screen reopened after the fact); null: being re-read.
  const today = done && !done.queued ? (status.data && status.dataUpdatedAt >= done.at ? status.data.today : null) : undefined;
  // G-91: the live peak shift's count, read after this job (no line until then, none offline).
  const counted = Boolean(done && !done.queued && !done.failed);
  const guaranteeQ = useGuarantee({ enabled: counted });
  const guarantee = counted && done && guaranteeQ.data?.enabled && guaranteeQ.dataUpdatedAt >= done.at ? guaranteeQ.data.current : null;
  // Maps program SP3: «انت بمنطقة X؟», read after this job (the server asks from the finished drop-off).
  const zoneQ = useZoneCheck(counted);
  const answerZone = useAnswerZoneCheck();
  const toast = useToast();
  const [zoneAnswered, setZoneAnswered] = useState<string | null>(null);
  const { check: zoneCheck, hold: zoneHold } = zoneCheckMoment({ counted, doneAt: done?.at ?? 0, readAt: zoneQ.dataUpdatedAt, readFailed: zoneQ.isError, check: zoneQ.data, answeredId: zoneAnswered });
  const onZoneAnswer = (answer: ZoneCheckAnswer) => {
    if (!zoneCheck) return;
    setZoneAnswered(zoneCheck.checkId);
    answerZone.mutate(
      { checkId: zoneCheck.checkId, answer },
      {
        onSuccess: () => toast.show({ message: t('partner.zone_check_thanks'), tone: 'success' }),
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }),
      },
    );
  };
  // No endless skeleton: offline with no job cached, say why and offer a retry.
  const [slow, restartSlow] = useLoadTimeout(!job.data && !job.isFetched);
  const view = job.data ? applyQueued(job.data, queue.items) : null;

  if (done || view?.allDone) {
    const queued = done ? Boolean(done.queued) : true;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <View style={{ flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}>
          {queued ? <QueuedStrip sending={queue.sending} text="partner.done_queued" /> : null}
          <DonePanel
            earnedIqd={done?.earnedIqd ?? job.data?.pay.totalIqd ?? 0}
            failed={done?.failed ?? false}
            onHome={goHome}
            changeToWalletIqd={done?.changeToWalletIqd}
            today={today}
            guarantee={guarantee}
            demand={status.data?.demand ?? null}
            ask={zoneCheck ? <ZoneCheckCard check={zoneCheck} onAnswer={onZoneAnswer} /> : null}
            hold={zoneHold}
          />
        </View>
      </SafeAreaView>
    );
  }
  if (!job.data || !view) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg, padding: theme.space[5], gap: theme.space[4] }}>
        {job.isFetched ? (
          <DonePanel earnedIqd={0} failed onHome={goHome} />
        ) : slow || job.isError ? (
          <RetryState
            kind={retryKindFor({ net, error: job.error, slow })}
            locale={locale}
            onRetry={() => {
              restartSlow();
              void job.refetch();
            }}
            secondary={{ label: t('action.back'), icon: 'chevron-back', onPress: goHome }}
          />
        ) : (
          <Skeleton lines={4} />
        )}
      </SafeAreaView>
    );
  }
  return (
    <JobView
      job={view.job}
      saved={view.saved}
      queued={queue.items.some((a) => a.tripId === view.job.tripId)}
      sending={queue.sending}
      self={status.data?.position ?? null}
      vehicle={status.data?.vehicleClass ?? 'bike'}
      topUp={canTopUpOnJob(job.data, status.data?.roles ?? [])}
      onDone={finish}
    />
  );
}

/** How the job ended, for the done screen: what he earned, and his cash before the last hand-over. */
interface JobDone {
  earnedIqd: number;
  failed: boolean;
  queued?: boolean;
  /** "الخردة علينا": what went to the customer's wallet at this door. */
  changeToWalletIqd?: number | undefined;
}

function JobView({
  job,
  saved,
  queued,
  sending,
  self,
  vehicle,
  topUp,
  onDone,
}: {
  job: PartnerJob;
  /** Stops whose state only this phone knows so far (taps waiting for the network). */
  saved: ReadonlySet<string>;
  /** Taps of this job are waiting: show "محفوظ، يندز لما يرجع النت". */
  queued: boolean;
  sending: boolean;
  self: { lat: number; lng: number } | null;
  vehicle: keyof typeof VEHICLE_ICON;
  /** A courier carrying a live order: the customer may hand him cash for his wallet. */
  topUp: boolean;
  onDone: (d: JobDone) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const actions = useTripActions();
  const client = useApiClient();
  const queue = useJobQueue();
  const net = useNetwork();
  const [tapping, setTapping] = useState(false);
  const refresh = useRefreshWork();
  const [panel, setPanel] = useState<'none' | 'handover' | 'start_code'>('none');
  // s1 «رمز المشوار»: how many codes the server refused on this pickup (each clears the pad).
  const [codeWrong, setCodeWrong] = useState(0);
  const [dismissedUnreachable, setDismissedUnreachable] = useState(false);
  const ride = isRide(job.vertical);
  const stop = job.stops.find((s) => s.stopId === job.currentStopId) ?? null;
  const action = stop ? jobAction(stop, job.vertical) : null;
  const progress = taskProgress(job);
  const busy = tapping || actions.unreachable.isPending || actions.fail.isPending;
  // The last open stop: completing it ends the job (on the server, or on this phone until it syncs).
  const lastStop = !!stop && job.stops.every((s) => s.stopId === stop.stopId || s.state === 'completed' || s.state === 'skipped');
  const showUnreachable = !!job.unreachable && !dismissedUnreachable && stop?.type === 'dropoff';
  // Maps program d2: the road through what is left; d4: "وصلت؟" once he stands at the stop.
  const road = useJobRoute(true, `${stop?.stopId ?? 'none'}:${stop?.state ?? ''}`);
  const arrival = useAutoArrive(stop?.stopId ?? null, stop?.state === 'pending' && action?.kind === 'arrive' && !saved.has(stop.stopId));
  const nav = useNavApp();
  const [choosingNav, setChoosingNav] = useState(false);

  const pins = useMemo<MapPin[]>(
    () =>
      job.stops
        .filter((s) => s.pin && s.state !== 'completed' && s.state !== 'skipped')
        .map((s) => ({ at: s.pin!, kind: s.type === 'dropoff' ? 'dropoff' : 'pickup', label: placeTitle(s, ride, t, locale) })),
    [job.stops, ride, t, locale],
  );

  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
  const savedToast = () => {
    theme.haptic('warning');
    toast.show({ message: t('partner.queued'), tone: 'warning', icon: 'clock' });
  };
  /** The unreachable protocol runs on the server's clock: it can't be saved for later. */
  const needsInternet = () => {
    if (net.online) return false;
    toast.show({ message: t('net.needs_internet'), tone: 'warning', icon: 'wifi-off' });
    return true;
  };

  const advance = async () => {
    if (!stop || !action || busy) return;
    if (action.kind === 'complete' && stop.type === 'dropoff' && !ride) {
      setPanel('handover');
      return;
    }
    // s1: a night ride starts with the rider's 4 digits, checked by the server (so only with internet).
    if (action.kind === 'complete' && needsStartCode(stop, ride)) {
      if (needsInternet()) return;
      setPanel('start_code');
      return;
    }
    setTapping(true);
    try {
      if (action.kind === 'arrive') {
        // A real fix only: without one the server judges the arrival from his last reported position
        // (a made-up town-centre pin would flag every web/desktop arrival as outside the geofence).
        // Its accuracy goes along: precise arrivals teach a saved place its door (maps program a3).
        const fix = await currentFix(4000);
        const res = await queue.run({ kind: 'arrive', tripId: job.tripId, stopId: stop.stopId, ...(fix ? { pin: { lat: fix.lat, lng: fix.lng }, ...(fix.accuracyM !== undefined ? { accuracyM: fix.accuracyM } : {}) } : {}) });
        if (res.status === 'queued') return savedToast();
        const s = res.trip.stops.find((x) => x.id === stop.stopId);
        if (s?.arrivedOutsideGeofence) toast.show({ message: t('partner.arrived_outside'), tone: 'warning' });
      } else {
        const res = await queue.run({ kind: 'complete', tripId: job.tripId, stopId: stop.stopId, handover: {} });
        if (res.status === 'queued') {
          savedToast();
          if (lastStop) onDone({ earnedIqd: job.pay.totalIqd, failed: false, queued: true });
          return;
        }
        if (res.trip.state === 'completed') onDone({ earnedIqd: job.pay.totalIqd, failed: false });
      }
      theme.haptic('success');
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setTapping(false);
    }
  };

  const handover = async (photo: PickedPhoto | null, cash: Pick<HandoverProof, 'cashCollectedIqd' | 'changeToWalletIqd'> | null) => {
    if (!stop) return;
    setTapping(true);
    // "الخردة علينا" on the done screen: what went to the customer's wallet at this door.
    const before = { changeToWalletIqd: cash?.changeToWalletIqd };
    try {
      // Maps program f11: the photo goes up first; with no network it stays on the phone (noted) and
      // the delivery itself is still saved for later.
      let photoUploadId: string | null = null;
      if (photo) photoUploadId = await uploadPhoto(photo, (input) => client.places.photoUpload.mutate(input)).catch(() => null);
      const res = await queue.run({
        kind: 'complete',
        tripId: job.tripId,
        stopId: stop.stopId,
        handover: {
          ...(stop.collectIqd > 0 && cash ? cash : {}),
          ...(photoUploadId ? { photoUploadId } : photo ? { note: 'handover_photo_on_device' } : {}),
          recipientConfirmed: true,
        },
      });
      setPanel('none');
      if (res.status === 'queued') {
        savedToast();
        if (lastStop) onDone({ earnedIqd: job.pay.totalIqd, failed: false, queued: true, ...before });
        return;
      }
      await refresh();
      if (res.trip.state === 'completed') onDone({ earnedIqd: job.pay.totalIqd, failed: false, ...before });
    } catch (err) {
      fail(err);
    } finally {
      setTapping(false);
    }
  };

  /** s1: «الراكب صعد» with the code he typed; a wrong one keeps the pad open (the server counts it). */
  const startWithCode = async (code: string) => {
    if (!stop || needsInternet()) return;
    setTapping(true);
    try {
      const trip = await actions.complete.mutateAsync({ tripId: job.tripId, stopId: stop.stopId, handover: {}, startCode: code, occurredAt: new Date() });
      setPanel('none');
      setCodeWrong(0);
      theme.haptic('success');
      await refresh();
      if (trip.state === 'completed') onDone({ earnedIqd: job.pay.totalIqd, failed: false });
    } catch (err) {
      if (apiErrorCode(err) === 'start_code_wrong') {
        theme.haptic('error');
        setCodeWrong((n) => n + 1);
      } else fail(err);
    } finally {
      setTapping(false);
    }
  };

  const startUnreachable = async () => {
    if (!stop || needsInternet()) return;
    try {
      await actions.unreachable.mutateAsync({ tripId: job.tripId, stopId: stop.stopId, occurredAt: new Date() });
      setDismissedUnreachable(false);
      theme.haptic('warning');
      await refresh();
    } catch (err) {
      fail(err);
    }
  };

  const endUnreachable = async () => {
    if (needsInternet()) return;
    try {
      await actions.fail.mutateAsync({ tripId: job.tripId, reason: 'unreachable' });
      await refresh();
      onDone({ earnedIqd: 0, failed: true });
    } catch (err) {
      fail(err);
    }
  };

  // Quick contact (notifications & support §2): in-order chat and masked calls through `chat.*`.
  const orderId = stop?.orderId ?? job.stops.find((s) => s.orderId)?.orderId ?? '';
  const threads = useChatThreads(orderId, Boolean(orderId));
  const customerThread = threadOf(threads.data, 'customer_courier');
  const kitchenThread = threadOf(threads.data, 'merchant_courier');
  useChatPing(threads.data);
  const atKitchen = !ride && stop?.type === 'pickup' && Boolean(kitchenThread);
  const customerCall = useMaskedCall(orderId, 'customer_courier', ride);
  const kitchenCall = useMaskedCall(orderId, 'merchant_courier', ride);
  const openChat = (kind: 'customer_courier' | 'merchant_courier') => router.push({ pathname: '/chat/[orderId]', params: { orderId, kind } });
  // G0-10 «Chat first»: no calls at launch — the greyed button says so and opens the chat instead.
  const callSoon = () => {
    toast.show({ message: t('partner.call_soon_toast'), tone: 'info', icon: 'chat' });
    if (atKitchen && kitchenThread) openChat('merchant_courier');
    else if (customerThread) openChat('customer_courier');
  };
  const call = () => (CALLS_LIVE ? void (atKitchen ? kitchenCall.call() : customerCall.call()) : callSoon());
  // Maps program d3: his navigation app; the first time, he picks it.
  const navigate = (app: NavApp) => {
    if (stop?.pin) void openNav(app, stop.pin).catch(() => void Linking.openURL(mapsUrl(stop.pin!)).catch(() => undefined));
  };
  const openMaps = () => {
    if (!stop?.pin) return;
    if (nav.app) navigate(nav.app);
    else setChoosingNav(true);
  };
  const column = { width: '100%' as const, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' as const };

  // j4: the message action reaches the kitchen while the food is still there, the customer after.
  const chatKind = atKitchen ? 'merchant_courier' : 'customer_courier';
  const chatThread = atKitchen ? kitchenThread : customerThread;
  const unread = (customerThread?.unread ?? 0) + (kitchenThread?.unread ?? 0);
  const [problem, setProblem] = useState(false);
  const [safetyAsk, setSafetyAsk] = useState(0);
  const stage = railStage(stop);
  const hint = stop ? doorHint(stop) : null;
  const place = stop ? placeTitle(stop, ride, t, locale) : '';
  const notReady = stop?.type === 'pickup' && !ride && job.merchant?.state === 'preparing';
  const multi = job.stops.length > 2;
  // j8: «وصلت» lights up once he stands at the stop (60 m for 10 s); he still taps it.
  const lit = arrival.ask && action?.kind === 'arrive';
  useEffect(() => {
    if (lit) theme.haptic('success');
  }, [lit, theme]);
  // j10: each step said once, when it begins («وصلت لمطعم خالد، وري الرمز 4 6 0 5»), if he keeps it on.
  const moment = `${job.tripId}:${stepKey(stop)}`;
  useEffect(() => {
    if (!stop || SPOKEN.has(moment)) return;
    SPOKEN.add(moment);
    const text = stepSpeech(stop, place, ride, t, locale);
    if (text) speakOffer(text, locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment]);
  useEffect(() => () => stopSpeaking(), []);
  // j6: the kitchen pressed «صار جاهز» (order.ready) while he is on his way or waiting: a bell and the words.
  const prepState = job.merchant?.state ?? null;
  const lastPrep = useRef(prepState);
  useEffect(() => {
    const was = lastPrep.current;
    lastPrep.current = prepState;
    if (prepState !== 'ready' || !was || was === 'ready' || was === 'picked_up' || stop?.type !== 'pickup' || ride) return;
    theme.haptic('success');
    playDoneTink();
    speakOffer(t('partner.ready_bar_ready'), locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepState]);

  const problems: ProblemItem[] = [
    ...(stop?.type === 'dropoff' && stop.state === 'arrived' && !ride ? [{ key: 'unreachable', icon: 'clock' as const, title: t('partner.job_unreachable_cta'), body: t('partner.problem_unreachable_sub'), onPress: () => void startUnreachable() }] : []),
    ...(kitchenThread ? [{ key: 'kitchen', icon: 'bag' as const, title: t('partner.problem_kitchen'), body: t('partner.problem_kitchen_sub'), onPress: () => openChat('merchant_courier') }] : []),
    ...(customerThread ? [{ key: 'customer', icon: 'chat' as const, title: t('partner.problem_customer'), body: t('partner.problem_customer_sub'), onPress: () => openChat('customer_courier') }] : []),
    { key: 'safety', icon: 'shield', title: t('partner.problem_safety'), body: t('partner.problem_safety_sub'), tone: 'danger', onPress: () => setSafetyAsk((n) => n + 1) },
  ];

  return (
    <View testID="job" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavChooser
        visible={choosingNav}
        current={nav.app}
        onClose={() => setChoosingNav(false)}
        onPick={(app) => {
          setChoosingNav(false);
          void setNavApp(app);
          navigate(app);
        }}
      />
      <ProblemSheet visible={problem} items={problems} onClose={() => setProblem(false)} />
      {/* At the door the cash helper needs the room, not the map: it shrinks to a strip under the top bar. */}
      <View style={{ height: panel === 'none' ? '34%' : '17%' }}>
        <DriverMap
          self={self}
          vehicleIcon={VEHICLE_ICON[vehicle]}
          online
          pins={pins}
          route={self ? [self, ...pins.map((p) => p.at)] : pins.map((p) => p.at)}
          road={road.data?.polyline6 ?? null}
          topInset={92}
          bottomInset={64}
          maxZoom={15.4}
          /* Drivers give directions by landmarks: names from the map's own closest zoom (Ali 2026-10-07). */
          landmarkNameZoom={LANDMARK_RULES.driverNameZoom}
          testID="job-map"
        />
        <SafeAreaView edges={['top']} pointerEvents="box-none" style={{ position: 'absolute', top: 0, start: 0, end: 0 }}>
          <View style={[column, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }]}>
            <IconButton icon="chevron-back" variant="outline" accessibilityLabel={t('action.back')} onPress={() => router.navigate('/')} />
            <StatusPill label={t(KIND_KEY[job.vertical])} tone="neutral" icon={ride ? VEHICLE_ICON[vehicle] : 'bag'} />
            <SosControl subject={{ kind: 'trip', id: job.tripId }} openSignal={safetyAsk} />
          </View>
        </SafeAreaView>
        {/* j9: his maps app in one tap, on the map itself. */}
        {panel === 'none' && stop?.pin ? (
          <Pressable
            testID="job-maps-corner"
            accessibilityRole="button"
            accessibilityLabel={t('partner.open_maps')}
            onPress={openMaps}
            style={({ pressed }) => ({ position: 'absolute', bottom: 36, end: theme.space[4], flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: theme.space[3], borderRadius: 999, backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border })}
          >
            <Icon name="location-arrow" size={18} color="text" strokeWidth={2.2} />
            <Text variant="label" weight={700}>
              {t('partner.open_maps')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flex: 1, marginTop: -24, backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius['2xl'], borderTopRightRadius: theme.radius['2xl'] }}>
        <ScrollView contentContainerStyle={[column, { padding: theme.space[5], gap: theme.space[4] }]}>
          {panel === 'start_code' && stop ? (
            <StartCodePanel busy={tapping} wrongCount={codeWrong} onSubmit={(code) => void startWithCode(code)} onClose={() => setPanel('none')} />
          ) : panel === 'handover' && stop ? (
            <HandoverPanel collectIqd={stop.collectIqd} tenderIqd={stop.tenderIqd ?? null} busy={tapping} onConfirm={(uri, cash) => void handover(uri, cash)} onClose={() => setPanel('none')} />
          ) : showUnreachable && job.unreachable ? (
            <UnreachablePanel status={job.unreachable} busy={actions.fail.isPending} onFail={() => void endUnreachable()} onResponded={() => setDismissedUnreachable(true)} />
          ) : stop && action ? (
            <>
              {queued ? <QueuedStrip sending={sending} text="partner.queued" /> : null}
              <ProgressRail stage={stage} ride={ride} />
              <View style={{ gap: 2 }}>
                {multi ? (
                  <Text variant="caption" color="textMuted" tabular>
                    {t('partner.job_step', { n: progress.n, total: progress.total })}
                  </Text>
                ) : null}
                <Text variant="heading" testID="job-task">
                  {t(action.title)}
                </Text>
              </View>

              <PlaceHeadline
                icon={stop.type === 'dropoff' ? 'home' : ride ? 'user' : 'bag'}
                ink={stop.type === 'dropoff'}
                title={place}
                quote={hint?.note ?? null}
                near={hint?.landmark ? t('partner.slip_near', { place: hint.landmark }) : null}
                zone={zoneName(stop.zoneId, locale, t)}
                aside={stop.type === 'dropoff' && stop.collectIqd > 0 ? <StatusPill label={t('partner.job_collect_here', { amount: amountParam(stop.collectIqd) })} tone="warning" icon="wallet" size="sm" /> : null}
              />

              {ride && stop.type === 'pickup' && stop.state === 'arrived' ? <RiderWait arrivedAt={stop.arrivedAt} /> : null}
              {/* j5: the code the kitchen matches before handing over the food (maps program r4). */}
              {stop.type === 'pickup' && stop.pickupCode ? <PickupCode code={stop.pickupCode} place={place} /> : null}
              {/* j6: the kitchen's time, live, until he has the food. */}
              {stop.type === 'pickup' && !ride && job.merchant ? <ReadyBar prep={job.merchant} /> : null}

              {/* f3: a gift and the customer's wallet top-up are one ink card (the top-up confirms with a slide). */}
              <DoorExtras gift={giftNote(stop)} topUp={topUp} />
              <JobNotes job={job} stop={stop} ride={ride} />

              {/* Maps program r7: the kitchen's photos and note of where to collect, until he has the food. */}
              {stop.type === 'pickup' && stop.pickupSpot ? <PickupSpotCard spot={stop.pickupSpot} /> : null}

              {/* Maps program f6, a5: the saved place's door photos (its words and landmark lead the headline). */}
              {stop.type === 'dropoff' && stop.door ? (
                <DoorCard
                  door={stop.door}
                  arrived={stop.state === 'arrived'}
                  onCall={() => (CALLS_LIVE ? void customerCall.call() : customerThread ? openChat('customer_courier') : callSoon())}
                  callsLive={CALLS_LIVE}
                  stopId={stop.stopId}
                  omitNote={hint?.noteFromPlace ?? false}
                  omitLandmark={Boolean(hint?.landmark)}
                />
              ) : null}

              {multi ? <StopList job={job} ride={ride} saved={saved} /> : null}

              <View style={{ gap: theme.space[2], borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.space[4] }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text variant="label" color="textMuted">
                    {t('partner.job_pay_title')}
                  </Text>
                  <Text variant="title" tabular>
                    {`${amountParam(job.pay.totalIqd)} ${t('quote.currency')}`}
                  </Text>
                </View>
                <PayLines pay={job.pay} testID="job-pay" />
              </View>
            </>
          ) : null}
        </ScrollView>

        {panel === 'none' && !showUnreachable && action ? (
          <SafeAreaView edges={['bottom']} style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
            <View style={[column, { paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: theme.space[4], gap: theme.space[3] }]}>
              {/* j4 / b4: the four actions sit right over the main button, never under it. */}
              <JobActions
                items={[
                  /* c9: on a ride booked for someone else the call goes to the rider, and says so. */
                  { key: 'call', icon: 'phone', label: ride && stop?.rider ? t('partner.call_rider') : t('partner.call'), onPress: call, disabled: !orderId, soon: CALLS_LIVE ? undefined : t('soon.badge'), testID: 'job-call' },
                  { key: 'chat', icon: 'chat', label: t('partner.message'), badge: unread, onPress: () => openChat(chatKind), disabled: !chatThread, testID: 'job-chat' },
                  { key: 'maps', icon: 'location-arrow', label: t('partner.open_maps'), onPress: openMaps, disabled: !stop?.pin, testID: 'job-maps' },
                  { key: 'problem', icon: 'flag', label: t('partner.act_problem'), onPress: () => setProblem(true), testID: 'job-problem' },
                ]}
              />
              {/* b5: the kitchen hasn't finished — said above the slide, not hidden inside it. */}
              {notReady && action.kind === 'complete' ? <SlipNote testID="job-not-ready" icon="clock" title={t('partner.slide_kitchen_preparing')} bg={theme.colors.warningTint} ink={theme.colors.warningText} /> : null}
              {lit ? (
                <Text testID="job-arrive-near" variant="label" weight={700} color="accentText" align="center" accessibilityLiveRegion="polite">
                  {t('partner.arrive_near')}
                </Text>
              ) : null}
              {/* j7: slides only where money moves (picked up, rider in, ride ended); «وصلت» stays a tap. */}
              {action.kind === 'complete' && !(stop?.type === 'dropoff' && !ride) ? (
                <SlideToConfirm testID="job-action" label={t(action.label)} loading={busy} confirmHaptic="medium" onConfirm={() => void advance()} />
              ) : (
                <Button
                  testID="job-action"
                  label={t(action.label)}
                  size="lg"
                  variant={action.kind === 'arrive' && !lit ? 'ink' : 'primary'}
                  fullWidth
                  icon={action.kind === 'arrive' ? 'map-pin' : 'check'}
                  loading={busy}
                  haptic="medium"
                  onPress={() => void advance()}
                />
              )}
            </View>
          </SafeAreaView>
        ) : null}
      </View>
    </View>
  );
}

/** j10: steps already said on this phone (one prompt per step, even when the screen reopens). */
const SPOKEN = new Set<string>();

/**
 * The one-line notes on a job (partner redesign r7, r8): a gift, the change to bring, the rider booked
 * for, the night code, what the rider carries — drawn like the order slip's notes.
 */
function JobNotes({ job, stop, ride }: { job: PartnerJob; stop: PartnerJobStop; ride: boolean }) {
  const theme = useTheme();
  const t = useT();
  const tender = stop.type === 'dropoff' && stop.collectIqd > 0 ? tenderLine(stop.collectIqd, stop.tenderIqd ?? null) : null;
  const cargo = cargoLine(job.rideCargo ?? [], t);
  const accent = { bg: theme.colors.accentTint, ink: theme.colors.accentText };
  return (
    <>
      {/* "الخردة علينا": the note the customer said at checkout and the change to bring. */}
      {tender ? (
        <SlipNote
          testID="job-tender"
          icon="cash"
          title={tender.changeIqd > 0 ? t('cashchange.job_tender', { tender: amountParam(tender.tenderIqd), change: amountParam(tender.changeIqd) }) : t('cashchange.job_tender_exact')}
          {...accent}
        />
      ) : null}
      {/* SEC-14: whom he hands it to when someone else receives the order (a logged vault read). */}
      {stop.type === 'dropoff' && stop.recipient ? (
        <SlipNote testID="job-recipient" icon="user" title={t('partner.job_recipient', { name: stop.recipient.name })} bg={theme.colors.surfaceSunken} ink={theme.colors.text} />
      ) : null}
      {ride && stop.type === 'pickup' && stop.rider ? (
        <SlipNote testID="job-rider" icon="user" title={t('partner.offer_for_rider_title', { name: stop.rider.name })} body={t('partner.offer_for_rider_body')} bg={theme.colors.surfaceSunken} ink={theme.colors.text} />
      ) : null}
      {/* s1: a night ride starts with the rider's code (asked on the slide); never shown here. */}
      {needsStartCode(stop, ride) ? <SlipNote testID="job-start-code-needed" icon="lock" title={t('partner.start_code_needed')} {...accent} /> : null}
      {/* r8 (ride idea x5): what the rider carries, until the ride ends. */}
      {cargo ? <SlipNote testID="job-cargo" icon="bag" title={cargo} {...accent} /> : null}
    </>
  );
}

function placeTitle(s: PartnerJobStop, ride: boolean, t: TFn, locale: 'ar-IQ' | 'en'): string {
  if (s.type === 'dropoff') return ride ? zoneName(s.zoneId, locale, t) : t('partner.offer_customer');
  return s.label ?? (ride ? (s.rider?.name ?? t('partner.offer_rider')) : zoneName(s.zoneId, locale, t));
}

/**
 * Partner redesign f3: what is special about this door, on one ink card — «عزيمة» (joy g1: «هدية · لا
 * تذكر السعر» at the door, the receipt out of the bag at the kitchen) and «الزبون يريد يشحن محفظته»,
 * which opens the top-up desk (code → amount → slide to confirm; it counts on his cash cap).
 */
function DoorExtras({ gift, topUp }: { gift: GiftNote | null; topUp: boolean }) {
  const theme = useTheme();
  const t = useT();
  if (!gift && !topUp) return null;
  // By day a dark ink card; at night (n2) a raised brown card instead of a cream block that glares.
  const night = theme.scheme === 'dark';
  const cream = night ? theme.colors.text : theme.colors.bg;
  const soft = withAlpha(cream, 0.7);
  return (
    <View testID="job-extras" style={{ backgroundColor: night ? theme.colors.surface : theme.colors.text, borderRadius: theme.radius.xl, overflow: 'hidden', ...(night ? { borderWidth: 1.5, borderColor: theme.colors.border } : {}) }}>
      {gift ? (
        <View testID="job-gift" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4] }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="gift" size={20} color={theme.colors.onAccent} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight={700} color={cream}>
              {t(gift.key)}
            </Text>
            {gift.hint ? (
              <Text variant="caption" color={soft}>
                {t(gift.hint)}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
      {gift && topUp ? <View style={{ height: 1, marginHorizontal: theme.space[4], backgroundColor: withAlpha(cream, 0.14) }} /> : null}
      {topUp ? (
        <Pressable
          testID="job-topup-entry"
          accessibilityRole="button"
          onPress={() => router.push('/job-topup')}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], minHeight: 64, backgroundColor: pressed ? withAlpha(cream, 0.08) : 'transparent' })}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: withAlpha(cream, 0.12), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="wallet" size={20} color={cream} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight={700} color={cream}>
              {t('partner.job_topup_entry')}
            </Text>
            <Text variant="caption" color={soft}>
              {t('partner.job_topup_entry_sub')}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color={soft} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The run in order: done stops ticked, the current one highlighted. */
function StopList({ job, ride, saved }: { job: PartnerJob; ride: boolean; saved: ReadonlySet<string> }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  return (
    <View testID="job-stops" style={{ gap: theme.space[2] }}>
      <Text variant="label" color="textMuted">
        {t('partner.stops_title')}
      </Text>
      {job.stops.map((s, i) => {
        const doneStop = s.state === 'completed' || s.state === 'skipped';
        const current = s.stopId === job.currentStopId;
        const title = s.type === 'dropoff' ? (ride ? zoneName(s.zoneId, locale, t) : t('partner.stop_dropoff')) : t('partner.stop_pickup', { name: placeTitle(s, ride, t, locale) });
        return (
          <View key={s.stopId} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], opacity: doneStop ? 0.6 : 1 }}>
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: doneStop ? theme.colors.success : current ? theme.colors.accent : theme.colors.surfaceSunken,
              }}
            >
              {doneStop ? (
                <Icon name="check" size={14} color="surface" strokeWidth={3} />
              ) : (
                <Text variant="caption" weight={700} color={current ? 'onAccent' : 'textMuted'} tabular>
                  {String(i + 1)}
                </Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label" weight={current ? 600 : 500}>
                {title}
              </Text>
              <Text variant="caption" color="textMuted">
                {zoneName(s.zoneId, locale, t)}
              </Text>
            </View>
            {saved.has(s.stopId) ? (
              <Text variant="caption" weight={600} color="warningText" testID={`job-stop-saved-${s.stopId}`}>
                {t('partner.stop_saved')}
              </Text>
            ) : doneStop ? (
              <Text variant="caption" color="successText">
                {t('partner.stop_done')}
              </Text>
            ) : s.collectIqd > 0 ? (
              <Text variant="caption" weight={600} color="warningText" tabular>
                {`${amountParam(s.collectIqd)} ${t('quote.currency')}`}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** "محفوظ، يندز لما يرجع النت" (or "دنرسل الخطوات المحفوظة…" while replaying): taps this phone holds. */
function QueuedStrip({ sending, text }: { sending: boolean; text: 'partner.queued' | 'partner.done_queued' }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="job-queued"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: sending ? theme.colors.infoTint : theme.colors.warningTint, borderRadius: theme.radius.lg, padding: theme.space[3], margin: text === 'partner.done_queued' ? theme.space[5] : 0, marginBottom: 0 }}
    >
      <Icon name={sending ? 'refresh' : 'clock'} size={18} color={sending ? 'infoText' : 'warningText'} strokeWidth={2} />
      <Text variant="label" weight={600} color={sending ? 'infoText' : 'warningText'} style={{ flex: 1 }}>
        {sending ? t('partner.queue_sending') : t(text)}
      </Text>
    </View>
  );
}
