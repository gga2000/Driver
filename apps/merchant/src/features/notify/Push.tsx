import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useApiClient } from '@/lib/api';
import { pushDevice } from '@/lib/push';
import { useSignedIn } from '@/lib/session';
import { storage } from '@/lib/storage';
import { deepLinkPath, PREPROMPT_KEY, shouldShowPrePrompt } from './prompt';

let registeredToken: string | null = null;
const listeners = new Set<() => void>();

/**
 * Root hook (signed in): Android channels (new orders ring loud on `offers` with `offer.wav`), this
 * install's Expo push token registered for the session, foreground acks (so the SMS twin of a new
 * order is not sent), taps → the screen.
 */
export function usePushRegistration(): void {
  const client = useApiClient();
  const signedIn = useSignedIn();
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const register = async () => {
      await pushDevice.setupChannels().catch(() => undefined);
      const tok = await pushDevice.token().catch(() => null);
      if (!tok || cancelled) return;
      await client.notify.registerDevice.mutate({ token: tok.token, kind: tok.kind, app: 'merchant', platform: tok.platform, appVersion: Constants.expoConfig?.version ?? undefined }).catch(() => undefined);
      registeredToken = tok.token;
    };
    void register();
    const again = () => void register();
    listeners.add(again);
    const offReceive = pushDevice.onReceive((data) => {
      if (typeof data.deliveryId === 'string') void client.notify.ack.mutate({ deliveryId: data.deliveryId, opened: false }).catch(() => undefined);
    });
    const offOpen = pushDevice.onOpen((data) => {
      if (typeof data.deliveryId === 'string') void client.notify.ack.mutate({ deliveryId: data.deliveryId, opened: true }).catch(() => undefined);
      const path = deepLinkPath(data.deepLink);
      if (path) router.navigate(path as never);
    });
    return () => {
      cancelled = true;
      listeners.delete(again);
      offReceive();
      offOpen();
    };
  }, [client, signedIn]);
}

export async function unregisterPush(client: ReturnType<typeof useApiClient>): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (token) await client.notify.unregisterDevice.mutate({ token }).catch(() => undefined);
}

/**
 * "خلّي التابلت يرن حتى لو التطبيق مسكّر" (M-03): whether the board may show its notification strip,
 * and its two answers. `active` is the board being calm (nothing waiting, no sheet, shift started) —
 * it is never a modal over a ringing board. "شغّلها" opens the OS prompt; "بعدين" waits a week.
 */
export function usePushPrompt(active: boolean): { visible: boolean; busy: boolean; allow: () => void; later: () => void } {
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const permission = await pushDevice.permission().catch(() => 'undetermined' as const);
      const raw = await storage.getItem(PREPROMPT_KEY);
      const last = raw ? Number(raw) : null;
      if (!cancelled) setEligible(shouldShowPrePrompt(permission, Number.isFinite(last) ? last : null, Date.now()));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const later = () => {
    setEligible(false);
    void storage.setItem(PREPROMPT_KEY, String(Date.now()));
  };
  const allow = async () => {
    setBusy(true);
    await pushDevice.request().catch(() => 'denied');
    for (const l of listeners) l();
    setBusy(false);
    later();
  };
  return { visible: eligible && active, busy, allow: () => void allow(), later };
}
