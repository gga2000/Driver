import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Icon, Skeleton, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { Wordmark } from '@/components/Wordmark';
import { CITY_ID } from '@/features/food/queries';
import { todayLine } from '@/features/welcome/today';
import { WelcomeMap } from '@/features/welcome/WelcomeMap';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { profile } from '@/lib/profile';

/**
 * First launch (audit C-18, Ali 2026-10-04; d-6): a map of home — Aziziyah's market, bridge and
 * garages with six spots lighting up in turn — then "يلا نبدي", which opens home as a guest (menus and
 * prices before any phone number; the number is asked at "كمّل الطلب" / "احجز"). Under it the live
 * proof (`catalog.today`: kitchens open, الرجعة cars today) and the honest-delay promise in the
 * server's own terms. Offline or failing, the proof simply isn't shown; captions say it without numbers.
 */
export default function Welcome() {
  const theme = useTheme();
  const t = useT();
  const api = useApi();
  const today = useQuery({ ...api.catalog.today.queryOptions({ cityId: CITY_ID }), staleTime: 60_000, retry: false });
  const proof = todayLine(today.data, t);
  const browse = async () => {
    await profile.setWelcomed();
    router.replace('/');
  };
  const signIn = async () => {
    await profile.setWelcomed();
    await profile.setReturnTo(null);
    router.push('/phone');
  };
  return (
    <Screen
      edges={['top']}
      contentStyle={{ flexGrow: 1, gap: theme.space[5], justifyContent: 'center' }}
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button testID="welcome-start" label={t('onboarding.start')} size="lg" fullWidth haptic="medium" onPress={() => void browse()} />
          <Button testID="welcome-signin" variant="ghost" label={t('onboarding.have_account')} onPress={() => void signIn()} style={{ alignSelf: 'center' }} />
        </View>
      }
    >
      <View>
        <Wordmark />
      </View>

      <WelcomeMap today={today.data} />

      <View style={{ gap: theme.space[2] }}>
        <Text variant="title" accessibilityRole="header">
          {t('onboarding.welcome_title')}
        </Text>
        {today.isPending ? (
          <Skeleton width={220} height={18} />
        ) : proof ? (
          <View testID="welcome-proof" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success }} />
            <Text variant="label" weight={600} color="successText" tabular style={{ flexShrink: 1 }}>
              {proof}
            </Text>
          </View>
        ) : null}
        {today.data ? (
          <View testID="welcome-promise" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="shield" size={16} color="textMuted" />
            <Text variant="footnote" color="textMuted" style={{ flexShrink: 1 }}>
              {t('promise.line', { minutes: today.data.latePromiseMin })}
            </Text>
          </View>
        ) : null}
        <Text variant="footnote" color="textMuted">
          {t('onboarding.browse_hint')}
        </Text>
      </View>
    </Screen>
  );
}
