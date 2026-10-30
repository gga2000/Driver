import { Stack } from 'expo-router';
import { useTheme } from '@driver/ui';

/**
 * السوق (round 2, Ali 2026-10-11): the shopping side. Every screen draws its own top (a photo or a
 * title with the back button), so neither this stack nor the app's stack shows a header.
 */
export default function ShoppingLayout() {
  const theme = useTheme();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}
      />
    </>
  );
}
