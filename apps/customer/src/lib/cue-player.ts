import { Asset } from 'expo-asset';
import type { Cue } from './moment-sound';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
const FILES: Record<Cue, number> = {
  accepted: require('../../assets/sounds/accepted.wav') as number,
  picked_up: require('../../assets/sounds/picked_up.wav') as number,
  near: require('../../assets/sounds/near.wav') as number,
  delivered: require('../../assets/sounds/delivered.wav') as number,
};
/* eslint-enable @typescript-eslint/no-require-imports */

type HtmlAudio = { volume: number; currentTime: number; play(): Promise<void> };
const players = new Map<Cue, HtmlAudio>();

/**
 * Web build of `cue-player.native.ts`: a plain HTML audio element per cue. Browsers refuse sound
 * before the page had a tap; that refusal is swallowed (the moment still shows).
 */
export async function playOnMedia(cue: Cue): Promise<void> {
  const AudioCtor = (globalThis as { Audio?: new (src: string) => HtmlAudio }).Audio;
  if (!AudioCtor) return;
  let a = players.get(cue);
  if (!a) {
    a = new AudioCtor(Asset.fromModule(FILES[cue]).uri);
    a.volume = 0.8;
    players.set(cue, a);
  }
  a.currentTime = 0;
  await a.play().catch(() => undefined);
}
