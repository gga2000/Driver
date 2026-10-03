import { Stack } from 'expo-router';
import { useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/** Deliver-to place picker (modal over the tabs) and the add-place form. */
export default function PlacesLayout() {
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
      <Stack.Screen name="index" options={{ title: t('home.places_title') }} />
      <Stack.Screen name="new" options={{ title: t('home.add_place') }} />
    </Stack>
  );
}
