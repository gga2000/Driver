import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Icon, Text, useTheme, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { Wordmark } from '@/components/Wordmark';
import { CITY_ID } from '@/features/food/queries';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { profile } from '@/lib/profile';

/** Services shown on the welcome card, in reading order. */
const SERVICES: readonly { icon: IconName; tilt: number }[] = [
  { icon: 'bag', tilt: -8 },
  { icon: 'car', tilt: 6 },
  { icon: 'garage', tilt: -4 },
  { icon: 'tuktuk', tilt: 8 },
  { icon: 'parcel', tilt: -6 },
  { icon: 'cart', tilt: 5 },
];

/**
 * First launch (audit C-18, Ali 2026-10-04): "يلا نبدي" opens home as a guest — menus and prices
 * before any phone number; the number is asked at "كمّل الطلب" / "احجز". People with an account sign
 * in from the quiet link. A live proof line counts the kitchens open right now (public catalog).
 */
export default function Welcome() {
  const theme = useTheme();
  const t = useT();
  const api = useApi();
  const open = useQuery({ ...api.catalog.restaurants.queryOptions({ cityId: CITY_ID, filters: { openNow: true } }), staleTime: 60_000, retry: false });
  const openCount = open.data?.length ?? 0;
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
      contentStyle={{ flexGrow: 1, gap: theme.space[8], justifyContent: 'center' }}
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

      <View
        style={{
          borderRadius: theme.radius['2xl'],
          backgroundColor: theme.colors.accentTint,
          paddingVertical: theme.space[8],
          paddingHorizontal: theme.space[5],
          gap: theme.space[5],
          overflow: 'hidden',
        }}
      >
        {[SERVICES.slice(0, 3), SERVICES.slice(3)].map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: r === 1 ? theme.space[6] : 0 }}>
            {row.map((s) => (
              <View
                key={s.icon}
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: 22,
                  backgroundColor: theme.colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: [{ rotate: `${s.tilt}deg` }],
                  shadowColor: theme.colors.shadow,
                  shadowOpacity: 0.08,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
                }}
              >
                <Icon name={s.icon} size={30} color="accentText" strokeWidth={1.7} />
              </View>
            ))}
          </View>
        ))}
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="display">{t('onboarding.welcome_title')}</Text>
        <Text variant="body" color="textMuted" style={{ fontSize: 17, lineHeight: 28 }}>
          {t('onboarding.welcome_body')}
        </Text>
        {openCount > 0 ? (
          <View testID="welcome-proof" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: theme.space[2] }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success }} />
            <Text variant="label" weight={600} color="successText" tabular>
              {openCount === 1 ? t('onboarding.welcome_proof_one') : openCount === 2 ? t('onboarding.welcome_proof_two') : openCount > 10 ? t('onboarding.welcome_proof_many', { restaurants: openCount }) : t('onboarding.welcome_proof', { restaurants: openCount })}
            </Text>
          </View>
        ) : null}
        <Text variant="footnote" color="textMuted" style={{ marginTop: theme.space[1] }}>
          {t('onboarding.browse_hint')}
        </Text>
      </View>
    </Screen>
  );
}
