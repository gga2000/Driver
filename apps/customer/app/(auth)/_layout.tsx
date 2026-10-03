import { Stack } from 'expo-router';
import { useTheme } from '@driver/ui';

/** Signed-out flow. The root guard keeps signed-in people out (except the post-OTP setup step). */
export default function AuthLayout() {
  const theme = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="phone" />
      <Stack.Screen name="otp" />
      <Stack.Screen name="setup" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
