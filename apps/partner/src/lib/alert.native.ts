import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Vibration } from 'react-native';
import { replay, untilLoaded } from './audio-player';

/**
 * The offer alert on the phone (UI/UX audit P-01, S-01): a bundled loud doorbell that loops until he
 * answers or the offer expires, plus a vibration pattern that repeats with it — a phone in a handlebar
 * mount or a pocket on a noisy road. iOS plays it with the ringer switch on silent
 * (`playsInSilentMode`, the `.playback` session); Android plays on the media stream (not muted by the
 * ringer's silent mode) and takes audio focus without ducking for music (`doNotMix`). With the app
 * closed the push channel `offers` rings instead. Same API as alert.ts.
 */

export const OFFER_REPEAT_MS = 1_600;
export const OFFER_VIBRATION = [0, 600, 300, 600];

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles assets through require()
const OFFER_LOOP = require('../../assets/sounds/offer-loop.wav') as number;

let sound: AudioPlayer | null = null;
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
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
    if (!sound) {
      sound = createAudioPlayer(OFFER_LOOP);
      sound.volume = 1;
      sound.loop = true;
    }
    await untilLoaded(sound);
    setLoaded('ready');
  })().catch(() => {
    loading = null; // ask again next time (the player stays; it may still load)
    setLoaded('blocked');
  });
  return loading;
}
void ready();

/** One doorbell (no loop). */
export function playOfferChime(): void {
  void ready().then(async () => {
    if (!sound) return;
    sound.volume = 1;
    sound.loop = false;
    await replay(sound);
  });
}

/** Soft volume of the rider's nudge (ride step 3): a reminder, not a second doorbell. */
export const NUDGE_VOLUME = 0.7;
export const NUDGE_VIBRATION = [0, 120];

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles assets through require()
const NUDGE = require('../../assets/sounds/nudge.wav') as number;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles assets through require()
const CHAT = require('../../assets/sounds/chat.wav') as number;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles assets through require()
const DONE = require('../../assets/sounds/done.wav') as number;
let nudgePlayer: AudioPlayer | null = null;
let chatPlayer: AudioPlayer | null = null;
let donePlayer: AudioPlayer | null = null;

/** Plays a short bundled cue once (o15: its own sound, so he knows what it is without looking). */
function cue(which: 'nudge' | 'chat' | 'done', volume: number) {
  void ready().then(async () => {
    try {
      if (which === 'nudge') nudgePlayer ??= createAudioPlayer(NUDGE);
      else if (which === 'chat') chatPlayer ??= createAudioPlayer(CHAT);
      else donePlayer ??= createAudioPlayer(DONE);
      const p = which === 'nudge' ? nudgePlayer : which === 'chat' ? chatPlayer : donePlayer;
      if (!p) return;
      p.volume = volume;
      await untilLoaded(p);
      await replay(p);
    } catch {
      /* a cue is never worth a crash */
    }
  });
}

/**
 * «راكب ينتظرك»: the rider nudged this offer — its own soft falling chime (partner redesign o15,
 * unlike the offer's rising doorbell) and a short tap, over the offer's loop.
 */
export function playNudgeChime(): void {
  Vibration.vibrate(NUDGE_VIBRATION);
  cue('nudge', NUDGE_VOLUME);
}

/** A chat message on the job (o15): two quick high pips, loud enough over a motorbike. */
export const CHAT_VIBRATION = [0, 80, 80, 80];
export function playChatPing(): void {
  Vibration.vibrate(CHAT_VIBRATION);
  cue('chat', 1);
}

/** Partner redesign d3: the job is done — one soft bell «tink», quieter than any alert. */
export const DONE_VOLUME = 0.5;
export function playDoneTink(): void {
  cue('done', DONE_VOLUME);
}

export function startOfferAlert(): void {
  wanted = true;
  Vibration.vibrate(OFFER_VIBRATION, true);
  void ready().then(async () => {
    if (!sound || !wanted) return;
    sound.volume = 1;
    sound.loop = true;
    await replay(sound);
  });
}

export function stopOfferAlert(): void {
  wanted = false;
  Vibration.cancel();
  if (sound) {
    try {
      sound.pause();
    } catch {
      /* released or never loaded */
    }
  }
}

export async function playTestSound(): Promise<boolean> {
  await ready();
  if (!sound) return false;
  Vibration.vibrate(OFFER_VIBRATION);
  sound.volume = 1;
  sound.loop = false;
  await replay(sound);
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
