import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { Cue } from './moment-sound';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
const FILES: Record<Cue, number> = {
  accepted: require('../../assets/sounds/accepted.wav') as number,
  picked_up: require('../../assets/sounds/picked_up.wav') as number,
  near: require('../../assets/sounds/near.wav') as number,
  delivered: require('../../assets/sounds/delivered.wav') as number,
};
/* eslint-enable @typescript-eslint/no-require-imports */

const players = new Map<Cue, AudioPlayer>();
let mode: Promise<void> | null = null;

/**
 * A moment cue through expo-audio (iOS; Android takes the ring stream in `moment-channel`). The
 * session does not play in silent mode, so the iPhone's silent switch keeps it quiet: iOS `.ambient`
 * category, exactly what expo-av chose for the same settings (it, too, ignored ducking there).
 */
export async function playOnMedia(cue: Cue): Promise<void> {
  mode ??= setAudioModeAsync({
    playsInSilentMode: false,
    shouldPlayInBackground: false,
    interruptionMode: 'duckOthers',
    shouldRouteThroughEarpiece: false,
  }).catch(() => undefined);
  await mode;
  let p = players.get(cue);
  if (!p) {
    p = createAudioPlayer(FILES[cue]);
    p.volume = 0.8;
    players.set(cue, p);
  }
  await p.seekTo(0);
  p.play();
}
