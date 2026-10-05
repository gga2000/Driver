import { storage, type KeyValueStorage } from './storage';

/** The in-app switch for the tracking screen's sounds (profile › notifications), on by default. */
export const SOUND_PREF_KEY = 'driver.customer.tracking_sounds';

/**
 * The customer's choice to hear the tracking cues (maps program SP5b). Kept on the device; one value
 * shared by every screen, with listeners so the switch and the player agree at once.
 */
export class SoundPref {
  private on = true;
  private loaded: Promise<void> | null = null;
  private readonly listeners = new Set<(on: boolean) => void>();

  constructor(private readonly store: KeyValueStorage = storage) {}

  /** Reads the stored choice once; until then (and if storage fails) sounds are on. */
  load(): Promise<void> {
    this.loaded ??= this.store.getItem(SOUND_PREF_KEY).then(
      (v) => {
        this.on = v !== 'off';
        this.emit();
      },
      () => undefined,
    );
    return this.loaded;
  }

  get enabled(): boolean {
    return this.on;
  }

  async set(on: boolean): Promise<void> {
    this.on = on;
    this.emit();
    await this.store.setItem(SOUND_PREF_KEY, on ? 'on' : 'off');
  }

  subscribe(fn: (on: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.on);
  }
}

export const soundPref = new SoundPref();
