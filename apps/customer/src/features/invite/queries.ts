import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** My invite code, the rule in numbers and how my invitations are going (`referral.mine`). */
export function useInvite() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.referral.mine.queryOptions(), enabled: signedIn });
}

/** The invite rule alone (`referral.rule`, public): is the invite reward switched on? */
export function useInviteRule() {
  const api = useApi();
  return useQuery({ ...api.referral.rule.queryOptions(), staleTime: 30 * 60_000 });
}

/** The landing page's greeting before sign-in (`referral.preview`, public). */
export function useInvitePreview(code: string | null) {
  const api = useApi();
  return useQuery({ ...api.referral.preview.queryOptions({ code: code ?? '' }), enabled: Boolean(code), staleTime: 5 * 60_000 });
}

/** The friend accepts the invitation (once, before his first order). */
export function useClaimInvite() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.referral.claim.mutationOptions(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: api.referral.mine.queryKey() }),
  });
}
