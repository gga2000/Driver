import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TripChatRef, TripChatSubject } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useLiveChannel, useLivePollMs } from '@/lib/live';
import { useSignedIn } from '@/lib/session';

/** The live key of one pair thread (step 4c), the same as the server's channel when he is the side it is keyed by. */
const liveKey = (ref: TripChatRef) => `tripchat:${ref.id}:${ref.with ?? 'me'}`;

/** `with` only when it names someone: the query keys match whether the screen passed it or not. */
export function tripRef(subject: TripChatSubject, id: string, withId?: string | null): TripChatRef {
  return withId ? { subject, id, with: withId } : { subject, id };
}

/**
 * The Baghdad/Kut chat with one driver (step 4c): pushed by `live.tripChat` while on screen, with the
 * usual slow safety refetch when SSE does not get through. A price card's answer re-reads it too.
 */
export function useTripChatThread(ref: TripChatRef) {
  const api = useApi();
  const signedIn = useSignedIn();
  const qc = useQueryClient();
  useLiveChannel({
    enabled: signedIn && Boolean(ref.id),
    key: liveKey(ref),
    subscribe: (client, h) => client.live.tripChat.subscribe(ref, h),
    resyncKeys: ['chat.trip.threads'],
    onEvent: (e) => {
      if (e.type !== 'chat' || e.orderId !== ref.id) return;
      void qc.invalidateQueries({ queryKey: api.chat.trip.thread.queryKey(ref) });
      void qc.invalidateQueries({ queryKey: api.chat.trip.threads.queryKey({ subject: ref.subject, id: ref.id }) });
    },
  });
  const pollMs = useLivePollMs(liveKey(ref));
  return useQuery({
    ...api.chat.trip.thread.queryOptions(ref),
    enabled: signedIn && Boolean(ref.id),
    refetchInterval: (q) => (q.state.data?.status === 'closed' ? false : pollMs),
    staleTime: 0,
  });
}

/** His threads on one run or request (the drivers of a private-car request), for the unread badges. */
export function useTripChatThreads(subject: TripChatSubject, id: string | undefined, enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.chat.trip.threads.queryOptions({ subject, id: id ?? '' }),
    enabled: signedIn && enabled && Boolean(id),
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useTripChatActions(ref: TripChatRef) {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: api.chat.trip.thread.queryKey(ref) }),
      qc.invalidateQueries({ queryKey: api.chat.trip.threads.queryKey({ subject: ref.subject, id: ref.id }) }),
    ]);
  return {
    send: useMutation({ ...api.chat.trip.send.mutationOptions(), onSuccess: () => void refresh() }),
    markRead: useMutation({ ...api.chat.trip.markRead.mutationOptions(), onSuccess: () => void qc.invalidateQueries({ queryKey: api.chat.trip.threads.queryKey({ subject: ref.subject, id: ref.id }) }) }),
    refresh,
  };
}
