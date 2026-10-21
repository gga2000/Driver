import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { StaffChange } from '@driver/contracts';
import type { HeaderAlert } from '@/features/store/StoreHeader';
import { useCurrentStore } from '@/features/store/queries';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';
import { storage } from '@/lib/storage';
import { markSeen, parseSeen, STAFF_SEEN_KEY, unseenChanges, type SeenMap } from './logic';

/**
 * What Driver's team changed at the store from the Console (Ali, 2026-10-21: "change now, tell the
 * owner"). The owner's only: staff never ask (the server refuses them too). Re-read every 5 minutes.
 */
export function useStaffChanges(merchantOrgId: string | null, owner: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchantAdmin.staffChanges.queryOptions({ merchantOrgId: merchantOrgId ?? '', limit: 50 }),
    enabled: signedIn && owner && !!merchantOrgId,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
}

/** The newest change each store's owner has seen on this device, kept across reloads. */
let seen: SeenMap = {};
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

async function load() {
  if (loaded) return;
  loaded = true;
  const raw = await storage.getItem(STAFF_SEEN_KEY).catch(() => null);
  seen = { ...parseSeen(raw), ...seen };
  emit();
}

export function useStaffSeen(): { seen: SeenMap; see: (merchantOrgId: string, rows: readonly StaffChange[]) => void } {
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
    () => seen,
    () => seen,
  );
  const see = useCallback((merchantOrgId: string, rows: readonly StaffChange[]) => {
    const next = markSeen(seen, merchantOrgId, rows);
    if (next[merchantOrgId] === seen[merchantOrgId]) return;
    seen = next;
    emit();
    void storage.setItem(STAFF_SEEN_KEY, JSON.stringify(seen)).catch(() => undefined);
  }, []);
  return { seen: value, see };
}

/** The board header's «فريقنا عدّل بمحلك» chip: the owner's, while there are changes he hasn't opened. */
export function useStaffChangesAlert(): HeaderAlert | null {
  const t = useT();
  const { store, canSeeMoney: owner } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const changes = useStaffChanges(storeId, owner);
  const { seen: marks } = useStaffSeen();
  if (!owner || !storeId || !changes.data) return null;
  const fresh = unseenChanges(changes.data, marks[storeId], Date.now());
  if (fresh.length === 0) return null;
  return { key: 'staff-changes', testID: 'staff-changes-chip', icon: 'store', tone: 'accent', dot: true, label: t('merchant.staff_changes.chip', { n: fresh.length }), onPress: () => router.push('/staff-changes') };
}
