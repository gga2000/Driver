import { Stack } from 'expo-router';
import { useTheme } from '@driver/ui';
import { HeaderBack } from '@/features/food/HeaderBack';
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
        // A push or link can open any of these with no history: the back button falls back home (C-26, A-02).
        headerLeft: () => <HeaderBack fallback="/" />,
      }}
    >
      <Stack.Screen name="index" options={{ title: t('household.title') }} />
      <Stack.Screen name="invite" options={{ title: t('household.invite'), headerLeft: () => <HeaderBack fallback="/household" /> }} />
      <Stack.Screen name="member" options={{ title: t('household.limit_title'), headerLeft: () => <HeaderBack fallback="/household" /> }} />
      <Stack.Screen name="children" options={{ title: t('household.children_title'), headerLeft: () => <HeaderBack fallback="/account" /> }} />
    </Stack>
  );
}
