import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PartnerJob, PartnerJobStop } from '@driver/contracts';
import { Badge, Button, Icon, IconButton, Skeleton, StatusPill, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { threadOf } from '@/features/chat/logic';
import { useChatThreads } from '@/features/chat/queries';
import { useMaskedCall } from '@/features/chat/useMaskedCall';
import { DriverMap, type MapPin } from '@/features/map/DriverMap';
import { DonePanel, HandoverPanel, UnreachablePanel } from '@/features/work/JobPanels';
import { isRide, jobAction, KIND_KEY, mapsUrl, taskProgress, VEHICLE_ICON, zoneName } from '@/features/work/logic';
import { PayLines, PrepPill } from '@/features/work/OfferParts';
import { useActiveJob, useRefreshWork, useStatus, useTripActions } from '@/features/work/queries';
import { bestFix } from '@/features/work/usePresence';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT, type TFn } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * On a job: one task at a time with a single advancing button (وصلت للمطعم → استلمت → وصلت للزبون →
 * سلّمت), the stop list, quick contact, open-in-maps, the handover photo + cash confirm at the door,
 * and the unreachable-customer protocol. Everything writes through `trips.*`.
 */
export default function JobScreen() {
  const theme = useTheme();
  const job = useActiveJob();
  const status = useStatus();
  const [done, setDone] = useState<{ earnedIqd: number; failed: boolean } | null>(null);
  const goHome = () => router.replace('/');

  if (done) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <View style={{ flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}>
          <DonePanel earnedIqd={done.earnedIqd} failed={done.failed} onHome={goHome} />
        </View>
      </SafeAreaView>
    );
  }
  if (!job.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg, padding: theme.space[5], gap: theme.space[4] }}>
        {job.isFetched ? <DonePanel earnedIqd={0} failed onHome={goHome} /> : <Skeleton lines={4} />}
      </SafeAreaView>
    );
  }
  return <JobView job={job.data} self={status.data?.position ?? null} vehicle={status.data?.vehicleClass ?? 'bike'} onDone={setDone} />;
}

function JobView({ job, self, vehicle, onDone }: { job: PartnerJob; self: { lat: number; lng: number } | null; vehicle: keyof typeof VEHICLE_ICON; onDone: (d: { earnedIqd: number; failed: boolean }) => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const actions = useTripActions();
  const refresh = useRefreshWork();
  const [panel, setPanel] = useState<'none' | 'handover'>('none');
  const [dismissedUnreachable, setDismissedUnreachable] = useState(false);
  const ride = isRide(job.vertical);
  const stop = job.stops.find((s) => s.stopId === job.currentStopId) ?? null;
  const action = stop ? jobAction(stop, job.vertical) : null;
  const progress = taskProgress(job);
  const busy = actions.arrive.isPending || actions.complete.isPending || actions.unreachable.isPending || actions.fail.isPending;
  const showUnreachable = !!job.unreachable && !dismissedUnreachable && stop?.type === 'dropoff';

  const pins = useMemo<MapPin[]>(
    () =>
      job.stops
        .filter((s) => s.pin && s.state !== 'completed' && s.state !== 'skipped')
        .map((s) => ({ at: s.pin!, kind: s.type === 'dropoff' ? 'dropoff' : 'pickup', label: placeTitle(s, ride, t, locale) })),
    [job.stops, ride, t, locale],
  );

  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });

  const advance = async () => {
    if (!stop || !action || busy) return;
    if (action.kind === 'complete' && stop.type === 'dropoff' && !ride) {
      setPanel('handover');
      return;
    }
    try {
      if (action.kind === 'arrive') {
        const trip = await actions.arrive.mutateAsync({ tripId: job.tripId, stopId: stop.stopId, pin: await bestFix(undefined), occurredAt: new Date() });
        const s = trip.stops.find((x) => x.id === stop.stopId);
        if (s?.arrivedOutsideGeofence) toast.show({ message: t('partner.arrived_outside'), tone: 'warning' });
      } else {
        const trip = await actions.complete.mutateAsync({ tripId: job.tripId, stopId: stop.stopId, handover: {}, occurredAt: new Date() });
        if (trip.state === 'completed') onDone({ earnedIqd: job.pay.totalIqd, failed: false });
      }
      theme.haptic('success');
      await refresh();
    } catch (err) {
      fail(err);
    }
  };

  const handover = async (photoUri: string | null) => {
    if (!stop) return;
    try {
      const trip = await actions.complete.mutateAsync({
        tripId: job.tripId,
        stopId: stop.stopId,
        handover: { ...(stop.collectIqd > 0 ? { cashCollectedIqd: stop.collectIqd } : {}), ...(photoUri ? { note: 'handover_photo_on_device' } : {}), recipientConfirmed: true },
        occurredAt: new Date(),
      });
      setPanel('none');
      await refresh();
      if (trip.state === 'completed') onDone({ earnedIqd: job.pay.totalIqd, failed: false });
    } catch (err) {
      fail(err);
    }
  };

  const startUnreachable = async () => {
    if (!stop) return;
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
  const atKitchen = !ride && stop?.type === 'pickup' && Boolean(kitchenThread);
  const customerCall = useMaskedCall(orderId, 'customer_courier', ride);
  const kitchenCall = useMaskedCall(orderId, 'merchant_courier', ride);
  const call = () => void (atKitchen ? kitchenCall.call() : customerCall.call());
  const openChat = (kind: 'customer_courier' | 'merchant_courier') => router.push({ pathname: '/chat/[orderId]', params: { orderId, kind } });
  const openMaps = () => {
    if (stop?.pin) void Linking.openURL(mapsUrl(stop.pin)).catch(() => undefined);
  };
  const column = { width: '100%' as const, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' as const };

  return (
    <View testID="job" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ height: '38%' }}>
        <DriverMap self={self} vehicleIcon={VEHICLE_ICON[vehicle]} online pins={pins} route={self ? [self, ...pins.map((p) => p.at)] : pins.map((p) => p.at)} topInset={92} bottomInset={64} maxZoom={15.4} testID="job-map" />
        <SafeAreaView edges={['top']} pointerEvents="box-none" style={{ position: 'absolute', top: 0, start: 0, end: 0 }}>
          <View style={[column, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }]}>
            <IconButton icon="chevron-back" variant="outline" accessibilityLabel={t('action.back')} onPress={() => router.navigate('/')} />
            <StatusPill label={t(KIND_KEY[job.vertical])} tone="neutral" icon={ride ? VEHICLE_ICON[vehicle] : 'bag'} />
            <IconButton icon="sos" variant="outline" accessibilityLabel="SOS" onPress={() => toast.show({ message: t('partner.stub_toast'), tone: 'info' })} />
          </View>
        </SafeAreaView>
      </View>

      <View style={{ flex: 1, marginTop: -24, backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius['2xl'], borderTopRightRadius: theme.radius['2xl'] }}>
        <ScrollView contentContainerStyle={[column, { padding: theme.space[5], gap: theme.space[4] }]}>
          {panel === 'handover' && stop ? (
            <HandoverPanel collectIqd={stop.collectIqd} busy={actions.complete.isPending} onConfirm={(uri) => void handover(uri)} onClose={() => setPanel('none')} />
          ) : showUnreachable && job.unreachable ? (
            <UnreachablePanel status={job.unreachable} busy={actions.fail.isPending} onFail={() => void endUnreachable()} onResponded={() => setDismissedUnreachable(true)} />
          ) : stop && action ? (
            <>
              <View style={{ gap: 2 }}>
                <Text variant="caption" color="textMuted" tabular>
                  {t('partner.job_step', { n: progress.n, total: progress.total })}
                </Text>
                <Text variant="heading" testID="job-task">
                  {t(action.title)}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: stop.type === 'dropoff' ? theme.colors.text : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={stop.type === 'dropoff' ? 'home' : ride ? 'user' : 'bag'} size={24} color={stop.type === 'dropoff' ? 'surface' : 'text'} strokeWidth={2} />
                </View>
                <View style={{ flex: 1, gap: 0 }}>
                  <Text variant="title" numberOfLines={1}>
                    {placeTitle(stop, ride, t, locale)}
                  </Text>
                  <Text variant="label" color="textMuted">
                    {zoneName(stop.zoneId, locale, t)}
                  </Text>
                </View>
                {stop.type === 'pickup' && job.merchant ? <PrepPill prep={job.merchant} /> : null}
                {stop.type === 'dropoff' && stop.collectIqd > 0 ? <StatusPill label={t('partner.job_collect_here', { amount: amountParam(stop.collectIqd) })} tone="warning" icon="wallet" size="sm" /> : null}
              </View>

              {stop.type === 'pickup' && stop.state === 'arrived' && job.merchant?.state === 'preparing' ? (
                <View testID="job-wait-ready" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
                  <Icon name="clock" size={18} color="warningText" />
                  <Text variant="label" color="warningText" style={{ flex: 1 }}>
                    {t('partner.job_wait_ready')}
                  </Text>
                </View>
              ) : null}

              {stop.note ? (
                <View style={{ backgroundColor: theme.colors.infoTint, borderRadius: theme.radius.lg, padding: theme.space[3], gap: 2 }}>
                  <Text variant="caption" weight={600} color="infoText">
                    {t('partner.note_title')}
                  </Text>
                  <Text variant="label">{stop.note}</Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
                <QuickAction icon="phone" label={t('partner.call')} onPress={call} disabled={!orderId} testID="job-call" />
                <QuickAction icon="chat" label={ride ? t('partner.message') : t('chat.role.customer')} badge={customerThread?.unread ?? 0} onPress={() => openChat('customer_courier')} disabled={!customerThread} testID="job-chat" />
                {kitchenThread ? <QuickAction icon="bag" label={t('partner.message_merchant')} badge={kitchenThread.unread} onPress={() => openChat('merchant_courier')} testID="job-chat-merchant" /> : null}
                <QuickAction icon="map-pin" label={t('partner.open_maps')} onPress={openMaps} testID="job-maps" />
              </View>

              <StopList job={job} ride={ride} />

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

              {stop.type === 'dropoff' && stop.state === 'arrived' && !ride ? (
                <Button testID="job-unreachable" label={t('partner.job_unreachable_cta')} variant="ghost" icon="clock" fullWidth onPress={() => void startUnreachable()} disabled={busy} />
              ) : null}
            </>
          ) : null}
        </ScrollView>

        {panel === 'none' && !showUnreachable && action ? (
          <SafeAreaView edges={['bottom']} style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
            <View style={[column, { padding: theme.space[4] }]}>
              <Button testID="job-action" label={t(action.label)} size="lg" fullWidth icon={action.kind === 'arrive' ? 'map-pin' : 'check'} loading={busy} haptic="medium" onPress={() => void advance()} />
            </View>
          </SafeAreaView>
        ) : null}
      </View>
    </View>
  );
}

function placeTitle(s: PartnerJobStop, ride: boolean, t: TFn, locale: 'ar-IQ' | 'en'): string {
  if (s.type === 'dropoff') return ride ? zoneName(s.zoneId, locale, t) : t('partner.offer_customer');
  return s.label ?? (ride ? t('partner.offer_rider') : zoneName(s.zoneId, locale, t));
}

function QuickAction({ icon, label, onPress, testID, badge = 0, disabled }: { icon: IconName; label: string; onPress: () => void; testID: string; badge?: number; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${label} · ${badge}` : label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken, opacity: disabled ? 0.5 : 1 }}
    >
      <View>
        <Icon name={icon} size={22} color="text" strokeWidth={2} />
        {badge > 0 ? <Badge count={badge} style={{ position: 'absolute', top: -8, end: -14 }} /> : null}
      </View>
      <Text variant="caption" weight={600}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The run in order: done stops ticked, the current one highlighted. */
function StopList({ job, ride }: { job: PartnerJob; ride: boolean }) {
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
            {doneStop ? (
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
