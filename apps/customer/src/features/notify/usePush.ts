import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import type { NotifyPreferences } from '@driver/contracts';
import { useApi, useApiClient } from '@/lib/api';
import { pushDevice, type PushPermission } from '@/lib/push';
import { useSignedIn } from '@/lib/session';
import { permissionSignal, pushRoute } from './prompt';
import type { PushData } from '@/lib/push';

/** The token this install registered for the current session (dropped on sign-out). */
let registeredToken: string | null = null;

/** Notifications already opened in this run: the listener and the launch read can both report one tap. */
const opened = new Set<string>();

/** One tap → its ack and its screen, once per notification. */
function openPush(client: ReturnType<typeof useApiClient>, id: string, data: PushData, currentPath: string | null): void {
  if (opened.has(id)) return;
  opened.add(id);
  if (typeof data.deliveryId === 'string') void client.notify.ack.mutate({ deliveryId: data.deliveryId, opened: true }).catch(() => undefined);
  const route = pushRoute(data.deepLink, currentPath);
  if (route?.how === 'push') router.push(route.path as never);
  else if (route) router.replace(route.path as never);
}

/**
 * Mounted once at the root while signed in: creates the Android channels, registers this install's
 * Expo push token for the session (again whenever the permission changes), acknowledges pushes that
 * arrive in the foreground (so no SMS twin follows) and opens the screen a tapped push points to.
 */
export function usePushRegistration(): void {
  const client = useApiClient();
  const signedIn = useSignedIn();
  const pathname = usePathname();
  const here = useRef<string | null>(pathname);
  here.current = pathname;

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const register = async () => {
      await pushDevice.setupChannels().catch(() => undefined);
      const tok = await pushDevice.token().catch(() => null);
      if (!tok || cancelled) return;
      await client.notify.registerDevice.mutate({ token: tok.token, kind: tok.kind, app: 'customer', platform: tok.platform, appVersion: Constants.expoConfig?.version ?? undefined }).catch(() => undefined);
      registeredToken = tok.token;
    };
    void register();
    const unsub = permissionSignal.subscribe(() => void register());
    const offReceive = pushDevice.onReceive((data) => {
      if (typeof data.deliveryId === 'string') void client.notify.ack.mutate({ deliveryId: data.deliveryId, opened: false }).catch(() => undefined);
    });
    const offOpen = pushDevice.onOpen((data, id) => openPush(client, id, data, here.current));
    return () => {
      cancelled = true;
      unsub();
      offReceive();
      offOpen();
    };
  }, [client, signedIn]);
}

/**
 * CORE-08: a push tapped while the app was closed opens its screen once the app has settled
 * (`settled`: signed in, and the sign-in guard has nothing left to redirect), so the guard never
 * replaces it. Read once per run.
 */
export function usePushLaunch(settled: boolean): void {
  const client = useApiClient();
  const pathname = usePathname();
  const done = useRef(false);
  useEffect(() => {
    if (!settled || done.current) return;
    done.current = true;
    void pushDevice
      .launchOpen()
      .then((tap) => {
        if (tap) openPush(client, tap.id, tap.data, pathname);
      })
      .catch(() => undefined);
  }, [settled, client, pathname]);
}

/** Sign-out: forget this install's token server-side (the API also drops it with the session). */
export async function unregisterPush(client: ReturnType<typeof useApiClient>): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (token) await client.notify.unregisterDevice.mutate({ token }).catch(() => undefined);
}

/** The OS permission, refreshed on demand (after the pre-prompt, on returning from settings). */
export function usePushPermission(): { permission: PushPermission | null; refresh: () => Promise<PushPermission>; ask: () => Promise<PushPermission> } {
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const refresh = useCallback(async () => {
    const p = await pushDevice.permission().catch(() => 'undetermined' as const);
    setPermission(p);
    return p;
  }, []);
  const ask = useCallback(async () => {
    const p = await pushDevice.request().catch(() => 'denied' as const);
    setPermission(p);
    permissionSignal.emit();
    return p;
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { permission, refresh, ask };
}

export function useNotifyPreferences() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.notify.preferences.queryOptions(), enabled: signedIn });
}

/** Optimistic: the switch moves at once and rolls back if the save fails. */
export function useSetNotifyPreferences() {
  const api = useApi();
  const qc = useQueryClient();
  const key = api.notify.preferences.queryKey();
  return useMutation(
    api.notify.setPreferences.mutationOptions({
      onMutate: async (patch) => {
        await qc.cancelQueries({ queryKey: key });
        const before = qc.getQueryData<NotifyPreferences>(key);
        if (before) qc.setQueryData<NotifyPreferences>(key, { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
        return { before };
      },
      onError: (_err, _patch, ctx) => {
        if (ctx?.before) qc.setQueryData(key, ctx.before);
      },
      onSuccess: (next) => {
        qc.setQueryData(key, next);
      },
    }),
  );
}
