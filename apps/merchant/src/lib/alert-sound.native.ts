import { Vibration } from 'react-native';

/**
 * New-order alarm (native). Until the dev-client build adds a sound module (expo-audio with a bundled
 * loud chime, played at max volume even on silent — TODO(native-sound)), the tablet vibrates in a
 * long pattern each time the alarm repeats. Same API as alert-sound.ts.
 */

export function canPlay(): boolean {
  return true;
}

export function onUnlock(_cb: () => void): () => void {
  return () => {};
}

export function unlock(): void {
  /* nothing to unlock on native */
}

export function playNewOrder(): void {
  Vibration.vibrate([0, 400, 150, 400, 150, 600]);
}
