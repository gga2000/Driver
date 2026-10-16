import { useEffect, useSyncExternalStore } from 'react';
import { storage, type KeyValueStorage } from '@/lib/storage';
import type { PracticeStore } from './practice-link';
import { newPractice, type PracticeKind, type PracticeState } from './scenario';

/**
 * The practice order on this phone (partner redesign l4): the pretend order while he runs it, and
 * whether he has finished one. «خلّصت البروفة» stays on the phone (it is shown at the launch-week phone
 * check); nothing about it reaches the server.
 */

let state: PracticeState | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const practiceStore: PracticeStore & { start(kind: PracticeKind, now?: number): PracticeState; clear(): void } = {
  get: () => state,
  set(next) {
    state = next;
    emit();
    if (next.stage === 'done' && next.finishedAt) void savePracticeDone({ at: next.finishedAt, kind: next.kind });
  },
  start(kind, now = Date.now()) {
    state = newPractice(kind, now);
    emit();
    return state;
  },
  clear() {
    state = null;
    emit();
  },
};

export function usePracticeState(): PracticeState | null {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// ── «خلّصت البروفة», kept on the phone ──

export const PRACTICE_DONE_KEY = 'driver.partner.practice-done';

export interface PracticeDone {
  at: number;
  kind: PracticeKind;
}

/** undefined: not read yet; null: never finished one on this phone. */
let done: PracticeDone | null | undefined;
const doneListeners = new Set<() => void>();
const subscribeDone = (cb: () => void) => {
  doneListeners.add(cb);
  return () => doneListeners.delete(cb);
};

function setDone(next: PracticeDone | null) {
  done = next;
  for (const l of doneListeners) l();
}

export function parsePracticeDone(v: string | null): PracticeDone | null {
  if (!v) return null;
  try {
    const o = JSON.parse(v) as Partial<PracticeDone>;
    return typeof o.at === 'number' && (o.kind === 'food' || o.kind === 'taxi' || o.kind === 'tuktuk') ? { at: o.at, kind: o.kind } : null;
  } catch {
    return null;
  }
}

export async function loadPracticeDone(store: KeyValueStorage = storage): Promise<PracticeDone | null> {
  if (done !== undefined) return done;
  const next = parsePracticeDone(await store.getItem(PRACTICE_DONE_KEY).catch(() => null));
  setDone(next);
  return next;
}

export async function savePracticeDone(next: PracticeDone, store: KeyValueStorage = storage): Promise<void> {
  setDone(next);
  await store.setItem(PRACTICE_DONE_KEY, JSON.stringify(next)).catch(() => undefined);
}

/** The finished practice on this phone; undefined until read (the caller starts the read). */
export function usePracticeDone(): PracticeDone | null | undefined {
  const v = useSyncExternalStore(subscribeDone, () => done, () => done);
  useEffect(() => {
    if (v === undefined) void loadPracticeDone();
  }, [v]);
  return v;
}
