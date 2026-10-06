import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { playOnMedia } from './cue-player';
import { playOnRing } from './moment-channel';
import { cueRoute, type Cue } from './moment-sound';
import { cueAllowed, season } from './season';
import { soundPref } from './sound-pref';

export type { Cue } from './moment-sound';

/**
 * Soft cues while the tracking screen is open (scripts/dev/make-alert-sounds.mjs, ≤ 30 KB each). Unlike
 * the kitchen and courier alarms they respect the iPhone's silent switch (`cue-player.native.ts`,
 * expo-audio); the in-app switch turns them off. A cue that cannot play (web before a tap, no audio)
 * is skipped. On a quiet day (Console) no cue plays. On Android the cue rides the ring stream instead
 * (`moment-channel`), so a phone on silent or vibrate stays silent (joy f7, L-24).
 */
export function playCue(cue: Cue): void {
  if (!cueAllowed(soundPref.enabled, season.current)) return;
  if (cueRoute(Platform.OS) === 'ring') {
    void playOnRing(cue);
    return;
  }
  // A sound is a nicety: when the device refuses it the moment still shows and buzzes.
  void playOnMedia(cue).catch(() => undefined);
}

/** The switch's value, live. */
export function useTrackingSounds(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(soundPref.enabled);
  useEffect(() => {
    void soundPref.load();
    return soundPref.subscribe(setOn);
  }, []);
  return [on, (v: boolean) => void soundPref.set(v)];
}
