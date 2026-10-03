import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { t } from '@driver/i18n';
import { ThemeProvider, ToastProvider, createTheme } from '@driver/ui';
import { haptics } from '@/haptics';
import { enforceRtl } from '@/rtl';
import { TRPCProvider, makeTrpcClient } from '@/trpc';

enforceRtl();

/** Static colours for navigator chrome, which sits outside the React theme context. */
const theme = createTheme('light');

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  const [trpcClient] = useState(makeTrpcClient);
  // Render immediately with the system face; switch to Plex once the files are in.
  const [fontsLoaded] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider theme="light" fonts={fontsLoaded ? 'plex' : 'system'} haptics={haptics}>
          <ToastProvider bottomOffset={40}>
            <QueryClientProvider client={queryClient}>
              <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
                <StatusBar style="dark" />
                <Stack
                  screenOptions={{
                    headerTitleAlign: 'center',
                    headerShadowVisible: false,
                    headerStyle: { backgroundColor: theme.colors.bg },
                    headerTintColor: theme.colors.text,
                    contentStyle: { backgroundColor: theme.colors.bg },
                  }}
                >
                  <Stack.Screen name="index" options={{ title: t('app.customer'), headerShown: false }} />
                </Stack>
              </TRPCProvider>
            </QueryClientProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
