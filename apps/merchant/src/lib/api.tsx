import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import * as Application from 'expo-application';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { REQUEST_LIMITS, transformer, type AppRouter } from '@driver/contracts';
import { bindOnlineManager, configureNetwork, networkFetch } from '@driver/ui';
import { createStreamTokenCache, installReadableStreamPolyfill, XhrEventSource, type StreamTokenCache } from '@driver/contracts/live-client';
import { getDeviceInfo } from './device';
import { authRetryLink } from './api-links';
import { appBuildHeaders, resolveBuild, shouldRetryQuery, updateRequiredLink } from './app-version';
import { DEV_TOOLS } from './env';
import { session as appSession, type SessionStore } from './session';

export { apiErrorCode, apiErrorMessage, apiRetryAfter, authRetryLink, isUnauthorized } from './api-links';

/**
 * The merchant app's API layer: one tRPC client (httpBatchLink + superjson; `live.*` subscriptions
 * over SSE with httpSubscriptionLink) whose requests carry
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

// Hermes (native) has no ReadableStream; tRPC's SSE consumer needs the small part the ponyfill gives.
installReadableStreamPolyfill();

// Offline awareness (the shared strip, skeleton timeouts): every request feeds the network monitor, its
// probe checks this API while it can't be reached, and React Query pauses while the device is offline.
configureNetwork({ apiUrl: API_URL });
bindOnlineManager(onlineManager);

/**
 * CORE-05: `x-driver-app: merchant/<store version>` on every call and on the live stream, so the server
 * can turn away builds older than its minimum (native only; the web build sends nothing).
 */
const BUILD_HEADERS = appBuildHeaders(
  resolveBuild({
    os: Platform.OS,
    nativeVersion: Platform.OS === 'web' ? null : Application.nativeApplicationVersion,
    devTools: DEV_TOOLS,
    search: Platform.OS === 'web' && typeof location !== 'undefined' ? location.search : '',
  }),
);

/** Browsers keep their EventSource; React Native gets the XHR one (it has none). */
const EventSourceImpl = ((globalThis as { EventSource?: unknown }).EventSource ?? XhrEventSource) as typeof XhrEventSource;

/** Stream tokens per client (`live.*` subscriptions): `useLiveTokens()` drops it after a 401. */
const liveTokens = new WeakMap<object, StreamTokenCache>();

export function makeApiClient(store: SessionStore = appSession, url: string = API_URL) {
  // A bare client for the refresh call: no auth header, no retry link (no recursion).
  const bare = createTRPCClient<AppRouter>({ links: [updateRequiredLink(), httpBatchLink({ url, transformer, fetch: networkFetch, maxItems: REQUEST_LIMITS.clientBatchItems, headers: () => BUILD_HEADERS })] });
  store.setRefresher(async (refreshToken) => bare.identity.refresh.mutate({ refreshToken, device: await getDeviceInfo() }));

  const batch = httpBatchLink({
    url,
    transformer,
    fetch: networkFetch,
    // The API takes at most REQUEST_LIMITS.maxBatchSize calls per request (SEC-03); split well below it.
    maxItems: REQUEST_LIMITS.clientBatchItems,
    async headers() {
      const token = await store.getAccessToken();
      return token ? { ...BUILD_HEADERS, authorization: `Bearer ${token}` } : BUILD_HEADERS;
    },
  });
  // `live.*` subscriptions go over SSE. EventSource cannot send headers, so each connection carries a
  // short-lived stream token (`live.token`, Bearer-authenticated) in tRPC connection params.
  const authed = createTRPCClient<AppRouter>({ links: [updateRequiredLink(), authRetryLink(store), batch] });
  const tokens = createStreamTokenCache(() => authed.live.token.mutate());
  store.onSignOut(() => tokens.clear());
  const client = createTRPCClient<AppRouter>({
    links: [
      // An `update_required` answer anywhere turns the app into the update screen (src/lib/app-version.ts).
      updateRequiredLink(),
      splitLink({
        condition: (op) => op.type === 'subscription',
        true: httpSubscriptionLink({
          url,
          transformer,
          EventSource: EventSourceImpl,
          // The XHR EventSource (native) sends these; a browser's ignores them (and web has none).
          eventSourceOptions: { headers: BUILD_HEADERS },
          connectionParams: async () => ({ streamToken: await tokens.get() }),
        }),
        false: [authRetryLink(store), batch],
      }),
    ],
  });
  liveTokens.set(client, tokens);
  return client;
}

/** The stream-token cache of the app's client (the live hooks clear it when a stream is refused with 401). */
export function useLiveTokens(): StreamTokenCache | null {
  return liveTokens.get(useTRPCClient()) ?? null;
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Don't hammer a refused request; the auth link already retried a 401 once; an old build never retries.
        retry: shouldRetryQuery,
      },
      // A tap offline fails at once with a clear message instead of spinning until the network is back
      // (React Query's default pauses it). Work that must survive offline is queued explicitly.
      mutations: { networkMode: 'always' },
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

