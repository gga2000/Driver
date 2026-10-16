import { router } from 'expo-router';
import { View } from 'react-native';
import { IconButton, Text, useTheme } from '@driver/ui';
import { Wordmark } from '@/components/Wordmark';
import { useT } from '@/lib/i18n';

/**
 * Back button + title block shared by the phone, OTP and setup screens. With `step` (partner redesign f4,
 * the dashboard look): the wordmark, the two-step bar and the title at display size.
 */
export function AuthHeader({
  title,
  subtitle,
  back = true,
  onBack,
  aside,
  step,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  /** Overrides the default router.back() (in-screen steps). */
  onBack?: () => void;
  aside?: string;
  /** f4: «خطوة 1 من 2» with the two-step bar (phone, then code). */
  step?: 1 | 2;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[5] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        {back ? (
          <IconButton
            icon="chevron-back"
            variant="outline"
            accessibilityLabel={t('action.back')}
            onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/welcome'))}
          />
        ) : (
          <View />
        )}
        {aside ? (
          <Text variant="label" color="textMuted" tabular>
            {aside}
          </Text>
        ) : step ? (
          <Wordmark size="md" />
        ) : null}
      </View>
      {step ? (
        <View testID="auth-step" style={{ gap: theme.space[2] }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[1, 2].map((n) => (
              <View key={n} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: n <= step ? theme.colors.accent : theme.colors.surfaceSunken }} />
            ))}
          </View>
          <Text variant="caption" weight={600} color="textMuted" tabular>
            {t('partner.f4_step', { n: step })}
          </Text>
        </View>
      ) : null}
      <View style={{ gap: theme.space[1] }}>
        <Text variant={step ? 'display' : 'heading'} accessibilityRole="header" style={step ? { lineHeight: 44 } : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" color="textMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
