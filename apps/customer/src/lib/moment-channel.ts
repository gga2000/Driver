import type { Cue } from './moment-sound';

/**
 * Web and test build of `moment-channel.native.ts`: there is no ring stream here, so nothing plays
 * this way (the web and iOS play cues through expo-av in `sound.ts`).
 */
export async function playOnRing(_cue: Cue): Promise<boolean> {
  return false;
}
