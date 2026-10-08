import type { ChatThreadKind } from '@driver/contracts';
import { useMaskedCall as useSharedMaskedCall, useToast } from '@driver/ui';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * Calls between customer and courier or driver are not live at launch (G0-10, Ali 2026-10-07: "chat
 * first"; phone numbers stay hidden, in-app internet calls come after launch). Every call button shows
 * greyed with «قريباً» and a tap points to the chat. Flip this when in-app calls ship.
 */
export const CALLS_LIVE = false;

/**
 * Masked call to the other party of a thread (`chat.requestCall`); see `useMaskedCall` in @driver/ui.
 * While calls aren't live, `call` explains that and offers `openChat` (none inside the chat itself).
 */
export function useMaskedCall(orderId: string, kind: ChatThreadKind, ride: boolean, opts: { openChat?: () => void } = {}) {
  const client = useApiClient();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const masked = useSharedMaskedCall({
    request: () => client.chat.requestCall.mutate({ orderId, kind }),
    enabled: Boolean(orderId) && CALLS_LIVE,
    ride,
    t,
    errorMessage: (err, fallback) => apiErrorMessage(err, fallback, locale),
  });
  if (CALLS_LIVE) return { ...masked, live: true as boolean };
  const { openChat } = opts;
  const soon = async () => {
    toast.show(
      openChat
        ? { message: t('call.soon_toast'), tone: 'info', icon: 'phone', action: { label: t('call.soon_action'), onPress: openChat } }
        : { message: t('call.soon_toast_in_chat'), tone: 'info', icon: 'phone' },
    );
  };
  return { call: soon, busy: false, live: false as boolean };
}
