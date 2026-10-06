import type { Timetable } from '@driver/contracts';
import { storage, type KeyValueStorage } from '@/lib/storage';

/** The Ramadan timetable this person follows (profile › notifications, or the home card), kept on the device. */
export const TIMETABLE_PREF_KEY = 'driver.customer.ramadan_timetable';

function parse(v: string | null): Timetable | null {
  return v === 'sunni' || v === 'shia' ? v : null;
}

/**
 * The maghrib timetable picked once (customer joy J6). `null` until the person picks: the app never
 * assumes one, so the home card asks instead of showing a time. Listeners keep the card, the picker
 * and checkout in step.
 */
export class TimetablePref {
  private value: Timetable | null = null;
  private loaded: Promise<void> | null = null;
  private readonly listeners = new Set<(v: Timetable | null) => void>();

  constructor(private readonly store: KeyValueStorage = storage) {}

  /** Reads the stored pick once; storage failing leaves it unpicked (the card asks again). */
  load(): Promise<void> {
    this.loaded ??= this.store.getItem(TIMETABLE_PREF_KEY).then(
      (v) => {
        this.value = parse(v);
        this.emit();
      },
      () => undefined,
    );
    return this.loaded;
  }

  get current(): Timetable | null {
    return this.value;
  }

  async set(v: Timetable): Promise<void> {
    this.value = v;
    this.emit();
    await this.store.setItem(TIMETABLE_PREF_KEY, v);
  }

  subscribe(fn: (v: Timetable | null) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.value);
  }
}

export const timetablePref = new TimetablePref();
