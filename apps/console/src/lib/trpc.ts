'use client';

import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { REQUEST_LIMITS, transformer, type AppRouter } from '@driver/contracts';
import { createStreamTokenCache, type StreamTokenCache } from '@driver/contracts/live-client';
import { consoleFetch } from './network';
import { authRetryLink } from './auth-link';
import { getFreshAccessToken, getSession, isAuthError, refreshSession, setRefresher } from './session';

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/trpc';

/** Stream tokens per client (`live.consoleBoard` over SSE): dropped after a 401 so the next connect mints one. */
const liveTokens = new WeakMap<object, StreamTokenCache>();

export function liveTokensOf(client: object): StreamTokenCache | null {
  return liveTokens.get(client) ?? null;
}

export function makeTrpcClient() {
  // A bare client for `identity.refresh`: no auth header, no retry link (no recursion).
  const bare = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: API_URL, transformer, fetch: consoleFetch })] });
  setRefresher((refreshToken) => bare.identity.refresh.mutate({ refreshToken }));
  const retry = authRetryLink({ isAuthError, hasSession: () => getSession() !== null, refresh: refreshSession });
  const batch = httpBatchLink({
    url: API_URL,
    transformer,
    // Every answer and failure feeds the network monitor (live badge, offline strip, Arabic errors).
    fetch: consoleFetch,
    // The API takes at most REQUEST_LIMITS.maxBatchSize calls per request (SEC-03); split well below it.
    maxItems: REQUEST_LIMITS.clientBatchItems,
    // Read per request so signing in or out takes effect without rebuilding the client; a token
    // about to run out is renewed first (CON-01), so a long shift never meets a 401.
    async headers() {
      const token = await getFreshAccessToken();
      return token ? { authorization: `Bearer ${token}` } : {};
    },
  });
  const authed = createTRPCClient<AppRouter>({ links: [retry, batch] });
  const tokens = createStreamTokenCache(() => authed.live.token.mutate());
  // `live.*` over SSE: the browser's EventSource cannot send headers, so each connection carries a
  // short-lived stream token (minted with the Bearer token) in tRPC connection params.
  const client = createTRPCClient<AppRouter>({
    links: [
      retry,
      splitLink({
        condition: (op) => op.type === 'subscription',
        true: httpSubscriptionLink({
          url: API_URL,
          transformer,
          connectionParams: async () => ({ streamToken: await tokens.get() }),
        }),
        false: batch,
      }),
    ],
  });
  liveTokens.set(client, tokens);
  return client;
}
