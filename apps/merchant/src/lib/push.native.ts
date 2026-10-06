import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { ANDROID_CHANNELS } from '@driver/contracts';
import { t } from '@driver/i18n';
import type { PushData, PushDevice, PushPermission, PushToken } from './push';

export type { PushData, PushDevice, PushPermission, PushToken } from './push';

/**
 * Foreground notifications still show. A new order rings on the `offers` channel (loud, custom
 * `offer.wav`) even with the app closed; the board's own alert sound covers the open app.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const APP = 'merchant';

function mapStatus(status: Notifications.PermissionStatus): PushPermission {
  return status === Notifications.PermissionStatus.GRANTED ? 'granted' : status === Notifications.PermissionStatus.DENIED ? 'denied' : 'undetermined';
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

const IMPORTANCE: Record<string, Notifications.AndroidImportance> = {
  MAX: Notifications.AndroidImportance.MAX,
  HIGH: Notifications.AndroidImportance.HIGH,
  DEFAULT: Notifications.AndroidImportance.DEFAULT,
  LOW: Notifications.AndroidImportance.LOW,
};

export const pushDevice: PushDevice = {
  async permission() {
    return mapStatus((await Notifications.getPermissionsAsync()).status);
  },
  async request() {
    return mapStatus((await Notifications.requestPermissionsAsync()).status);
  },
  async token(): Promise<PushToken | null> {
    if (mapStatus((await Notifications.getPermissionsAsync()).status) !== 'granted') return null;
    try {
      const id = projectId();
      const res = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined);
      return { token: res.data, kind: 'expo', platform: Platform.OS === 'ios' ? 'ios' : 'android' };
    } catch {
      // Simulators and builds without an EAS project id have no token: nothing to register.
      return null;
    }
  },
  async setupChannels() {
    if (Platform.OS !== 'android') return;
    for (const ch of Object.values(ANDROID_CHANNELS)) {
      if (!ch.apps.includes(APP)) continue;
      await Notifications.setNotificationChannelAsync(ch.id, {
        name: t(ch.nameKey),
        ...(ch.descriptionKey ? { description: t(ch.descriptionKey) } : {}),
        importance: IMPORTANCE[ch.importance] ?? Notifications.AndroidImportance.DEFAULT,
        sound: ch.sound === 'default' ? 'default' : ch.sound,
        ...(ch.vibrationPattern ? { vibrationPattern: [...ch.vibrationPattern] } : { enableVibrate: false }),
      });
    }
  },
  onReceive(cb) {
    const sub = Notifications.addNotificationReceivedListener((n) => cb((n.request.content.data ?? {}) as PushData));
    return () => sub.remove();
  },
  onOpen(cb) {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => cb((r.notification.request.content.data ?? {}) as PushData));
    return () => sub.remove();
  },
  async openSettings() {
    await Linking.openSettings();
  },
};
