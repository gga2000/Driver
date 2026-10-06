import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { storage } from '@/lib/storage';
import { addDismissed, DAY_DISMISSED_KEY, parseDismissed } from './logic';

/**
 * The day's summary (S-M6) for the store on the board: owner and staff (the net is the owner's).
 * Re-read every 5 minutes and whenever the store's open state changes (`openKey`), so the card comes
 * up at close and at 00:30 by itself.
 */
export function useDaySummary(merchantOrgId: string | null, openKey: string) {
  const api = useApi();
  const signedIn = useSignedIn();
  const q = useQuery({
    ...api.merchantAdmin.daySummary.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const { refetch } = q;
  const enabled = signedIn && !!merchantOrgId;
  useEffect(() => {
    if (enabled) void refetch();
  }, [openKey, enabled, refetch]);
  return q;
}

/** Which days' cards this device has closed with "تمام", kept across reloads. */
let dismissed: readonly string[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

async function load() {
  if (loaded) return;
  loaded = true;
  const raw = await storage.getItem(DAY_DISMISSED_KEY).catch(() => null);
  dismissed = [...new Set([...parseDismissed(raw), ...dismissed])];
  emit();
}

export function useDayDismissed(): { dismissed: readonly string[]; dismiss: (key: string) => void } {
  useEffect(() => {
    void load();
  }, []);
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => dismissed,
    () => dismissed,
  );
  const dismiss = useCallback((key: string) => {
    dismissed = addDismissed(dismissed, key);
    emit();
    void storage.setItem(DAY_DISMISSED_KEY, JSON.stringify(dismissed)).catch(() => undefined);
  }, []);
  return { dismissed: value, dismiss };
}
