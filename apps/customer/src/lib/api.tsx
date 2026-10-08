import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { transformer, type AppRouter } from '@driver/contracts';
import { NET_RULES } from '@driver/contracts/net-client';
import { bindFocusManager, bindOnlineManager, configureNetwork, createNetworkFetch, networkFetch } from '@driver/ui';
import { createStreamTokenCache, installReadableStreamPolyfill, XhrEventSource, type StreamTokenCache } from '@driver/contracts/live-client';
import { getDeviceInfo } from './device';
import { appBuildHeaders, appUpdate } from './app-update';
import { authRetryLink, errorTapLink, inputTooLongForUrl, URL_RULES } from './api-links';
import { retryDelayMs, shouldRetryQuery } from './errors';
import { session as appSession, type SessionStore } from './session';
import { withServerClock } from './server-clock';

export { apiErrorCode, apiErrorMessage, apiRetryAfter, authRetryLink, isUnauthorized } from './api-links';

/**
 * The customer app's API layer: one tRPC client (httpBatchLink + superjson; `live.*` subscriptions
 * over SSE with httpSubscriptionLink) whose requests carry
 * `Authorization: Bearer <access token>` from the session, refresh once on a 401 and retry, and a
 * React Query client shared by every screen. Every request has a deadline (`NET_RULES.requestTimeoutMs`;
 * the refresh a longer one, and requests stop waiting for it after 10 s), so a stalled connection never
 * freezes the app (audit CORE-01); live streams reconnect on their own after `LIVE_RULES.inactivityMs` of silence.
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
// probe checks this API while it can't be reached, and React Query pauses while the device is offline
// and while the app is in the background.
configureNetwork({ apiUrl: API_URL });
bindOnlineManager(onlineManager);
// Polls pause in the background and stale screens refresh on return (CORE-09).
bindFocusManager(focusManager);

/** Browsers keep their EventSource; React Native gets the XHR one (it has none). */
const EventSourceImpl = ((globalThis as { EventSource?: unknown }).EventSource ?? XhrEventSource) as typeof XhrEventSource;

/** Stream tokens per client (`live.*` subscriptions): `useLiveTokens()` drops it after a 401. */
const liveTokens = new WeakMap<object, StreamTokenCache>();

/** CORE-05: the store version baked into this binary, on every call (native builds only). */
const BUILD_HEADERS = appBuildHeaders(Platform.OS, Application.nativeApplicationVersion);

export function makeApiClient(store: SessionStore = appSession, url: string = API_URL) {
  // A bare client for the refresh call: no auth header, no retry link (no recursion), and a longer
  // deadline: the server rotates the token when it answers, so a slow answer must still land (the
  // session lets waiting requests go on after 10 s).
  const bare = createTRPCClient<AppRouter>({ links: [errorTapLink(appUpdate.noteError), httpBatchLink({ url, transformer, fetch: createNetworkFetch(NET_RULES.refreshTimeoutMs), headers: BUILD_HEADERS })] });
  store.setRefresher(async (refreshToken) => bare.identity.refresh.mutate({ refreshToken, device: await getDeviceInfo() }));

  const headers = async () => {
    const token = await store.getAccessToken();
    return token ? { ...BUILD_HEADERS, authorization: `Bearer ${token}` } : BUILD_HEADERS;
  };
  // Every answer's Date header keeps the server clock (THIN-10: the iftar countdown never runs on a wrong phone clock).
  const clockedFetch = withServerClock(networkFetch);
  // Batches split before their URL gets long; one query too big for a URL on its own goes as POST.
  const batch = splitLink<AppRouter>({
    condition: (op) => inputTooLongForUrl(op),
    true: httpBatchLink({ url, transformer, fetch: clockedFetch, headers, methodOverride: 'POST' }),
    false: httpBatchLink({ url, transformer, fetch: clockedFetch, headers, maxURLLength: URL_RULES.maxUrlLength }),
  });
  // `live.*` subscriptions go over SSE. EventSource cannot send headers, so each connection carries a
  // short-lived stream token (`live.token`, Bearer-authenticated) in tRPC connection params.
  const authed = createTRPCClient<AppRouter>({ links: [authRetryLink(store), batch] });
  const tokens = createStreamTokenCache(() => authed.live.token.mutate());
  store.onSignOut(() => tokens.clear());
  const client = createTRPCClient<AppRouter>({
    links: [
      // An old build refused by the server (update_required) turns the app into «حدّث التطبيق».
      errorTapLink(appUpdate.noteError),
      splitLink({
        condition: (op) => op.type === 'subscription',
        true: httpSubscriptionLink({
          url,
          transformer,
          EventSource: EventSourceImpl,
          // Signed out (a family member on the public share page): no stream token; only public streams open.
          connectionParams: async (): Promise<Record<string, string>> => ((await store.getAccessToken()) ? { streamToken: await tokens.get() } : {}),
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
        // Retry only what can change (no response, our server, a short rate limit); a definitive answer
        // shows at once. The auth link already retried a 401 once.
        retry: shouldRetryQuery,
        retryDelay: retryDelayMs,
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

