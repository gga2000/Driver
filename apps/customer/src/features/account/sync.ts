import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useApi, useApiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fromServerPlace, profile, toServerDraft, useProfile, type PlaceLabel } from '@/lib/profile';
import { useMe, useMyPlaces } from './queries';

const LOCAL_LABEL_KEY = {
  home: 'onboarding.place_label_home',
  work: 'onboarding.place_label_work',
  family: 'onboarding.place_label_family',
  other: 'onboarding.place_label_other',
} as const;

/**
 * Keeps the device profile in step with the server once signed in (mounted by the tabs layout):
 *  - `places.mine` → the device store (home header, deliver-to picker and checkout read it);
 *  - places saved on this device before they lived on the server are uploaded once
 *    (`clientRef: device:<id>` makes a retry harmless), then dropped from the device list;
 *  - a name typed on this device before `identity.updateProfile` existed goes to the vault;
 *  - the vault name is cached on the device for the greeting.
 */
export function useAccountSync(): void {
  const t = useT();
  const api = useApi();
  const client = useApiClient();
  const qc = useQueryClient();
  const prof = useProfile();
  const places = useMyPlaces();
  const me = useMe();
  const migrating = useRef(false);

  useEffect(() => {
    if (!prof.loaded || !places.data) return;
    const local = prof.places.filter((p) => !p.synced);
    if (local.length === 0 || migrating.current) {
      void profile.syncPlaces(places.data.map(fromServerPlace));
      return;
    }
    migrating.current = true;
    void (async () => {
      const migrated: Record<string, string> = {};
      for (const p of local) {
        try {
          const saved = await client.places.save.mutate(toServerDraft(p, (l: PlaceLabel) => t(LOCAL_LABEL_KEY[l])));
          migrated[p.id] = saved.id;
        } catch {
          // Keep it on the device; the next sync tries again.
        }
      }
      const fresh = await client.places.mine.query().catch(() => null);
      if (fresh) {
        qc.setQueryData(api.places.mine.queryKey(), fresh);
        await profile.syncPlaces(fresh.map(fromServerPlace), migrated);
      }
      migrating.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prof.loaded, places.data]);

  useEffect(() => {
    if (!prof.loaded || !me.data) return;
    if (!me.data.name && prof.name) {
      void client.identity.updateProfile
        .mutate({ name: prof.name })
        .then((next) => qc.setQueryData(api.identity.me.queryKey(), next))
        .catch(() => undefined);
    } else if (me.data.name && me.data.name !== prof.name) {
      void profile.setName(me.data.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prof.loaded, me.data?.name]);
}
