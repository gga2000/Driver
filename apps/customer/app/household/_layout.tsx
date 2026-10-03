import { Stack } from 'expo-router';
import { useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/** العائلة (domain §12): the household, inviting a member, a member's spending limit. */
export default function HouseholdLayout() {
  const theme = useTheme();
  const t = useT();
  return (
    <Stack
      screenOptions={{
        headerTitleAlign: 'center',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.bg },
        headerTintColor: theme.colors.text,
        contentStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('household.title') }} />
      <Stack.Screen name="invite" options={{ title: t('household.invite') }} />
      <Stack.Screen name="member" options={{ title: t('household.limit_title') }} />
    </Stack>
  );
}
