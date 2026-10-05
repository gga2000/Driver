import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { PartnerDemand } from '@driver/contracts';
import { pluralKey } from '@driver/i18n';
import { SegmentRing, Text, useTheme } from '@driver/ui';
import { useCountFrom } from '@/features/account/EarningsParts';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { DemandRow } from './HomeParts';

/** Today's totals from the server (`partner.status.today`), read after this job was counted. */
export interface JobEndDay {
  earningsIqd: number;
  jobs: number;
}
export type JobEndDemand = PartnerDemand;

/**
 * The peak of the job (partner audit S-3): the check lands in the middle of a ring with one segment
 * per job today, the newest sweeping in, and the pay of this job counts up under it — then the day
 * so far. The ring counts what happened; nothing here is a target. `today` null = still being
 * re-read (the line says so instead of showing numbers without this job); undefined = no day line
 * (saved offline): the ring is then one closed circle.
 */
export function JobEndHero({ earnedIqd, failed, today, children }: { earnedIqd: number; failed: boolean; today: JobEndDay | null | undefined; children: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const shown = useCountFrom(failed ? 0 : earnedIqd, 1100);
  const jobs = today?.jobs ?? 0;
  // The count is {n} (the jobs), not the amount before it: pick the plural form by the jobs.
  const dayLine = today ? t(pluralKey('partner.jobend_today', today.jobs), { amount: amountParam(today.earningsIqd), n: today.jobs }) : null;
  return (
    <View style={{ alignItems: 'center', gap: theme.space[4] }}>
      {failed ? (
        children
      ) : (
        <SegmentRing testID="jobend-ring" count={today ? Math.max(1, jobs) : today === undefined ? 1 : 0} animateLast delayMs={350} size={168} strokeWidth={9} accessibilityLabel={dayLine ?? undefined}>
          {children}
        </SegmentRing>
      )}
      <View style={{ alignItems: 'center', gap: theme.space[1] }}>
        <Text variant="heading" align="center" accessibilityRole="header">
          {failed ? t('partner.job_failed_title') : t('partner.job_done_title')}
        </Text>
        {!failed && earnedIqd > 0 ? (
          <View accessible accessibilityLabel={t('partner.jobend_earned_a11y', { amount: amountParam(earnedIqd) })} style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
            <Text variant="numeralSm" color="successText" tabular testID="job-done-earned">
              {amountParam(shown, { sign: true })}
            </Text>
            <Text variant="title" color="successText">
              {t('quote.currency')}
            </Text>
          </View>
        ) : null}
        {!failed && today !== undefined ? (
          dayLine ? (
            <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.delay(700).duration(300)}>
              <Text testID="jobend-today" variant="label" color="textMuted" tabular align="center">
                {dayLine}
              </Text>
            </Animated.View>
          ) : (
            <Text testID="jobend-today-loading" variant="label" color="textMuted" align="center">
              {t('partner.jobend_today_loading')}
            </Text>
          )
        ) : null}
      </View>
    </View>
  );
}

/** The done screen's frame: centred when it fits, scrolling on a short phone. */
export function JobEndFrame({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <ScrollView testID={testID} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: theme.space[5], padding: theme.space[6] }}>
      {children}
    </ScrollView>
  );
}

/** What's next when he can keep working: where the jobs are waiting (the demand hint), or nothing. */
export function JobEndNext({ demand }: { demand: JobEndDemand | null | undefined }) {
  const theme = useTheme();
  if (!demand || demand.level === 'quiet') return null;
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.delay(900).duration(300)}>
      <DemandRow demand={demand} />
    </Animated.View>
  );
}
