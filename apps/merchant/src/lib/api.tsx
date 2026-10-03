import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { transformer, type AppRouter } from '@driver/contracts';
import { getDeviceInfo } from './device';
import { authRetryLink } from './api-links';
import { session as appSession, type SessionStore } from './session';

export { apiErrorCode, apiErrorMessage, apiRetryAfter, authRetryLink, isUnauthorized } from './api-links';

/**
 * The merchant app's API layer: one tRPC client (httpBatchLink + superjson) whose requests carry
 * `Authorization: Bearer <access token>` from the session, refresh once on a 401 and retry, and a
 * React Query client shared by every screen.
 *
 * Screens use `useApi()` (the typed tRPC proxy) with React Query:
 *
 *   const api = useApi();
 *   const me = useQuery(api.identity.me.queryOptions());
 *   const send = useMutation(api.identity.requestOtp.mutationOptions());
 *
 * Feature hooks live next to the flow (`src/features/<flow>/queries.ts`); see README "Adding a flow".
 */

const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

/** `EXPO_PUBLIC_API_URL` is inlined at bundle time by Expo (and by `expo export`). */
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/trpc';

export function makeApiClient(store: SessionStore = appSession, url: string = API_URL) {
  // A bare client for the refresh call: no auth header, no retry link (no recursion).
  const bare = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
  store.setRefresher(async (refreshToken) => bare.identity.refresh.mutate({ refreshToken, device: await getDeviceInfo() }));

  return createTRPCClient<AppRouter>({
    links: [
      authRetryLink(store),
      httpBatchLink({
        url,
        transformer,
        async headers() {
          const token = await store.getAccessToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Don't hammer a refused request; the auth link already retried a 401 once.
        retry: (count, err) => count < 2 && !(err instanceof TRPCClientError && (err.data as { httpStatus?: number } | undefined)?.httpStatus === 401),
      },
    },
  });
}

/** Query + tRPC providers. Signing out drops every cached query so the next person sees nothing. */
export function ApiProvider({ children, store = appSession }: { children: ReactNode; store?: SessionStore }) {
  const [queryClient] = useState(makeQueryClient);
  const [trpcClient] = useState(() => makeApiClient(store));
  useEffect(() => store.onSignOut(() => queryClient.clear()), [store, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

/** Typed tRPC proxy for React Query: `useQuery(useApi().orders.mine.queryOptions())`. */
export function useApi() {
  return useTRPC();
}

/** Imperative client for one-off calls outside React Query (`await client.identity.logout.mutate({})`). */
export function useApiClient() {
  return useTRPCClient();
}

