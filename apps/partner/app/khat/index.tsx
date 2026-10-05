import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import type { AbsenceReason, KhatRunTrip, KhatStopView } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Card, EmptyState, Icon, SegmentedControl, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SosControl } from '@/features/safety/SosControl';
import { SectionHead } from '@/features/intercity/BoardParts';
import { clockBare, dayPeriod } from '@/features/intercity/logic';
import { useNow } from '@/features/intercity/useNow';
import { PlaceCard, RunProgress, SubstituteCard } from '@/features/khat/KhatParts';
import { activeRunIndex, groupPlaces, runFinished, runStart } from '@/features/khat/logic';
import { useKhatActions, useSubstituteOffers, useTodayRun } from '@/features/khat/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { currentFix } from '@/lib/location';

/**
 * خطك اليوم — today's khat run: the stops in order, and at each stop the children by first name with
 * big "صعد" / "نزل" buttons (the guardian's "arrived" push fires on the school tap-out), absences
 * (reported by him, or already by the guardian), runs that need a substitute today, and the summary.
 */
export default function KhatRun() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const run = useTodayRun();
  const subs = useSubstituteOffers();
  const actions = useKhatActions();
  const now = useNow(1_000);
  // khat.todayRun lists runs still in progress; the run he just finished is kept from the last tap's
  // answer so the summary stays on screen instead of an empty day.
  const [finishedRun, setFinishedRun] = useState<KhatRunTrip | null>(null);
  const trips = useMemo(() => {
    const live = run.data?.trips ?? [];
    return finishedRun && !live.some((x) => x.tripId === finishedRun.tripId) ? [...live, finishedRun] : live;
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

  return (
    <Screen testID="khat-run" edges={['bottom']} refreshControl={<RefreshControl refreshing={run.isRefetching} onRefresh={() => void Promise.all([run.refetch(), subs.refetch()])} />}>
      <Stack.Screen options={{ title: t('partner.khat_card_title'), headerRight: trip && !finished ? () => <SosControl subject={{ kind: 'trip', id: trip.tripId }} style={{ marginEnd: theme.space[3] }} /> : undefined }} />

      {offers.length > 0 ? (
        <View style={{ gap: theme.space[3] }}>
          <SectionHead title={t('partner.kh_subs_title')} />
          {offers.map((o) => (
            <SubstituteCard key={o.offerId} offer={o} secondsLeft={o.expiresInSec - (now.getTime() - fetchedAt) / 1000} busy={actions.acceptSubstitute.isPending} onAccept={() => void accept(o.offerId)} />
          ))}
        </View>
      ) : null}

      {!run.data ? (
        <View style={{ gap: theme.space[4] }}>
          <Skeleton height={90} radius={20} />
          <Skeleton height={180} radius={20} />
          <Skeleton height={180} radius={20} />
        </View>
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
            <RunProgress trip={trip} />
          </Card>

          {finished ? (
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
              />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
