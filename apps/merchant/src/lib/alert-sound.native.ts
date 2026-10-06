import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Vibration } from 'react-native';
import { replay, untilLoaded } from './audio-player';

/**
 * New-order alarm sound (native, UI/UX audit S-01/M-02). Two bundled tones (scripts/dev/make-alert-
 * sounds.mjs): the three-note chime, replayed by the ladder every 4 s then every 2 s, and a 1-s beep
 * that loops for the last 10 seconds. iOS plays them with the ringer switch on silent
 * (`playsInSilentMode`, the `.playback` session); Android plays on the media stream, which the
 * ringer's silent mode does not mute, and takes audio focus without ducking for other apps
 * (`doNotMix`). With the app closed the push channel `offers` rings instead. expo-audio.
 * Same API as alert-sound.ts.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
const CHIME = require('../../assets/sounds/new-order.wav') as number;
const URGENT = require('../../assets/sounds/new-order-urgent.wav') as number;
const COURIER = require('../../assets/sounds/courier.wav') as number;
/* eslint-enable @typescript-eslint/no-require-imports */

let chimeSound: AudioPlayer | null = null;
let loopSound: AudioPlayer | null = null;
let courierSound: AudioPlayer | null = null;
let looping = false;
let loading: Promise<void> | null = null;

function player(source: number, volume: number, loop = false): AudioPlayer {
  const p = createAudioPlayer(source);
  p.volume = volume;
  p.loop = loop;
  return p;
}

function ready(): Promise<void> {
  loading ??= (async () => {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
    chimeSound ??= player(CHIME, 1);
    loopSound ??= player(URGENT, 1, true);
    courierSound ??= player(COURIER, 0.8);
    await untilLoaded(chimeSound);
  })().catch(() => {
    loading = null; // try again on the next chime (the players stay; they may still load)
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
  return chimeSound?.isLoaded ?? false;
}

export function chime(volume = 0.75): void {
  void ready().then(async () => {
    if (!chimeSound) return;
    chimeSound.volume = Math.max(0.05, Math.min(1, volume));
    await replay(chimeSound);
  });
}

export function setLoop(on: boolean): void {
  if (on === looping) return;
  looping = on;
  void ready().then(async () => {
    if (!loopSound) return;
    if (looping) {
      loopSound.volume = 1;
      loopSound.play();
    } else {
      loopSound.pause();
      await loopSound.seekTo(0).catch(() => undefined);
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

/** A courier is about to walk in (maps program SP7a): two softer notes down, unlike the new-order chime. */
export function courierChime(): void {
  void ready().then(async () => {
    if (courierSound) await replay(courierSound);
  });
}

export function playNewOrder(): void {
  chime(0.75);
}
