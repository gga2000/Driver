/**
 * Moment sounds that respect a silent phone (joy f7, finding L-24). Pure: runs in Node tests.
 *
 * iOS: expo-av with `playsInSilentModeIOS: false` already goes quiet on the silent switch.
 * Android: expo-av plays on the media stream, which ignores silent and vibrate. Instead each cue is a
 * local notification on its own channel (`moment_<cue>`, the cue's wav as the channel sound) that
 * the foreground handler answers with "no alert, play the sound". expo-notifications then plays the
 * channel sound through `RingtoneManager.getRingtone(...).play()` (ExpoPresentationDelegate.kt), i.e.
 * on the ring stream, which Android mutes on silent and vibrate and under Do Not Disturb — and
 * nothing is posted to the shade. When that path is unavailable (no permission, no channel) there is
 * no sound: never the media stream.
 */

/** The tracking screen's moments (maps program SP5b). */
export type Cue = 'accepted' | 'picked_up' | 'near' | 'delivered';

export const CUES: readonly Cue[] = ['accepted', 'picked_up', 'near', 'delivered'];

/** Bundled into Android res/raw by the expo-notifications plugin (app.json `sounds`), so lower case and underscores only. */
export const MOMENT_SOUND_FILES: Readonly<Record<Cue, string>> = {
  accepted: 'accepted.wav',
  picked_up: 'picked_up.wav',
  near: 'near.wav',
  delivered: 'delivered.wav',
};

/** Android channel for one cue (a channel has exactly one sound). */
export function momentChannelId(cue: Cue): string {
  return `moment_${cue}`;
}

/** Marks a local notification as a moment sound (in `content.data`). */
export const MOMENT_DATA_KEY = 'moment';

export interface MomentBehavior {
  shouldShowAlert: false;
  shouldPlaySound: true;
  shouldSetBadge: false;
}

/**
 * The foreground handler's answer for a moment notification: play its sound, show nothing. Null for
 * every other notification (they keep the app's default handling).
 */
export function momentBehavior(data: unknown): MomentBehavior | null {
  if (typeof data !== 'object' || data === null) return null;
  const v = (data as Record<string, unknown>)[MOMENT_DATA_KEY];
  return typeof v === 'string' && (CUES as readonly string[]).includes(v) ? { shouldShowAlert: false, shouldPlaySound: true, shouldSetBadge: false } : null;
}

/** How a cue plays here: Android through the ring stream (silent-aware), elsewhere expo-av. */
export function cueRoute(os: string): 'ring' | 'media' {
  return os === 'android' ? 'ring' : 'media';
}
