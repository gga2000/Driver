import { router } from 'expo-router';
import { View } from 'react-native';
import { IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/** Back button + title block shared by the phone, OTP and setup screens. */
export function AuthHeader({
  title,
  subtitle,
  back = true,
  onBack,
  aside,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  /** Overrides the default router.back() (in-screen steps). */
  onBack?: () => void;
  aside?: string;
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
            onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'))}
          />
        ) : (
          <View />
        )}
        {aside ? (
          <Text variant="label" color="textMuted" tabular>
            {aside}
          </Text>
        ) : null}
      </View>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="heading" accessibilityRole="header">
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
