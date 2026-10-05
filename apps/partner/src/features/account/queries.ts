import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EarningsPeriod } from '@driver/contracts';
import { usePartnerGate } from '@/features/work/queries';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * `driverAccount.*` hooks: earnings + the hand-over code, scorecard, documents, the daily check-in
 * and the online gate. Every read is the signed-in driver's own.
 */

function useEnabled(): boolean {
  const signedIn = useSignedIn();
  const gate = usePartnerGate();
  return signedIn && gate === 'allowed';
}

/** One period of earnings; the previous page stays on screen while the next one loads. */
export function useEarnings(period: EarningsPeriod, anchor: Date | null, opts: { enabled?: boolean } = {}) {
  const api = useApi();
  const enabled = useEnabled() && (opts.enabled ?? true);
  return useQuery({
    ...api.driverAccount.earnings.queryOptions(anchor ? { period, anchor } : { period }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: anchor ? false : 30_000,
  });
}

export function useHandoverCode(enabled: boolean) {
  const api = useApi();
  return useQuery({ ...api.driverAccount.handoverCode.queryOptions(), enabled: useEnabled() && enabled, staleTime: 60_000 });
}

export function useScorecard() {
  const api = useApi();
  return useQuery({ ...api.driverAccount.scorecard.queryOptions({}), enabled: useEnabled(), staleTime: 60_000 });
}

export function useDocuments() {
  const api = useApi();
  return useQuery({ ...api.driverAccount.documents.queryOptions({}), enabled: useEnabled() });
}

export function useCheckInStatus() {
  const api = useApi();
  return useQuery({ ...api.driverAccount.checkInStatus.queryOptions(), enabled: useEnabled() });
}

/** After a document, a check-in or a lock-out the home switch must re-read its gate. */
export function useRefreshAccount() {
  const api = useApi();
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: api.driverAccount.documents.queryKey() }),
      qc.invalidateQueries({ queryKey: api.driverAccount.checkInStatus.queryKey() }),
      qc.invalidateQueries({ queryKey: api.driverAccount.onlineGate.queryKey() }),
      qc.invalidateQueries({ queryKey: api.partner.status.queryKey() }),
    ]);
}

// ── Phase 3 money moments (audit S-4, S-7) and the emergency contact ──

/** The shift he just ended (`from` = when it started, from `partner.status.onlineSince`). */
export function useShiftSummary(from: Date | null) {
  const api = useApi();
  return useQuery({ ...api.driverAccount.shiftSummary.queryOptions(from ? { from } : {}), enabled: useEnabled(), staleTime: 60_000 });
}

/** One job's receipt: every line with its reason, the take, the cash. */
export function useJobReceipt(key: string, at: Date | null) {
  const api = useApi();
  return useQuery({ ...api.driverAccount.jobReceipt.queryOptions({ key, at: at ?? new Date(0) }), enabled: useEnabled() && Boolean(key) && at !== null, staleTime: 60_000, retry: 1 });
}

/** "عندي اعتراض": opens the support ticket, then the receipt re-reads (it now says it is with support). */
export function usePayQuery() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.driverAccount.payQuery.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: api.driverAccount.jobReceipt.queryKey() }),
  });
}

/** Name, relation and number of the emergency contact → the identity vault (`identity.updateProfile`). */
export function useUpdateEmergencyContact() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.identity.updateProfile.mutationOptions(),
    onSuccess: (me) => qc.setQueryData(api.identity.me.queryKey(), me),
  });
}

export function useAccountMutations() {
  const api = useApi();
  return {
    ticket: useMutation(api.places.photoUpload.mutationOptions()),
    uploadDocument: useMutation(api.driverAccount.uploadDocument.mutationOptions()),
    challenge: useMutation(api.driverAccount.checkInChallenge.mutationOptions()),
    submitCheckIn: useMutation(api.driverAccount.submitCheckIn.mutationOptions()),
  };
}
