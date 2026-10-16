'use client';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { consoleNetwork } from './network';
import { TRPCProvider, makeTrpcClient } from './trpc';

/**
 * Reads pause while offline and refetch when back. Writes never wait: React Query's default parks a
 * mutation while offline and fires it the moment the network returns, so a refund or a cash entry
 * tapped during an outage would go out minutes later with nobody watching. Here a write is tried
 * once, now, and an offline one fails as "not sent" (section 6 of the Console build plan).
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 5_000 },
      mutations: { networkMode: 'always', retry: 0 },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [trpcClient] = useState(makeTrpcClient);
  // Queries pause while the browser is offline and refetch the moment it's back.
  useEffect(() => {
    onlineManager.setEventListener((setOnline) => {
      const net = consoleNetwork();
      const sync = () => setOnline(net.getSnapshot().state !== 'offline');
      sync();
      return net.subscribe(sync);
    });
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
