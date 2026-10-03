import { Stack } from 'expo-router';
import { useTheme } from '@driver/ui';

/** Signed-out flow: welcome → phone → otp. The root guard sends signed-in people on. */
export default function AuthLayout() {
  const theme = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="phone" />
      <Stack.Screen name="otp" />
    </Stack>
  );
}
