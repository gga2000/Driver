'use client';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { consoleNetwork } from './network';
import { TRPCProvider, makeTrpcClient } from './trpc';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } }));
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
