import { useEffect, useSyncExternalStore } from 'react';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * «تعلّم بدقيقة» (counter step 6, s1): the three cards each person sees the first time they sign in on
 * this device. Remembered per person per device (a new cook on the same tablet still gets them); the
 * settings can show them again any time.
 */

const KEY = 'driver.merchant.learned';

export function parseLearned(raw: string | null): string[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Who the cards are remembered for: the signed-in person, or this device when the id is unknown. */
export const learnerKey = (personId: string | null | undefined) => personId || 'device';

export function createLearnStore(store: KeyValueStorage) {
  let state: { loaded: boolean; people: readonly string[]; again: boolean } = { loaded: false, people: [], again: false };
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: typeof state) => {
    state = next;
    for (const l of listeners) l();
  };
  return {
    load(): Promise<void> {
      loading ??= store
        .getItem(KEY)
        .catch(() => null)
        .then((raw) => set({ ...state, loaded: true, people: [...new Set([...parseLearned(raw), ...state.people])] }));
      return loading;
    },
    done(personId: string | null | undefined) {
      const who = learnerKey(personId);
      const people = state.people.includes(who) ? state.people : [...state.people, who];
      set({ ...state, people, again: false });
      void store.setItem(KEY, JSON.stringify(people)).catch(() => {});
    },
    /** «شوف الدرس مرة ثانية» from the settings. */
    showAgain() {
      set({ ...state, again: true });
    },
    snapshot: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

export const learn = createLearnStore(platformStorage);

/**
 * Day-one d09: the lesson never covers a waiting order. While orders wait (or before the board has
 * loaded and we can't tell) it is held; it comes at the first quiet moment, and steps aside again if
 * an order arrives while it is open.
 */
export function lessonNow(p: { due: boolean; waiting: number; boardLoaded: boolean }): boolean {
  return p.due && p.boardLoaded && p.waiting === 0;
}

/** Whether to show the lesson now: never before storage has answered (no flash for people who know). */
export function useLessonDue(personId: string | null | undefined): boolean {
  useEffect(() => {
    void learn.load();
  }, []);
  const s = useSyncExternalStore(learn.subscribe, learn.snapshot, learn.snapshot);
  return s.again || (s.loaded && !s.people.includes(learnerKey(personId)));
}
