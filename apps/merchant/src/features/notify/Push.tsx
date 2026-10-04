import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Button, Icon, Text, useTheme } from '@driver/ui';
import { useApiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';
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

/** "لا يفوتك طلب": the pre-prompt on the orders board, then the OS prompt. */
export function PrePromptGate({ active }: { active: boolean }) {
  const theme = useTheme();
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.space[5] }}>
        <Pressable accessibilityLabel={t('notify.preprompt.later')} onPress={close} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(15, 18, 22, 0.5)' }} />
        <View testID="push-preprompt" style={{ width: '100%', maxWidth: 440, backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: theme.space[6], gap: theme.space[4] }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
            <Icon name="bell" size={30} color="accentText" />
          </View>
          <Text variant="heading" align="center" accessibilityRole="header">
            {t('notify.preprompt.merchant_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('notify.preprompt.merchant_body')}
          </Text>
          <Button testID="push-preprompt-allow" label={t('notify.preprompt.allow')} size="lg" fullWidth loading={busy} onPress={() => void allow()} />
          <Button testID="push-preprompt-later" label={t('notify.preprompt.later')} variant="ghost" size="lg" fullWidth onPress={close} />
        </View>
      </View>
    </Modal>
  );
}
