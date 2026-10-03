import { Stack } from 'expo-router';
import { View } from 'react-native';
import { Card, EmptyState, Skeleton, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { MetricPreview, MetricRow, NoConsequenceNote, NudgesCard, ObservationCard, ScoreHero } from '@/features/account/ScoreParts';
import { useScorecard } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * التقييم (scoring spec §1). From day 31: the reliability index on a gauge, his tier on the ladder
 * with its cash cap, this week's nudges with the Sunday they would apply, and each component against
 * its target and Silver line. Days 1–30: a friendly "تقييمك يبين بعد 30 يوم" card, day n of 30,
 * month one has no consequences, and what will be measured.
 */
export default function Scorecard() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const q = useScorecard();
  const card = q.data;
  return (
    <Screen testID="scorecard" edges={['bottom']}>
      <Stack.Screen options={{ title: t('partner.hub_scorecard') }} />
      {!card ? (
        q.error ? (
          <EmptyState icon="star" title={apiErrorMessage(q.error, t('error.network'), locale)} action={{ label: t('action.retry'), onPress: () => void q.refetch() }} />
        ) : (
          <Card elevation={1} padding={5}>
            <Skeleton lines={5} />
          </Card>
        )
      ) : card.visible ? (
        <>
          <ScoreHero card={card} />
          <NudgesCard nudges={card.nudges} consequencesFrom={card.consequencesFrom} />
          <View style={{ gap: theme.space[2] }}>
            <Text variant="title" style={{ paddingHorizontal: theme.space[1] }}>
              {t('partner.score_metrics_title')}
            </Text>
            <Card elevation={1} padding={0} style={{ paddingHorizontal: theme.space[4] }}>
              {card.metrics.map((m, i) => (
                <MetricRow key={m.key} m={m} divider={i < card.metrics.length - 1} />
              ))}
            </Card>
          </View>
        </>
      ) : (
        <>
          <ObservationCard card={card} />
          <NoConsequenceNote />
          <MetricPreview />
        </>
      )}
    </Screen>
  );
}
