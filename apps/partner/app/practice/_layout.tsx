import { Stack } from 'expo-router';
import { useTheme } from '@driver/ui';
import { PracticeProvider } from '@/features/practice/Practice';

/** «البروفة» (partner redesign l4): the real slip and job screens on a pretend order, answered on this phone. */
export default function PracticeLayout() {
  const theme = useTheme();
  return (
    <PracticeProvider>
      <Stack screenOptions={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: theme.colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="offer" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }} />
        <Stack.Screen name="job" />
      </Stack>
    </PracticeProvider>
  );
}
