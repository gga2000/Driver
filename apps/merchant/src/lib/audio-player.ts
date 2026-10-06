import type { AudioPlayer } from 'expo-audio';

/**
 * Small helpers over expo-audio's player for the bundled alert sounds (expo-av's `replayAsync` and
 * `createAsync` had them built in). Errors never escape: a sound is never worth a crash.
 */

/** From the start, now (expo-av `replayAsync`). */
export async function replay(player: AudioPlayer): Promise<void> {
  try {
    await player.seekTo(0);
    player.play();
  } catch {
    /* released, or the device refused audio */
  }
}

/** Resolves once the bundled file is loaded; rejects after `ms` (the sound is then reported blocked). */
export function untilLoaded(player: AudioPlayer, ms = 5_000): Promise<void> {
  if (player.isLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('audio did not load'));
    }, ms);
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (!status.isLoaded) return;
      clearTimeout(timer);
      sub.remove();
      resolve();
    });
  });
}
