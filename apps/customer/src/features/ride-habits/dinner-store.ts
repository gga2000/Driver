import { useSyncExternalStore } from 'react';
import type { DinnerChance, DinnerSource } from '@driver/contracts';

/**
 * «عشاك يوصل وياك» (joy r6) between the card and checkout: which ride (or الرجعة) the dinner travels
 * with, and the place it goes to. In memory only — a dinner is for this trip, and the server checks
 * the trip again when checkout asks for the time.
 */
export interface DinnerPick {
  source: DinnerSource;
  placeId: string;
  placeName: string;
  setAt: number;
}

/** A pick older than this is forgotten (the trip is long over). */
const KEEP_MS = 3 * 60 * 60_000;

let pick: DinnerPick | null = null;
const listeners = new Set<() => void>();

function emit(next: DinnerPick | null) {
  pick = next;
  for (const l of listeners) l();
}

export const dinnerStore = {
  get: (now = Date.now()): DinnerPick | null => (pick && now - pick.setAt < KEEP_MS ? pick : null),
  choose: (chance: DinnerChance, now = Date.now()) => emit({ source: chance.source, placeId: chance.place.placeId, placeName: chance.place.name, setAt: now }),
  clear: () => emit(null),
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** The current dinner pick (null when none or too old). */
export function useDinnerPick(): DinnerPick | null {
  return useSyncExternalStore(dinnerStore.subscribe, () => dinnerStore.get(), () => null);
}
