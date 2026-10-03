import { useEffect, useRef } from 'react';
import type { PartnerStatus } from '@driver/contracts';
import { useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { currentFix, FALLBACK_FIX, type Fix } from '@/lib/location';
import { useGoOffline, useGoOnline } from './queries';

/** Presence lives 90 s in the dispatch index; the app refreshes it well inside that. */
export const HEARTBEAT_MS = 30_000;

/** Best position we have: GPS, else where the server last saw him, else the town centre. */
export async function bestFix(status: PartnerStatus | undefined): Promise<Fix> {
  return (await currentFix(4000)) ?? status?.position ?? FALLBACK_FIX;
}

/**
 * Online/offline for the home switch, plus the heartbeat that keeps him in the dispatch index
 * while the app is open (`partner.goOnline` is idempotent: same zone keeps its anti-camping clock).
 * TODO(background-location): a background task takes over the heartbeat when the app is closed.
 */
export function usePresence(status: PartnerStatus | undefined) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const on = useGoOnline();
  const off = useGoOffline();
  const statusRef = useRef(status);
  statusRef.current = status;

  const online = status?.online ?? false;
  useEffect(() => {
    if (!online) return;
    const id = setInterval(() => {
      const s = statusRef.current;
      void bestFix(s).then((at) => on.mutateAsync({ at, ...(s?.vehicleClass ? { vehicleClass: s.vehicleClass } : {}) }).catch(() => undefined));
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const goOnline = async () => {
    try {
      const at = await bestFix(status);
      await on.mutateAsync({ at, ...(status?.vehicleClass ? { vehicleClass: status.vehicleClass } : {}) });
      toast.show({ message: t('partner.went_online'), tone: 'success', icon: 'check' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  const goOffline = async () => {
    try {
      await off.mutateAsync({});
      toast.show({ message: t('partner.went_offline'), tone: 'neutral' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return { goOnline, goOffline, busy: on.isPending || off.isPending };
}
