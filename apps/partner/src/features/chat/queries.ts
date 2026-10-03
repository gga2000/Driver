import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHAT_POLL_MS, type ChatThreadKind } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** Badges on the order screen's call / chat buttons refresh this often. */
const THREADS_POLL_MS = 5000;

/**
 * Chat reads poll (`CHAT_POLL_MS`, 3 s, while the thread is on screen) until the push / subscription
 * channel ships; the push notification for a new message already goes out from the API.
 */
export function useChatThreads(orderId: string, enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.chat.threads.queryOptions({ orderId }),
    enabled: signedIn && enabled && Boolean(orderId),
    refetchInterval: THREADS_POLL_MS,
    staleTime: 0,
    retry: false,
  });
}

export function useChatThread(orderId: string, kind: ChatThreadKind) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.chat.thread.queryOptions({ orderId, kind }),
    enabled: signedIn && Boolean(orderId),
    refetchInterval: (q) => (q.state.data?.status === 'closed' ? false : CHAT_POLL_MS),
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
