import { useEffect, useRef } from 'react';
import type { PartnerStatus } from '@driver/contracts';
import { useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { DEV_TOOLS } from '@/lib/env';
import { currentFix, DEMO_FIX, lastRealFix } from '@/lib/location';
import { useGoOffline, useGoOnline } from './queries';

/** Presence lives 90 s in the dispatch index; the app refreshes it well inside that. */
export const HEARTBEAT_MS = 30_000;

/**
 * The position to go online with: a fresh GPS fix, else the last real one this session (a heartbeat
 * re-sends it rather than inventing one). Only dev/demo web builds (`DEV_TOOLS`, desktop browsers
 * without GPS) fall back to the demo position; production never does (maps program SP4a).
 */
export async function bestFix(): Promise<{ lat: number; lng: number } | null> {
  const fix = (await currentFix(4000)) ?? lastRealFix();
  if (fix) return { lat: fix.lat, lng: fix.lng };
  return DEV_TOOLS ? { ...DEMO_FIX } : null;
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
      // No fix at all: skip this beat rather than report a made-up place (presence lapses after 90 s).
      void bestFix().then((at) => (at ? on.mutateAsync({ at, ...(s?.vehicleClass ? { vehicleClass: s.vehicleClass } : {}) }) : undefined)).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const goOnline = async () => {
    try {
      const at = await bestFix();
      if (!at) {
        toast.show({ message: t('partner.location_needed'), tone: 'warning' });
        return;
      }
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
