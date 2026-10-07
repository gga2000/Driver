import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import type { CallSession } from '@driver/contracts';
import { ltr, telUrl, useToast } from '@driver/ui';
import { CALLS_LIVE } from '@/features/chat/calls';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * A masked call from a run (الرجعة rider, خطوط guardian): the API opens the bridge, the phone dials
 * the platform number (a development API hands back the real number and says so), and the toast
 * names who we connect him with. The web only shows the toast (a browser can't place the call).
 */
export function useRunCall() {
  const toast = useToast();
  const t = useT();
  const locale = useLocale();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const call = async (key: string, who: string, request: () => Promise<CallSession>) => {
    if (busyKey) return;
    // G0-10 «Chat first»: no calls at launch; numbers stay hidden.
    if (!CALLS_LIVE) {
      toast.show({ message: t('partner.call_soon_run'), tone: 'info', icon: 'phone' });
      return;
    }
    setBusyKey(key);
    try {
      const s = await request();
      const base = t('chat.call_connecting', { role: who });
      toast.show({ message: s.mode === 'dev_direct' ? `${base} · ${t('chat.call_dev')} ${ltr(s.dial)}` : base, tone: 'info', icon: 'phone' }, 5000);
      if (Platform.OS !== 'web') await Linking.openURL(telUrl(s.dial)).catch(() => undefined);
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning', icon: 'phone' }, 5000);
    } finally {
      setBusyKey(null);
    }
  };
  return { call, busyKey, soon: !CALLS_LIVE };
}
