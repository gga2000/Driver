import type { PublicSeason } from '@driver/contracts';

/** Before the first read, or when the read fails: an ordinary day, everything on. */
export const LOUD_SEASON: PublicSeason = { quiet: false, celebrations: true, sounds: true, promos: true, quietUntil: null };

/**
 * Today's season as the API last said it (`system.season`, polled by `SeasonWatcher`). Sounds and
 * celebrations read it synchronously; screens subscribe through `useSeason`. On a quiet day (mourning,
 * set in the Console) the app plays no celebration and no moment sound.
 */
export class SeasonState {
  private value: PublicSeason = LOUD_SEASON;
  private readonly listeners = new Set<() => void>();

  get current(): PublicSeason {
    return this.value;
  }

  set(next: PublicSeason): void {
    const v = this.value;
    if (v.quiet === next.quiet && v.celebrations === next.celebrations && v.sounds === next.sounds && v.promos === next.promos && v.quietUntil === next.quietUntil) return;
    this.value = next;
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const season = new SeasonState();

/** A moment's sound plays only when the person has sounds on and today is not a quiet day. */
export function cueAllowed(soundsOn: boolean, today: PublicSeason): boolean {
  return soundsOn && today.sounds;
}
