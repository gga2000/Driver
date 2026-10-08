import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { PermissionPrompt } from '@driver/ui';
import { useApi, useApiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { pushDevice } from '@/lib/push';
import { useSignedIn } from '@/lib/session';
import { storage } from '@/lib/storage';
import { deepLinkPath, isOfferPush, PREPROMPT_KEY, shouldShowPrePrompt } from './prompt';

let registeredToken: string | null = null;
const listeners = new Set<() => void>();

/**
 * Root hook (signed in): Android channels (offers ring loud with `offer.wav`), this install's Expo
 * push token registered for the session, foreground acks (no SMS twin), taps → the screen.
 */
export function usePushRegistration(): void {
  const client = useApiClient();
  const api = useApi();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const register = async () => {
      await pushDevice.setupChannels().catch(() => undefined);
      const tok = await pushDevice.token().catch(() => null);
      if (!tok || cancelled) return;
      await client.notify.registerDevice.mutate({ token: tok.token, kind: tok.kind, app: 'partner', platform: tok.platform, appVersion: Constants.expoConfig?.version ?? undefined }).catch(() => undefined);
      registeredToken = tok.token;
    };
    void register();
    const again = () => void register();
    listeners.add(again);
    const offReceive = pushDevice.onReceive((data) => {
      // An offer push in the foreground: the live stream may be silently dead, so show the offer now.
      if (isOfferPush(data)) void qc.invalidateQueries(api.partner.currentOffer.pathFilter());
      if (typeof data.deliveryId === 'string') void client.notify.ack.mutate({ deliveryId: data.deliveryId, opened: false }).catch(() => undefined);
    });
    const offOpen = pushDevice.onOpen((data) => {
      if (typeof data.deliveryId === 'string') void client.notify.ack.mutate({ deliveryId: data.deliveryId, opened: true }).catch(() => undefined);
      const path = deepLinkPath(data.deepLink);
      if (path) router.push(path as never);
    });
    return () => {
      cancelled = true;
      listeners.delete(again);
      offReceive();
      offOpen();
    };
  }, [client, api, qc, signedIn]);
}

export async function unregisterPush(client: ReturnType<typeof useApiClient>): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (token) await client.notify.unregisterDevice.mutate({ token }).catch(() => undefined);
}

/** "لا يفوتك طلب": the pre-prompt on the work home, then the OS prompt. */
export function PrePromptGate({ active }: { active: boolean }) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      const permission = await pushDevice.permission().catch(() => 'undetermined' as const);
      const raw = await storage.getItem(PREPROMPT_KEY);
      const last = raw ? Number(raw) : null;
      if (!cancelled && shouldShowPrePrompt(permission, Number.isFinite(last) ? last : null, Date.now())) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  const close = () => {
    setVisible(false);
    void storage.setItem(PREPROMPT_KEY, String(Date.now()));
  };
  const allow = async () => {
    setBusy(true);
    await pushDevice.request().catch(() => 'denied');
    for (const l of listeners) l();
    setBusy(false);
    close();
  };

  return (
    <PermissionPrompt
      visible={visible}
      icon="bell"
      title={t('notify.preprompt.partner_title')}
      body={t('notify.preprompt.partner_body')}
      allowLabel={t('notify.preprompt.allow')}
      laterLabel={t('notify.preprompt.later')}
      busy={busy}
      onAllow={() => void allow()}
      onLater={close}
    />
  );
}
