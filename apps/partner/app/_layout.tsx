import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { t } from '@driver/i18n';
import { enforceRtl } from '@/rtl';
import { TRPCProvider, makeTrpcClient } from '@/trpc';

enforceRtl();

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  const [trpcClient] = useState(makeTrpcClient);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerTitleAlign: 'center' }}>
            <Stack.Screen name="index" options={{ title: t('app.partner') }} />
          </Stack>
        </TRPCProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
