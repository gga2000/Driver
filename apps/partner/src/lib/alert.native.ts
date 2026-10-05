import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Vibration } from 'react-native';

/**
 * The offer alert on the phone (UI/UX audit P-01, S-01): a bundled loud doorbell that loops until he
 * answers or the offer expires, plus a vibration pattern that repeats with it — a phone in a handlebar
 * mount or a pocket on a noisy road. iOS plays it with the ringer switch on silent
 * (`playsInSilentModeIOS`); Android plays on the media stream (not muted by the ringer's silent mode)
 * without ducking for music. With the app closed the push channel `offers` rings instead.
 * Same API as alert.ts.
 */

export const OFFER_REPEAT_MS = 1_600;
export const OFFER_VIBRATION = [0, 600, 300, 600];

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles assets through require()
const OFFER_LOOP = require('../../assets/sounds/offer-loop.wav') as number;

let sound: Audio.Sound | null = null;
let loading: Promise<void> | null = null;
let wanted = false;
type SoundState = 'ready' | 'blocked' | 'unknown';
let loaded: SoundState = 'unknown';
const listeners = new Set<(s: SoundState) => void>();
function setLoaded(s: SoundState) {
  loaded = s;
  for (const cb of listeners) cb(s);
}

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
    sound = (await Audio.Sound.createAsync(OFFER_LOOP, { volume: 1, isLooping: true, shouldPlay: false })).sound;
    setLoaded('ready');
  })().catch(() => {
    loading = null;
    setLoaded('blocked');
  });
  return loading;
}
void ready();

/** One doorbell (no loop). */
export function playOfferChime(): void {
  void ready().then(async () => {
    if (!sound) return;
    await sound.setIsLoopingAsync(false).catch(() => undefined);
    await sound.replayAsync().catch(() => undefined);
  });
}

export function startOfferAlert(): void {
  wanted = true;
  Vibration.vibrate(OFFER_VIBRATION, true);
  void ready().then(async () => {
    if (!sound || !wanted) return;
    await sound.setVolumeAsync(1).catch(() => undefined);
    await sound.setIsLoopingAsync(true).catch(() => undefined);
    await sound.replayAsync().catch(() => undefined);
  });
}

export function stopOfferAlert(): void {
  wanted = false;
  Vibration.cancel();
  void sound?.stopAsync().catch(() => undefined);
}

export async function playTestSound(): Promise<boolean> {
  await ready();
  if (!sound) return false;
  Vibration.vibrate(OFFER_VIBRATION);
  await sound.setIsLoopingAsync(false).catch(() => undefined);
  await sound.replayAsync().catch(() => undefined);
  return true;
}

/** The bundled offer sound loaded and can play (readiness row, audit S-8); `unknown` while loading. */
export function soundState(): SoundState {
  return loaded;
}

export function onSoundState(cb: (s: SoundState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
