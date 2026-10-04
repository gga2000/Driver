import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatThreadKind } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useLiveChannel, useLivePollMs } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { liveOrderKey } from '@/features/track/queries';

const liveChatKey = (orderId: string, kind: ChatThreadKind) => `chat:${orderId}:${kind}`;

/**
 * Chat is pushed: the thread by `live.chat` (mounted by the chat screen), the badges by the order
 * screen's `live.order`. Queries keep a slow safety refetch (30 s when SSE does not get through);
 * the push notification for a new message still goes out from the API.
 */
export function useChatThreads(orderId: string, enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  const pollMs = useLivePollMs(liveOrderKey(orderId));
  return useQuery({
    ...api.chat.threads.queryOptions({ orderId }),
    enabled: signedIn && enabled && Boolean(orderId),
    refetchInterval: pollMs,
    staleTime: 0,
    retry: false,
  });
}

/** Keeps `live.chat` open while the thread is on screen; a message re-reads the thread and the badges. */
export function useLiveChat(orderId: string, kind: ChatThreadKind, enabled = true) {
  const signedIn = useSignedIn();
  return useLiveChannel({
    enabled: signedIn && enabled && Boolean(orderId),
    key: liveChatKey(orderId, kind),
    subscribe: (client, h) => client.live.chat.subscribe({ orderId, kind }, h),
    resyncKeys: ['chat.thread', 'chat.threads'],
    onEvent: (e, qc, api) => {
      if (e.type !== 'chat' || e.orderId !== orderId || e.kind !== kind) return;
      void qc.invalidateQueries({ queryKey: api.chat.thread.queryKey({ orderId, kind }) });
      void qc.invalidateQueries({ queryKey: api.chat.threads.queryKey({ orderId }) });
    },
  });
}

export function useChatThread(orderId: string, kind: ChatThreadKind) {
  const api = useApi();
  const signedIn = useSignedIn();
  useLiveChat(orderId, kind);
  const pollMs = useLivePollMs(liveChatKey(orderId, kind));
  return useQuery({
    ...api.chat.thread.queryOptions({ orderId, kind }),
    enabled: signedIn && Boolean(orderId),
    refetchInterval: (q) => (q.state.data?.status === 'closed' ? false : pollMs),
    staleTime: 0,
  });
}

export function useChatActions(orderId: string, kind: ChatThreadKind) {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: api.chat.thread.queryKey({ orderId, kind }) }), qc.invalidateQueries({ queryKey: api.chat.threads.queryKey({ orderId }) })]);
  return {
    send: useMutation({ ...api.chat.send.mutationOptions(), onSuccess: () => void refresh() }),
    markRead: useMutation({ ...api.chat.markRead.mutationOptions(), onSuccess: () => void qc.invalidateQueries({ queryKey: api.chat.threads.queryKey({ orderId }) }) }),
    requestCall: useMutation(api.chat.requestCall.mutationOptions()),
    refresh,
  };
}
