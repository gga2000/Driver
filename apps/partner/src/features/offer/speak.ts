import * as Speech from 'expo-speech';
import { useSyncExternalStore } from 'react';
import { storage } from '@/lib/storage';

/**
 * Partner redesign o4: the order read aloud in Arabic as it lands («طلب أكل، 1250 دينار، مطعم خالد»),
 * on by default and switched off from the account tab. Arabic voice of the phone (Iraqi when it has
 * one); silence when it has none — the doorbell and the slip still tell him.
 */
export const SPEAK_KEY = 'driver.partner.speak_offer';
/** Longest a reading may hold the doorbell back. */
export const SPEAK_MAX_MS = 6_000;

let on = true;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

void storage
  .getItem(SPEAK_KEY)
  .then((v) => {
    on = v !== '0';
  })
  .catch(() => undefined)
  .finally(() => {
    loaded = true;
    emit();
  });

export function useSpeakOffers(): { on: boolean; loaded: boolean } {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => on,
    () => on,
  );
  return { on: value, loaded };
}

export async function setSpeakOffers(value: boolean): Promise<void> {
  on = value;
  emit();
  if (!value) stopSpeaking();
  await storage.setItem(SPEAK_KEY, value ? '1' : '0').catch(() => undefined);
}

/**
 * Says `text` once in the app's language (Arabic by default), cutting anything still being read.
 * `after` runs once when it ends, fails or is cut (the doorbell picks up again). False when off.
 */
export function speakOffer(text: string, locale: string, after?: () => void): boolean {
  if (!on) return false;
  let ran = false;
  const done = () => {
    if (ran) return;
    ran = true;
    after?.();
  };
  // Some engines never report the end: the doorbell comes back after this at the latest.
  setTimeout(done, SPEAK_MAX_MS);
  try {
    void Speech.stop();
    Speech.speak(text, { language: locale === 'en' ? 'en-GB' : 'ar-IQ', rate: 1.0, pitch: 1.0, onDone: done, onStopped: done, onError: done });
  } catch {
    // No speech engine: the slip and the doorbell carry it.
    done();
  }
  return true;
}

export function stopSpeaking(): void {
  try {
    void Speech.stop();
  } catch {
    /* nothing to stop */
  }
}
