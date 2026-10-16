import { useSyncExternalStore } from 'react';
import type { TextScale } from '@driver/ui';
import { storage, type KeyValueStorage } from './storage';

/**
 * «حجم الخط» (idea n6): the app's own text size, three steps on top of the phone's size, for a driver
 * reading at arm's length in a holder. Kept on the phone; read once at start-up.
 */
export const TEXT_SIZES: readonly TextScale[] = ['normal', 'large', 'largest'];
export const TEXT_SIZE_KEY = 'driver.partner.text-size';

let size: TextScale = 'normal';
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setTextSize(next: TextScale): void {
  if (next === size) return;
  size = next;
  for (const l of listeners) l();
}

export function useTextSize(): TextScale {
  return useSyncExternalStore(subscribe, () => size, () => size);
}

function parse(v: string | null): TextScale {
  return v === 'large' || v === 'largest' ? v : 'normal';
}

export async function loadTextSize(store: KeyValueStorage = storage): Promise<TextScale> {
  const next = parse(await store.getItem(TEXT_SIZE_KEY).catch(() => null));
  setTextSize(next);
  return next;
}

export async function saveTextSize(next: TextScale, store: KeyValueStorage = storage): Promise<void> {
  setTextSize(next);
  await store.setItem(TEXT_SIZE_KEY, next).catch(() => undefined);
}
