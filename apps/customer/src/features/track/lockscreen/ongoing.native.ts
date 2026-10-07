import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { themes } from '@driver/design-tokens';
import type { LiveNoticeCard } from './content';
import type { LiveNoticeDevice, LiveNoticeLabels } from './ongoing';

export type { LiveNoticeDevice, LiveNoticeLabels } from './ongoing';

/**
 * Android ongoing notification for a live order or ride (joy l1, supersedes maps c8 on Android): its
 * own quiet channel «تتبع الطلب» (low importance — updates never ring or buzz), public on the lock
 * screen, sticky while the order is live, replaced in place as it moves, a dismissible end card. iOS
 * gets nothing here (Live Activity designed in the J5b plan). Needs a development build: Expo Go and
 * the web have no ongoing notifications.
 */
const CHANNEL = 'live_order';
/** Marks our own card in `data`, so the foreground handler lists it without a banner or a sound. */
export const LIVE_NOTICE_KIND = 'live_order';
const android = Platform.OS === 'android';
/** Order pushes worth a re-read at once (the server's status messages to the customer). */
const ORDER_TEMPLATES = new Set(['order_accepted', 'order_prep_extended', 'order_late_apology', 'order_picked_up', 'courier_arriving', 'order_receipt', 'ride_matched', 'driver_arrived', 'ride_receipt']);
let ready: Promise<boolean> | null = null;

async function granted(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).status === Notifications.PermissionStatus.GRANTED;
}

function setup(labels: LiveNoticeLabels): Promise<boolean> {
  ready ??= Notifications.setNotificationChannelAsync(CHANNEL, {
    name: labels.channel,
    description: labels.channelDesc,
    importance: Notifications.AndroidImportance.LOW,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    enableVibrate: false,
    showBadge: false,
  }).then(
    () => true,
    // No channel (notifications blocked, old build): no card this run; try again next time.
    () => {
      ready = null;
      return false;
    },
  );
  return ready;
}

export const liveNotice: LiveNoticeDevice = {
  supported: android,
  async show(card: LiveNoticeCard, labels: LiveNoticeLabels) {
    if (!android || !(await granted()) || !(await setup(labels))) return;
    await Notifications.scheduleNotificationAsync({
      identifier: card.id,
      content: {
        title: card.title,
        body: card.body,
        // Android shows `subtitle` as the sub text next to the app name: the steps as dots.
        ...(card.sub ? { subtitle: card.sub } : {}),
        data: { kind: LIVE_NOTICE_KIND, orderId: card.orderId, deepLink: card.deepLink },
        sticky: card.sticky,
        autoDismiss: !card.sticky,
        sound: false,
        color: themes.istikan.live,
        priority: Notifications.AndroidNotificationPriority.LOW,
      },
      trigger: { channelId: CHANNEL },
    }).catch(() => undefined);
  },
  async dismiss(id) {
    if (!android) return;
    await Notifications.dismissNotificationAsync(id).catch(() => undefined);
  },
  onOrderPush(cb) {
    if (!android) return () => undefined;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const data = (n.request.content.data ?? {}) as { template?: unknown; orderId?: unknown; kind?: unknown };
      if (data.kind === LIVE_NOTICE_KIND || typeof data.template !== 'string' || !ORDER_TEMPLATES.has(data.template)) return;
      cb(typeof data.orderId === 'string' ? data.orderId : null);
    });
    return () => sub.remove();
  },
};
