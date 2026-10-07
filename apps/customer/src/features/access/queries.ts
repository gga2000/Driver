import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** How often a waiting phone asks again while the app is open (the message says when it opens anyway). */
const WAITING_POLL_MS = 5 * 60_000;

/**
 * Customer waves (W5): my place in line. Signed-in only (guests browse and are asked to sign in at
 * checkout anyway). `open` once let in, for good, so it is asked rarely after that.
 */
export function useAccess() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.access.status.queryOptions(),
    enabled: signedIn,
    staleTime: 60_000,
    refetchInterval: (q) =>
      q.state.data && q.state.data.state !== 'open' ? WAITING_POLL_MS : false,
  });
}

/** True while this signed-in person may not place a food order yet (waiting, or no place to wait for). */
export function useWaitlisted(): boolean {
  const q = useAccess();
  return q.data !== undefined && q.data.state !== 'open';
}

/**
 * «صار دورك! هسه تگدر تطلب»: once, when this phone sees the person let in while the app is open (the
 * push or SMS says it when the app is closed).
 */
export function useAccessOpenedToast(show: (message: string) => void, message: string): void {
  const q = useAccess();
  const state = q.data?.state;
  const prev = useRef(state);
  useEffect(() => {
    if (prev.current && prev.current !== 'open' && state === 'open') show(message);
    prev.current = state;
  }, [state, show, message]);
}
