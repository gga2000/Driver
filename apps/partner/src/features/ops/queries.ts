import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * Ops mode hooks over `ops.*`. Tasks and cash holders refresh every 30 s (couriers' cash moves all
 * day); a completed task or a recorded receipt refreshes both at once.
 */

export const OPS_POLL_MS = 30_000;
export const CITY_ID = 'aziziyah';

export function useOpsTasks() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.ops.myTasks.queryOptions({ cityId: CITY_ID }), enabled: signedIn, refetchInterval: OPS_POLL_MS });
}

export function useCashHolders() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.ops.cashHolders.queryOptions({ cityId: CITY_ID }), enabled: signedIn, refetchInterval: OPS_POLL_MS });
}

export function useLandmarks(zoneKey: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.ops.landmarks.queryOptions({ cityId: CITY_ID, zoneKey: zoneKey ?? undefined }), enabled: signedIn && zoneKey !== null });
}

function useInvalidateOps() {
  const api = useApi();
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: api.ops.myTasks.queryKey() }),
      qc.invalidateQueries({ queryKey: api.ops.cashHolders.queryKey() }),
      qc.invalidateQueries({ queryKey: api.ops.landmarks.queryKey() }),
    ]);
}

export function useCompleteTask() {
  const api = useApi();
  const invalidate = useInvalidateOps();
  return useMutation({ ...api.ops.completeTask.mutationOptions(), onSuccess: () => void invalidate() });
}

export function useRecordCashReceipt() {
  const api = useApi();
  const invalidate = useInvalidateOps();
  return useMutation({ ...api.ops.recordCashReceipt.mutationOptions(), onSuccess: () => void invalidate() });
}

export function useAddLandmarkPhoto() {
  const api = useApi();
  const invalidate = useInvalidateOps();
  return useMutation({ ...api.ops.addLandmarkPhoto.mutationOptions(), onSuccess: () => void invalidate() });
}

export function useMerchantOnboarding() {
  const api = useApi();
  const invalidate = useInvalidateOps();
  return useMutation({ ...api.ops.merchantOnboarding.mutationOptions(), onSuccess: () => void invalidate() });
}
