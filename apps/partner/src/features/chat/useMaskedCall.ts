import type { ChatThreadKind } from '@driver/contracts';
import { useMaskedCall as useSharedMaskedCall } from '@driver/ui';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/** Masked call to the other party of a thread (`chat.requestCall`); see `useMaskedCall` in @driver/ui. */
export function useMaskedCall(orderId: string, kind: ChatThreadKind, ride: boolean) {
  const client = useApiClient();
  const t = useT();
  const locale = useLocale();
  return useSharedMaskedCall({
    request: () => client.chat.requestCall.mutate({ orderId, kind }),
    enabled: Boolean(orderId),
    ride,
    t,
    errorMessage: (err, fallback) => apiErrorMessage(err, fallback, locale),
  });
}
