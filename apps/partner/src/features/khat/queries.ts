import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * خطوط driver side (`khat.*`). Today's run polls every 10 s (absences reported by guardians, a
 * substitute run he accepted); substitute offers every 5 s while the screen is open (they ring for
 * minutes, not seconds). Mutations refresh the whole `khat` namespace.
 */

export const RUN_POLL_MS = 10_000;
export const SUBS_POLL_MS = 5_000;
export const KHAT_CITY = 'aziziyah';

export function useTodayRun() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.khat.todayRun.queryOptions({}), enabled: signedIn, refetchInterval: RUN_POLL_MS });
}

export function useSubstituteOffers() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.khat.substituteOffers.queryOptions({ cityId: KHAT_CITY }), enabled: signedIn, refetchInterval: SUBS_POLL_MS });
}

export function useKhatActions() {
  const api = useApi();
  const qc = useQueryClient();
  const opts = { onSettled: () => void qc.invalidateQueries({ queryKey: api.khat.pathKey() }) };
  return {
    tapIn: useMutation({ ...api.khat.tapIn.mutationOptions(), ...opts }),
    tapOut: useMutation({ ...api.khat.tapOut.mutationOptions(), ...opts }),
    reportAbsence: useMutation({ ...api.khat.reportAbsence.mutationOptions(), ...opts }),
    acceptSubstitute: useMutation({ ...api.khat.acceptSubstitute.mutationOptions(), ...opts }),
  };
}
