import * as Notifications from 'expo-notifications';
import { t, type MessageKey } from '@driver/i18n';
import { MOMENT_DATA_KEY, MOMENT_SOUND_FILES, momentChannelId, type Cue } from './moment-sound';

/** One setup per cue per app run (setNotificationChannelAsync is idempotent, but not free). */
const channels = new Map<Cue, Promise<boolean>>();

function channel(cue: Cue): Promise<boolean> {
  let ready = channels.get(cue);
  if (!ready) {
    ready = Notifications.setNotificationChannelAsync(momentChannelId(cue), {
      name: t(`notify.channel.moment_${cue}` as MessageKey),
      description: t('notify.channel.moment_desc'),
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: MOMENT_SOUND_FILES[cue],
      enableVibrate: false,
    }).then(
      () => true,
      // No channel (old OS build, notifications blocked): this cue stays silent; try again next run.
      () => false,
    );
    channels.set(cue, ready);
  }
  return ready;
}

/**
 * Android (joy f7, L-24): play a moment through the ring stream so silent, vibrate and Do Not
 * Disturb keep it quiet. A local notification on the cue's channel, answered by the foreground
 * handler with "sound, no alert" (`momentBehavior`), makes expo-notifications play the channel
 * sound as a ringtone without posting anything. Resolves false when the sound could not be asked
 * for — the caller then stays silent (never the media stream, which ignores silent mode).
 */
export async function playOnRing(cue: Cue): Promise<boolean> {
  if (!(await channel(cue))) return false;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: '', data: { [MOMENT_DATA_KEY]: cue }, sound: MOMENT_SOUND_FILES[cue] },
      trigger: { channelId: momentChannelId(cue) },
    });
    return true;
  } catch {
    // Scheduling refused (e.g. notifications denied on Android 13+): the moment still shows and buzzes.
    return false;
  }
}
