import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** Fees and zones change rarely; the server keeps the view a few minutes too (DELIVERY_AREA_CACHE_MS). */
const AREA_STALE_MS = 5 * 60_000;

/** `merchant.deliveryArea` (owner and staff): zones with the server's fee from this kitchen (maps r5). */
export function useDeliveryArea(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchant.deliveryArea.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    staleTime: AREA_STALE_MS,
  });
}

/** `merchant.customerZones` (owner and staff): delivered orders per area, small zones hidden (maps r6). */
export function useCustomerZones(merchantOrgId: string | null, days: number) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchant.customerZones.queryOptions({ merchantOrgId: merchantOrgId ?? '', days }),
    enabled: signedIn && !!merchantOrgId,
    staleTime: AREA_STALE_MS,
    placeholderData: (prev) => prev,
  });
}
