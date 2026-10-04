import { Stack } from 'expo-router';
import { useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/** Profile edits (modal over the tabs): name, safety. */
export default function ProfileLayout() {
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
      <Stack.Screen name="name" options={{ title: t('profile.name_title') }} />
      <Stack.Screen name="safety" options={{ title: t('account.safety') }} />
      <Stack.Screen name="notifications" options={{ title: t('notify.settings.title') }} />
    </Stack>
  );
}
