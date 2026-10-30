import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Icon, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { Wordmark } from '@/components/Wordmark';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const VEHICLES: readonly IconName[] = ['bike', 'tuktuk', 'car', 'garage'];
const POINTS = ['partner.welcome_point_pay', 'partner.welcome_point_cash', 'partner.welcome_point_support_v2'] as const;

/** Partner welcome: what the app is for, shown as the thing a driver cares about — a job's pay. */
export default function Welcome() {
  const theme = useTheme();
  const t = useT();
  // Check-up item 4: ink by day; at night a raised ember panel with cream text, never a cream block.
  const night = theme.scheme === 'dark';
  const ink = night ? theme.colors.surfaceRaised : theme.colors.text;
  const cream = night ? theme.colors.text : theme.colors.bg;
  return (
    <Screen
      edges={['top']}
      contentStyle={{ flexGrow: 1, gap: theme.space[6], justifyContent: 'center' }}
      footer={
        <View style={{ gap: theme.space[3] }}>
          <Button testID="welcome-start" label={t('partner.welcome_start')} icon="phone" size="lg" fullWidth haptic="medium" onPress={() => router.push('/phone')} />
          <Text variant="caption" color="textMuted" align="center">
            {t('partner.welcome_terms')}
          </Text>
        </View>
      }
    >
      <Wordmark />

      {/* Hero: the ink card every driver will learn — an offer with its pay, itemised. */}
      <View style={{ borderRadius: theme.radius['2xl'], backgroundColor: ink, borderWidth: night ? 1.5 : 0, borderColor: theme.colors.border, padding: theme.space[5], gap: theme.space[5], overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {VEHICLES.map((icon) => (
            <View
              key={icon}
              style={{ width: 54, height: 54, borderRadius: 27, borderWidth: 1.5, borderColor: withAlpha(cream, 0.25), alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name={icon} size={26} color={cream} strokeWidth={1.7} />
            </View>
          ))}
        </View>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: theme.space[4], gap: theme.space[3], transform: [{ rotate: '-1.5deg' }] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ gap: 2 }}>
              <Text variant="caption" color="textMuted">
                {t('partner.offer_you_earn')}
              </Text>
              <Text variant="display" tabular style={{ lineHeight: 42 }}>
                {`${amountParam(1500)} `}
                <Text variant="title" color="textMuted">
                  {t('quote.currency')}
                </Text>
              </Text>
            </View>
            <View style={{ width: 58, height: 58, borderRadius: 29, borderWidth: 5, borderColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="title" tabular weight={700}>
                12
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}>
            {[
              [t('partner.pay_delivery'), amountParam(1000)],
              [t('partner.pay_night'), amountParam(250, { sign: true })],
              [t('partner.pay_pickup_compensation'), amountParam(250, { sign: true })],
            ].map(([label, value]) => (
              <View key={label} style={{ flexDirection: 'row', gap: 4, backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
                <Text variant="caption" color="textMuted">
                  {label}
                </Text>
                <Text variant="caption" weight={600} tabular>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <View style={{ gap: theme.space[1] }}>
          <Text variant="heading" accessibilityRole="header">
            {t('partner.welcome_title')}
          </Text>
          <Text variant="body" color="textMuted">
            {t('partner.welcome_body')}
          </Text>
        </View>
        <View style={{ gap: theme.space[2] }}>
          {POINTS.map((key) => (
            <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={16} color="successText" strokeWidth={2.4} />
              </View>
              <Text variant="label">{t(key)}</Text>
            </View>
          ))}
        </View>
      </View>
    </Screen>
  );
}
