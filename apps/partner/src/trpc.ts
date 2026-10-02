import Constants from 'expo-constants';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { transformer, type AppRouter } from '@driver/contracts';

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };
export const API_URL = extra.apiUrl ?? 'http://localhost:3000/trpc';

export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: API_URL, transformer })] });
}
