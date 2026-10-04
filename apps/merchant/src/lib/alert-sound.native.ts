import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Vibration } from 'react-native';

/**
 * New-order alarm sound (native, UI/UX audit S-01/M-02). Two bundled tones (scripts/dev/make-alert-
 * sounds.mjs): the three-note chime, replayed by the ladder every 4 s then every 2 s, and a 1-s beep
 * that loops for the last 10 seconds. iOS plays them with the ringer switch on silent
 * (`playsInSilentModeIOS`); Android plays on the media stream, which the ringer's silent mode does not
 * mute, and never ducks for other apps. With the app closed the push channel `offers` rings instead.
 * Same API as alert-sound.ts.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
const CHIME = require('../../assets/sounds/new-order.wav') as number;
const URGENT = require('../../assets/sounds/new-order-urgent.wav') as number;
/* eslint-enable @typescript-eslint/no-require-imports */

let chimeSound: Audio.Sound | null = null;
let loopSound: Audio.Sound | null = null;
let looping = false;
let loading: Promise<void> | null = null;

function ready(): Promise<void> {
  loading ??= (async () => {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    }).catch(() => undefined);
    chimeSound = (await Audio.Sound.createAsync(CHIME, { volume: 1, shouldPlay: false })).sound;
    loopSound = (await Audio.Sound.createAsync(URGENT, { volume: 1, isLooping: true, shouldPlay: false })).sound;
  })().catch(() => {
    loading = null; // try again on the next chime
  });
  return loading;
}
void ready();

export function canPlay(): boolean {
  return true;
}

export function onUnlock(_cb: () => void): () => void {
  return () => {};
}

/** Nothing to unlock on native; loads the sounds if they aren't yet. */
export async function unlock(): Promise<boolean> {
  await ready();
  return chimeSound !== null;
}

export function chime(volume = 0.75): void {
  void ready().then(async () => {
    if (!chimeSound) return;
    await chimeSound.setVolumeAsync(Math.max(0.05, Math.min(1, volume))).catch(() => undefined);
    await chimeSound.replayAsync().catch(() => undefined);
  });
}

export function setLoop(on: boolean): void {
  if (on === looping) return;
  looping = on;
  void ready().then(async () => {
    if (!loopSound) return;
    if (looping) {
      await loopSound.setVolumeAsync(1).catch(() => undefined);
      await loopSound.playAsync().catch(() => undefined);
    } else {
      await loopSound.stopAsync().catch(() => undefined);
    }
  });
}

export function vibrate(pattern: number[], repeat = false): void {
  Vibration.vibrate(pattern, repeat);
}

export function stopVibration(): void {
  Vibration.cancel();
}

export async function testChime(): Promise<boolean> {
  const ok = await unlock();
  if (ok) chime(1);
  return ok;
}

export function playNewOrder(): void {
  chime(0.75);
}
