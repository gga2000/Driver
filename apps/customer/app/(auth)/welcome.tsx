import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Icon, Text, useTheme, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { Wordmark } from '@/components/Wordmark';
import { useT } from '@/lib/i18n';

/** Services shown on the welcome card, in reading order. */
const SERVICES: readonly { icon: IconName; tilt: number }[] = [
  { icon: 'bag', tilt: -8 },
  { icon: 'car', tilt: 6 },
  { icon: 'garage', tilt: -4 },
  { icon: 'tuktuk', tilt: 8 },
  { icon: 'parcel', tilt: -6 },
  { icon: 'cart', tilt: 5 },
];

export default function Welcome() {
  const theme = useTheme();
  const t = useT();
  return (
    <Screen
      edges={['top']}
      contentStyle={{ flexGrow: 1, gap: theme.space[8], justifyContent: 'center' }}
      footer={
        <View style={{ gap: theme.space[3] }}>
          <Button testID="welcome-start" label={t('onboarding.start')} size="lg" fullWidth haptic="medium" onPress={() => router.push('/phone')} />
          <Text variant="caption" color="textMuted" align="center">
            {t('onboarding.terms')}
          </Text>
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
      </View>
    </Screen>
  );
}
