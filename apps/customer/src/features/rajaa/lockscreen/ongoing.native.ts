import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PassCard } from './content';
import type { OngoingLabels, OngoingPassDevice } from './ongoing';

export type { OngoingLabels, OngoingPassDevice } from './ongoing';

/**
 * Android ongoing notification for the الرجعة boarding pass (customer audit d-8): its own quiet
 * channel (updates don't ring), shown on the lock screen with time, garage, seat and PIN, sticky
 * while the trip is live, an "أني بالكراج" action, replaced in place as the trip moves on, and a
 * dismissible "وصلت بالسلامة" at the end. iOS gets nothing here (Live Activity: follow-up).
 */
const CHANNEL = 'rajaa_pass';
const CATEGORY: Record<'garage' | 'point', string> = { garage: 'rajaa_pass_garage', point: 'rajaa_pass_point' };
const IM_HERE = 'im_here';
const android = Platform.OS === 'android';
let ready: Promise<boolean> | null = null;

async function granted(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).status === Notifications.PermissionStatus.GRANTED;
}

function setup(labels: OngoingLabels): Promise<boolean> {
  ready ??= (async () => {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: labels.channel,
      description: labels.channelDesc,
      importance: Notifications.AndroidImportance.LOW,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: false,
      showBadge: false,
    });
    await Notifications.setNotificationCategoryAsync(CATEGORY.garage, [{ identifier: IM_HERE, buttonTitle: labels.imHereGarage, options: { opensAppToForeground: true } }]);
    await Notifications.setNotificationCategoryAsync(CATEGORY.point, [{ identifier: IM_HERE, buttonTitle: labels.imHerePoint, options: { opensAppToForeground: true } }]);
    return true;
  })().catch(() => {
    ready = null;
    return false;
  });
  return ready;
}

function content(card: PassCard): Notifications.NotificationContentInput {
  return {
    title: card.title,
    body: card.body,
    // Android shows `subtitle` as the sub text next to the app name: the countdown or the car.
    ...(card.sub ? { subtitle: card.sub } : {}),
    data: { kind: 'rajaa_pass', bookingId: card.bookingId, deepLink: card.deepLink },
    sticky: card.sticky,
    autoDismiss: !card.sticky,
    priority: Notifications.AndroidNotificationPriority.LOW,
    ...(card.imHere ? { categoryIdentifier: CATEGORY[card.imHere] } : {}),
  };
}

export const ongoingPass: OngoingPassDevice = {
  supported: android,
  async show(card, labels) {
    if (!android || !(await granted()) || !(await setup(labels))) return;
    await Notifications.scheduleNotificationAsync({ identifier: card.id, content: content(card), trigger: { channelId: CHANNEL } }).catch(() => undefined);
  },
  async schedule(card, at, labels) {
    if (!android || !(await granted()) || !(await setup(labels))) return;
    await Notifications.cancelScheduledNotificationAsync(card.id).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: card.id,
      content: content(card),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
    }).catch(() => undefined);
  },
  async dismiss(id) {
    if (!android) return;
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
    await Notifications.dismissNotificationAsync(id).catch(() => undefined);
  },
  onImHere(cb) {
    if (!android) return () => undefined;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = (r.notification.request.content.data ?? {}) as { kind?: string; bookingId?: string };
      if (r.actionIdentifier === IM_HERE && data.kind === 'rajaa_pass' && data.bookingId) cb(data.bookingId);
    });
    return () => sub.remove();
  },
};
