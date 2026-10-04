'use client';

import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { transformer, type AppRouter } from '@driver/contracts';
import { createStreamTokenCache, type StreamTokenCache } from '@driver/contracts/live-client';
import { getAccessToken } from './session';

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/trpc';

/** Stream tokens per client (`live.consoleBoard` over SSE): dropped after a 401 so the next connect mints one. */
const liveTokens = new WeakMap<object, StreamTokenCache>();

export function liveTokensOf(client: object): StreamTokenCache | null {
  return liveTokens.get(client) ?? null;
}

export function makeTrpcClient() {
  const batch = httpBatchLink({
    url: API_URL,
    transformer,
    // Read per request so signing in or out takes effect without rebuilding the client.
    headers() {
      const token = getAccessToken();
      return token ? { authorization: `Bearer ${token}` } : {};
    },
  });
  const authed = createTRPCClient<AppRouter>({ links: [batch] });
  const tokens = createStreamTokenCache(() => authed.live.token.mutate());
  // `live.*` over SSE: the browser's EventSource cannot send headers, so each connection carries a
  // short-lived stream token (minted with the Bearer token) in tRPC connection params.
  const client = createTRPCClient<AppRouter>({
    links: [
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
