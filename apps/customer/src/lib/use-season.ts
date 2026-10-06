import { useSyncExternalStore } from 'react';
import type { PublicSeason } from '@driver/contracts';
import { season } from './season';

/** Today's season, live: re-renders when the Console turns a quiet day on or off. */
export function useSeason(): PublicSeason {
  return useSyncExternalStore(
    (fn) => season.subscribe(fn),
    () => season.current,
    () => season.current,
  );
}
