import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, View, type ScrollView } from 'react-native';
import type { AbsenceReason, KhatRunTrip, KhatStopView } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Card, EmptyState, Icon, SegmentedControl, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SosControl } from '@/features/safety/SosControl';
import { SectionHead } from '@/features/intercity/BoardParts';
import { clockBare, clockLabel, dayPeriod } from '@/features/intercity/logic';
import { useNow } from '@/features/intercity/useNow';
import { useRunCall } from '@/features/intercity/useRunCall';
import { PlaceCard, RunProgress, SubstituteCard, SweepCard } from '@/features/khat/KhatParts';
import { activeRunIndex, groupPlaces, needsSweep, nextStopAt, runFinished, runStart, runUnderway } from '@/features/khat/logic';
import { useKhatActions, useSubstituteOffers, useTodayRun } from '@/features/khat/queries';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { currentFix } from '@/lib/location';

/**
 * خطك اليوم — today's khat run, child-safe (partner audit S-6): the next stop's time and big chips
 * "بالسيارة 2 · وصلوا 0 من 5 · غايب 1"; at each stop the children by first name with a guardian call
 * and a 56 px "صعد" / "نزل" (the guardian's "arrived" message fires on the school tap-out); absences
 * until a child boards. Substitute offers stay out of sight while a run is under way. The run ends
 * with a two-step sweep ("تأكد ما بقى طفل بالسيارة" → slide "تأكدت، السيارة فاضية"), logged for ops.
 */
export default function KhatRun() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const run = useTodayRun();
  const subs = useSubstituteOffers();
  const actions = useKhatActions();
  const caller = useRunCall();
  const now = useNow(1_000);
  // The run he just finished is kept from the last answer so the sweep and the summary stay on
  // screen even if today's list moves on.
  const [finishedRun, setFinishedRun] = useState<KhatRunTrip | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const trips = useMemo(() => {
    const live = run.data?.trips ?? [];
    if (!finishedRun) return live;
    const fresh = live.find((x) => x.tripId === finishedRun.tripId);
    if (!fresh) return [...live, finishedRun];
    // Keep the newer of the two answers (the sweep's own answer may land before the poll).
    return live.map((x) => (x.tripId === finishedRun.tripId && finishedRun.emptyCarCheckedAt && !x.emptyCarCheckedAt ? finishedRun : x));
  }, [run.data, finishedRun]);
  const [tab, setTab] = useState<string | null>(null);
  const [busyStop, setBusyStop] = useState<string | null>(null);
  const [absenceFor, setAbsenceFor] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());

  useEffect(() => {
    if (subs.dataUpdatedAt) setFetchedAt(subs.dataUpdatedAt);
  }, [subs.dataUpdatedAt]);

  useEffect(() => {
    if (tab && trips.some((x) => x.tripId === tab)) return;
    if (trips.length > 0) setTab(trips[activeRunIndex(trips)]!.tripId);
  }, [trips, tab]);

  const trip = trips.find((x) => x.tripId === tab) ?? null;
  const places = useMemo(() => (trip ? groupPlaces(trip) : []), [trip]);
  const offers = (subs.data ?? []).filter((o) => o.expiresInSec - (now.getTime() - fetchedAt) / 1000 > 0);
  // He is driving children: no offer cards (with their timers) until every run is swept (audit P-15).
  const underway = trips.some(runUnderway);

  const fail = (err: unknown) => {
    theme.haptic('error');
    toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
  };

  const tap = async (trip: KhatRunTrip, stop: KhatStopView) => {
    if (busyStop) return;
    setBusyStop(stop.stopId);
    try {
      const fix = await currentFix(1500);
      const input = { tripId: trip.tripId, stopId: stop.stopId, occurredAt: new Date(), idempotencyKey: `khat:${stop.stopId}:${stop.type}`, ...(fix ? { pin: fix } : {}) };
      const after = stop.type === 'pickup' ? await actions.tapIn.mutateAsync(input) : await actions.tapOut.mutateAsync(input);
      if (runFinished(after)) setFinishedRun(after);
      theme.haptic('success');
      const name = stop.child?.firstName ?? '';
      toast.show({ message: stop.type === 'pickup' ? t('partner.kh_tap_in_toast', { name }) : t('partner.kh_tap_out_toast', { name }), tone: 'success' });
    } catch (err) {
      fail(err);
    } finally {
      setBusyStop(null);
    }
  };

  const reportAbsence = async (trip: KhatRunTrip, childRef: string, reason: AbsenceReason) => {
    const name = trip.stops.find((s) => s.child?.childRef === childRef)?.child?.firstName ?? '';
    try {
      await actions.reportAbsence.mutateAsync({ tripId: trip.tripId, childRef, reason });
      setAbsenceFor(null);
      toast.show({ message: t('partner.khat_rider_absent', { name }), tone: 'neutral' });
    } catch (err) {
      fail(err);
    }
  };

  const callGuardian = (trip: KhatRunTrip, stop: KhatStopView) => {
    const child = stop.child;
    if (!child) return;
    void caller.call(child.childRef, t('partner.kh2_guardian_of', { name: child.firstName }), () => client.khat.callGuardian.mutate({ tripId: trip.tripId, childRef: child.childRef }));
  };

  const confirmEmpty = async (trip: KhatRunTrip) => {
    try {
      const after = await actions.confirmEmptyCar.mutateAsync({ tripId: trip.tripId });
      setFinishedRun(after);
      // The sweep card was far down the list; the run's summary and "خلص خط اليوم" are at the top.
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      theme.haptic('success');
      toast.show({ message: t('partner.kh2_sweep_saved'), tone: 'success', icon: 'check' });
    } catch (err) {
      fail(err);
    }
  };

  const accept = async (offerId: string) => {
    try {
      const res = await actions.acceptSubstitute.mutateAsync({ offerId });
      if (res.outcome === 'assigned') {
        theme.haptic('success');
        toast.show({ message: t('partner.kh_sub_accepted'), tone: 'success' });
        setTab(res.tripId);
      } else toast.show({ message: t('partner.kh_sub_lost'), tone: 'warning' });
    } catch (err) {
      fail(err);
    }
  };

  const finished = trip ? runFinished(trip) : false;
  const sweep = trip ? needsSweep(trip) : false;

  return (
    <Screen testID="khat-run" edges={['bottom']} scrollRef={scrollRef} refreshControl={<RefreshControl refreshing={run.isRefetching} onRefresh={() => void Promise.all([run.refetch(), subs.refetch()])} />}>
      <Stack.Screen options={{ title: t('partner.khat_card_title'), headerRight: trip && !finished ? () => <SosControl subject={{ kind: 'trip', id: trip.tripId }} style={{ marginEnd: theme.space[3] }} /> : undefined }} />

      {offers.length > 0 && !underway ? (
        <View style={{ gap: theme.space[3] }}>
          <SectionHead title={t('partner.kh_subs_title')} />
          {offers.map((o) => (
            <SubstituteCard key={o.offerId} offer={o} secondsLeft={o.expiresInSec - (now.getTime() - fetchedAt) / 1000} busy={actions.acceptSubstitute.isPending} onAccept={() => void accept(o.offerId)} />
          ))}
        </View>
      ) : null}

      {!run.data ? (
        run.isError ? (
          <EmptyState icon="seat" title={t('error.network')} action={{ label: t('action.retry'), onPress: () => void run.refetch() }} />
        ) : (
          <View style={{ gap: theme.space[4] }}>
            <Skeleton height={150} radius={20} />
            <Skeleton height={180} radius={20} />
            <Skeleton height={180} radius={20} />
          </View>
        )
      ) : trips.length === 0 || !trip ? (
        <EmptyState icon="seat" title={t('partner.kh_empty_title')} body={t('partner.kh_empty_body')} />
      ) : (
        <>
          {trips.length > 1 ? (
            <SegmentedControl
              options={trips.map((x, i) => {
                const start = runStart(x);
                return { value: x.tripId, label: start ? `${t('partner.kh_run_period', { period: t(`partner.ic_period_${dayPeriod(start)}` as MessageKey) })} · ${clockBare(start)}` : String(i + 1) };
              })}
              value={trip.tripId}
              onChange={(v) => {
                setTab(v);
                setAbsenceFor(null);
              }}
            />
          ) : null}

          <Card padding={5}>
            <RunProgress trip={trip} nextAt={finished ? null : nextStopAt(places)} now={now.getTime()} />
          </Card>

          {offers.length > 0 && underway ? (
            <View testID="khat-subs-later" style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center', paddingHorizontal: theme.space[1] }}>
              <Icon name="bell" size={16} color="textMuted" />
              <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                {t('partner.kh2_subs_later')}
              </Text>
            </View>
          ) : null}

          {sweep ? (
            <SweepCard onConfirm={() => void confirmEmpty(trip)} busy={actions.confirmEmptyCar.isPending} />
          ) : finished ? (
            <Card testID="khat-done" padding={5} tone="tint">
              <View style={{ alignItems: 'center', gap: theme.space[2] }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.success }}>
                  <Icon name="check" size={28} color="surface" strokeWidth={2.8} />
                </View>
                <Text variant="heading" align="center">
                  {t('partner.kh_done_title')}
                </Text>
                <Text variant="body" color="textMuted" align="center" tabular>
                  {t('partner.kh_done_body', { delivered: trip.delivered, absent: trip.absent })}
                </Text>
                {trip.emptyCarCheckedAt ? (
                  <Text testID="khat-swept" variant="label" weight={600} color="successText" align="center" tabular>
                    {t('partner.kh2_swept_at', { time: clockLabel(trip.emptyCarCheckedAt) })}
                  </Text>
                ) : null}
                <Button label={t('partner.kh_done_back')} variant="secondary" onPress={() => router.replace('/')} style={{ marginTop: theme.space[2] }} />
              </View>
            </Card>
          ) : (
            <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start', paddingHorizontal: theme.space[1] }}>
              <Icon name="bell" size={16} color="textMuted" style={{ marginTop: 3 }} />
              <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                {t('partner.kh_guardian_note')}
              </Text>
            </View>
          )}

          <View style={{ gap: theme.space[3] }}>
            {places.map((p, i) => (
              <PlaceCard
                key={p.key}
                place={p}
                index={i}
                trip={trip}
                busyStopId={busyStop}
                absenceFor={absenceFor}
                onTap={(s) => void tap(trip, s)}
                onAskAbsence={setAbsenceFor}
                onAbsence={(ref, reason) => void reportAbsence(trip, ref, reason)}
                onCancelAbsence={() => setAbsenceFor(null)}
                onCallGuardian={finished && !sweep ? null : (s) => callGuardian(trip, s)}
                callingRef={caller.busyKey}
              />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
