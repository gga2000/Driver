import { Linking, Platform } from 'react-native';
import type { ChatThreadKind } from '@driver/contracts';
import { ltr, useToast } from '@driver/ui';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { roleKey, telUrl } from './logic';
import { useState } from 'react';

/**
 * Masked call to the other party of a thread (`chat.requestCall`). Production dials the platform
 * number (the provider bridges the call, nobody sees a number); a development API hands back the
 * real number and says so. The web build only shows the toast (a browser cannot place the call).
 */
export function useMaskedCall(orderId: string, kind: ChatThreadKind, ride: boolean) {
  const client = useApiClient();
  const toast = useToast();
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);

  const call = async () => {
    if (busy || !orderId) return;
    setBusy(true);
    try {
      const s = await client.chat.requestCall.mutate({ orderId, kind });
      const who = t(roleKey(s.counterpart, ride));
      const message = s.mode === 'dev_direct' ? `${t('chat.call_connecting', { role: who })} · ${t('chat.call_dev')} ${ltr(s.dial)}` : t('chat.call_connecting', { role: who });
      toast.show({ message, tone: 'info', icon: 'phone' }, 5000);
      if (Platform.OS !== 'web') await Linking.openURL(telUrl(s.dial)).catch(() => undefined);
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning', icon: 'phone' }, 5000);
    } finally {
      setBusy(false);
    }
  };
  return { call, busy };
}
