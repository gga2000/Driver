import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** `merchantAdmin.insights` (owner and staff): prep honesty, rejections, ratings, peak hours, best sellers. */
export function useInsights(merchantOrgId: string | null, days: number) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchantAdmin.insights.queryOptions({ merchantOrgId: merchantOrgId ?? '', days }),
    enabled: signedIn && !!merchantOrgId,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}
