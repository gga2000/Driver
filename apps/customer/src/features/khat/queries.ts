import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { BUS_POLL_MS } from './bus';

/**
 * «وين الباص» (map idea N14): today's run of one of the guardian's own children, read again every
 * ~10 s while the screen is open. Null when the child has no run today.
 */
export function useGuardianRun(childRef: string | undefined) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.khat.guardian.run.queryOptions({ childRef: childRef ?? '' }),
    enabled: signedIn && !!childRef,
    refetchInterval: BUS_POLL_MS,
  });
}
