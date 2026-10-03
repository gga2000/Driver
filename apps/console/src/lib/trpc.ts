'use client';

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { transformer, type AppRouter } from '@driver/contracts';
import { getAccessToken } from './session';

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/trpc';

export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: API_URL,
        transformer,
        // Read per request so signing in or out takes effect without rebuilding the client.
        headers() {
          const token = getAccessToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
