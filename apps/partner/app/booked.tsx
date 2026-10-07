import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { PartnerBookedAnswer, PartnerBookedJob } from '@driver/contracts';
import { formatHourPart, formatWhen } from '@driver/i18n';
import { Button, Card, EmptyState, Icon, ModalSheet, RetryState, retryKindFor, Skeleton, StatusPill, Text, useLoadTimeout, useNetwork, useNow, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { canStart, stillOpen } from '@/features/work/booked-logic';
import { KIND_KEY, km, VEHICLE_ICON, zoneName } from '@/features/work/logic';
import { MetaChip, RouteNodes } from '@/features/work/OfferParts';
import { useAnswerBookedJob, useBookedJobs, useStatus } from '@/features/work/queries';
import { apiErrorMessage } from '@/lib/api-links';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * «مشاوير باچر» (edge-case review #28): rides booked for later. His own first — the time, from and to
 * (zones only), his pay; «طالع هسة» from an hour before, «ما أگدر أجي» to drop it — then the ones
 * waiting for a driver that fit his vehicle, with «أحجزه» / «مو إلي» and the time to answer by. The
 * rider's own driver sees «الزبون طلبك إنت». Never a door or a name: what an offer shows.
 */
export default function BookedJobsScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const toast = useToast();
  const status = useStatus();
  const q = useBookedJobs(true);
  const answer = useAnswerBookedJob();
  const now = new Date(useNow(true, 30_000));
  const [releasing, setReleasing] = useState<PartnerBookedJob | null>(null);
  const [slow, restartSlow] = useLoadTimeout(!q.data && !q.isError);
  const data = q.data;
  const open = (data?.open ?? []).filter((j) => stillOpen(j, now));

  const send = async (job: PartnerBookedJob, a: PartnerBookedAnswer) => {
    try {
      await answer.mutateAsync({ tripId: job.tripId, answer: a });
      if (a === 'confirm') toast.show({ message: t('partner.booked_confirmed_toast', { time: formatWhen(job.startFrom, new Date(), { locale }) }), tone: 'success', icon: 'check' });
      if (a === 'pass') toast.show({ message: t('partner.booked_passed_toast'), tone: 'neutral' });
      if (a === 'release') toast.show({ message: t('partner.booked_released_toast'), tone: 'neutral' });
      if (a === 'start') {
        toast.show({ message: t('partner.booked_started_toast'), tone: 'success', icon: 'check' });
        router.replace('/job');
      }
    } catch (e) {
      toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen testID="booked-jobs" edges={['bottom']} contentStyle={{ gap: theme.space[4] }}>
      <Stack.Screen options={{ title: t('partner.booked_title') }} />
      {!data ? (
        q.isError || slow ? (
          <RetryState
            testID="booked-retry"
            kind={retryKindFor({ net, error: q.error, slow })}
            locale={locale}
            title={t('partner.booked_failed')}
            onRetry={() => {
              restartSlow();
              void q.refetch();
            }}
          />
        ) : (
          <View testID="booked-loading" style={{ gap: theme.space[3] }}>
            <Skeleton height={24} width="50%" />
            <Skeleton height={168} />
            <Skeleton height={168} />
          </View>
        )
      ) : (
        <>
          {net.state !== 'online' ? (
            <Banner icon="wifi-off" text={t('partner.net_offline_title')} tone="warning" testID="booked-offline" />
          ) : null}
          {!data.online && (status.data?.canDrive ?? true) ? <Banner icon="car" text={t('partner.booked_offline')} tone="info" testID="booked-go-online" /> : null}

          {data.mine.length === 0 && open.length === 0 ? (
            <View testID="booked-empty">
              <EmptyState icon="taxi" title={t('partner.booked_empty_title')} body={t('partner.booked_empty_body')} />
            </View>
          ) : null}

          {data.mine.length > 0 ? (
            <Section title={t('partner.booked_mine')} testID="booked-mine">
              {data.mine.map((job) => (
                <JobCard key={job.tripId} job={job} now={now} testID={`booked-mine-${job.tripId}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
                    <Icon name="clock" size={16} color="liveText" />
                    <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                      {canStart(job, now) ? t('partner.booked_show_by', { time: formatHourPart(job.showBy) }) : t('partner.booked_start_from', { time: formatWhen(job.startFrom, now, { locale }) })}
                    </Text>
                  </View>
                  {canStart(job, now) ? <Button testID="booked-start" label={t('partner.booked_start')} icon="location-arrow" fullWidth loading={answer.isPending} onPress={() => void send(job, 'start')} /> : null}
                  <Button testID="booked-release" variant="ghost" label={t('partner.booked_release')} disabled={answer.isPending} onPress={() => setReleasing(job)} />
                </JobCard>
              ))}
            </Section>
          ) : null}

          {open.length > 0 ? (
            <Section title={t('partner.booked_open')} testID="booked-open">
              {open.map((job) => (
                <JobCard key={job.tripId} job={job} now={now} testID={`booked-open-${job.tripId}`}>
                  <Text variant="footnote" color="textMuted" tabular>
                    {t('partner.booked_confirm_by', { time: formatHourPart(job.confirmBy) })}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                    <View style={{ flex: 1 }}>
                      <Button testID="booked-pass" variant="secondary" label={t('partner.booked_pass')} fullWidth disabled={answer.isPending || !data.online} onPress={() => void send(job, 'pass')} />
                    </View>
                    <View style={{ flex: 2 }}>
                      <Button testID="booked-confirm" label={t('partner.booked_confirm')} icon="check" fullWidth disabled={answer.isPending || !data.online} onPress={() => void send(job, 'confirm')} />
                    </View>
                  </View>
                </JobCard>
              ))}
            </Section>
          ) : null}
        </>
      )}

      <ModalSheet
        visible={releasing !== null}
        onClose={() => setReleasing(null)}
        title={t('partner.booked_release_title')}
        locked={answer.isPending}
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button
              testID="booked-release-yes"
              variant="destructive"
              label={t('partner.booked_release_yes')}
              fullWidth
              loading={answer.isPending}
              onPress={() => {
                const job = releasing;
                if (!job) return;
                void send(job, 'release').finally(() => setReleasing(null));
              }}
            />
            <Button variant="ghost" label={t('partner.booked_keep')} fullWidth disabled={answer.isPending} onPress={() => setReleasing(null)} />
          </View>
        }
      >
        <Text variant="body" color="textMuted">
          {t('partner.booked_release_body')}
        </Text>
      </ModalSheet>
    </Screen>
  );
}

function Section({ title, testID, children }: { title: string; testID: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ gap: theme.space[2] }}>
      <Text variant="title" style={{ paddingHorizontal: theme.space[1] }}>
        {title}
      </Text>
      <View style={{ gap: theme.space[3] }}>{children}</View>
    </View>
  );
}

function Banner({ icon, text, tone, testID }: { icon: 'wifi-off' | 'car'; text: string; tone: 'warning' | 'info'; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: tone === 'warning' ? theme.colors.warningTint : theme.colors.infoTint }}>
      <Icon name={icon} size={18} color={tone === 'warning' ? 'warningText' : 'infoText'} />
      <Text variant="label" color={tone === 'warning' ? 'warningText' : 'infoText'} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/** One booked ride: when, the vehicle, «الزبون طلبك إنت», his pay, from → to (zones), km and cash; then its actions. */
function JobCard({ job, now, testID, children }: { job: PartnerBookedJob; now: Date; testID: string; children: React.ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const vehicle = job.vertical === 'tuktuk' ? 'tuktuk' : 'car';
  return (
    <Card elevation={1} padding={4} testID={testID}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space[2] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" tabular testID="booked-when">
              {formatWhen(job.scheduledFor, now, { locale })}
            </Text>
            <Text variant="label" color="textMuted" tabular>
              {t('partner.booked_pay', { amount: amountParam(job.pay.totalIqd) })}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: theme.space[1] }}>
            <StatusPill label={t(KIND_KEY[job.vertical])} tone="neutral" icon={VEHICLE_ICON[vehicle]} size="sm" />
            {job.favourite ? <StatusPill label={t('partner.offer_favourite_title')} tone="accent" icon="heart" size="sm" /> : null}
          </View>
        </View>
        <RouteNodes
          gap={theme.space[2]}
          top={<Text variant="bodyStrong">{zoneName(job.pickup.zoneId, locale, t)}</Text>}
          bottom={<Text variant="bodyStrong">{zoneName(job.dropoff.zoneId, locale, t)}</Text>}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {job.tripKm !== null ? <MetaChip icon="map-pin" label={t('partner.booked_km', { km: km(job.tripKm) })} /> : null}
          <MetaChip icon="wallet" label={job.collectIqd ? t('partner.offer_cash_chip', { amount: amountParam(job.collectIqd) }) : t('partner.offer_prepaid_chip')} />
        </View>
        {children}
      </View>
    </Card>
  );
}
