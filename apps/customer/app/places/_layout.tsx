import { Stack } from 'expo-router';
import { useTheme } from '@driver/ui';
import { HeaderBack } from '@/features/food/HeaderBack';
import { useT } from '@/lib/i18n';

/** Deliver-to place picker (modal over the tabs), the add-place form and the place editor. */
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
        // A push or link can open any of these with no history: the back button falls back home (C-26, A-02).
        headerLeft: () => <HeaderBack fallback="/" />,
      }}
    >
      <Stack.Screen name="index" options={{ title: t('home.places_title') }} />
      <Stack.Screen name="new" options={{ title: t('home.add_place'), headerLeft: () => <HeaderBack fallback="/places" /> }} />
      <Stack.Screen name="edit" options={{ title: t('place.edit_title'), headerLeft: () => <HeaderBack fallback="/places" /> }} />
    </Stack>
  );
}
