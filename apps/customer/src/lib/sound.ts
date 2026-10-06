import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { playOnRing } from './moment-channel';
import { cueRoute, type Cue } from './moment-sound';
import { cueAllowed, season } from './season';
import { soundPref } from './sound-pref';

export type { Cue } from './moment-sound';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
const FILES: Record<Cue, number> = {
  accepted: require('../../assets/sounds/accepted.wav') as number,
  picked_up: require('../../assets/sounds/picked_up.wav') as number,
  near: require('../../assets/sounds/near.wav') as number,
  delivered: require('../../assets/sounds/delivered.wav') as number,
};
/* eslint-enable @typescript-eslint/no-require-imports */

const sounds = new Map<Cue, Audio.Sound>();
let mode: Promise<void> | null = null;

/**
 * Soft cues while the tracking screen is open (scripts/dev/make-alert-sounds.mjs, ≤ 30 KB each). Unlike
 * the kitchen and courier alarms they respect the iPhone's silent switch and only duck other audio;
 * the in-app switch turns them off. A cue that cannot play (web before a tap, no audio) is skipped.
 * On a quiet day (Console) no cue plays. On Android the cue rides the ring stream instead
 * (`moment-channel`), so a phone on silent or vibrate stays silent (joy f7, L-24).
 */
export function playCue(cue: Cue): void {
  if (!cueAllowed(soundPref.enabled, season.current)) return;
  if (cueRoute(Platform.OS) === 'ring') {
    void playOnRing(cue);
    return;
  }
  mode ??= Audio.setAudioModeAsync({
    playsInSilentModeIOS: false,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  }).catch(() => undefined);
  void mode
    .then(async () => {
      let s = sounds.get(cue);
      if (!s) {
        s = (await Audio.Sound.createAsync(FILES[cue], { volume: 0.8, shouldPlay: false })).sound;
        sounds.set(cue, s);
      }
      await s.replayAsync();
    })
    // A sound is a nicety: when the device refuses it the moment still shows and buzzes.
    .catch(() => undefined);
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
