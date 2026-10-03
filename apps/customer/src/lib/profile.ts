import { useSyncExternalStore } from 'react';
import { AZIZIYAH_ZONES, type DeliveryPoint } from '@driver/contracts';
import { toWesternDigits } from './phone';
import { storage as platformStorage, type KeyValueStorage } from './storage';

/**
 * Device-local profile: display name, saved places, the selected deliver-to place, UI locale and
 * whether the post-OTP setup step is still due.
 *
 * TODO(api): the API has no `identity.updateProfile` (name) or `places.mine/save` procedures yet,
 * so these live on the device. When they land, keep this store as the offline cache and sync it
 * through `useApi()`; the screens read `useProfile()` and won't need to change.
 */

export type PlaceLabel = 'home' | 'work' | 'family' | 'other';

export interface SavedPlace {
  id: string;
  label: PlaceLabel;
  /** Shown instead of the label when set ("بيت خالتي"). */
  title?: string;
  zoneId: string;
  /** Courier hint: "باب أخضر، يم الجامع". */
  note?: string;
}

export type AppLocale = 'ar-IQ' | 'en';

export interface ProfileState {
  loaded: boolean;
  name: string | null;
  places: SavedPlace[];
  selectedPlaceId: string | null;
  locale: AppLocale;
  setupPending: boolean;
}

const KEY = 'driver.customer.profile';
const EMPTY: ProfileState = { loaded: false, name: null, places: [], selectedPlaceId: null, locale: 'ar-IQ', setupPending: false };

export function zoneName(zoneId: string, locale: AppLocale = 'ar-IQ'): string {
  const z = AZIZIYAH_ZONES.find((x) => x.id === zoneId);
  if (!z) return zoneId;
  // Seed names carry Eastern digits ("شارع ٣٠"); the voice guide wants 0–9 everywhere.
  return locale === 'en' ? z.name_en : toWesternDigits(z.name_ar);
}

export function deliveryPointOf(place: SavedPlace): DeliveryPoint {
  const z = AZIZIYAH_ZONES.find((x) => x.id === place.zoneId);
  return z ? { zoneKey: z.id, pin: { lat: z.lat, lng: z.lng } } : { zoneKey: place.zoneId };
}

export function createProfileStore(store: KeyValueStorage) {
  let state: ProfileState = EMPTY;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function emit(next: ProfileState) {
    state = next;
    for (const l of listeners) l();
  }
  async function save(next: ProfileState) {
    emit(next);
    const { loaded: _loaded, ...persisted } = next;
    void _loaded;
    await store.setItem(KEY, JSON.stringify(persisted)).catch(() => {});
  }

  const api = {
    getSnapshot: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    load(): Promise<void> {
      if (state.loaded) return Promise.resolve();
      loading ??= (async () => {
        let parsed: Partial<ProfileState> = {};
        try {
          const raw = await store.getItem(KEY);
          if (raw) parsed = JSON.parse(raw) as Partial<ProfileState>;
        } catch {
          parsed = {};
        }
        emit({
          loaded: true,
          name: typeof parsed.name === 'string' ? parsed.name : null,
          places: Array.isArray(parsed.places) ? parsed.places : [],
          selectedPlaceId: typeof parsed.selectedPlaceId === 'string' ? parsed.selectedPlaceId : null,
          locale: parsed.locale === 'en' ? 'en' : 'ar-IQ',
          setupPending: parsed.setupPending === true,
        });
      })();
      return loading;
    },
    setName: (name: string) => save({ ...state, name: name.trim() || null }),
    setSetupPending: (setupPending: boolean) => save({ ...state, setupPending }),
    setLocale: (locale: AppLocale) => save({ ...state, locale }),
    addPlace(place: Omit<SavedPlace, 'id'>): Promise<SavedPlace> {
      const saved: SavedPlace = { ...place, id: `place_${Date.now().toString(36)}` };
      return save({ ...state, places: [...state.places, saved], selectedPlaceId: state.selectedPlaceId ?? saved.id }).then(() => saved);
    },
    removePlace: (id: string) =>
      save({
        ...state,
        places: state.places.filter((p) => p.id !== id),
        selectedPlaceId: state.selectedPlaceId === id ? (state.places.find((p) => p.id !== id)?.id ?? null) : state.selectedPlaceId,
      }),
    selectPlace: (id: string) => save({ ...state, selectedPlaceId: id }),
    /** Sign-out: forget the person's data on this device, keep the UI language. */
    reset: () => save({ ...EMPTY, loaded: true, locale: state.locale }),
  };
  return api;
}

export const profile = createProfileStore(platformStorage);

export function useProfile(): ProfileState {
  return useSyncExternalStore(profile.subscribe, profile.getSnapshot, profile.getSnapshot);
}

export function selectedPlace(p: ProfileState): SavedPlace | null {
  return p.places.find((x) => x.id === p.selectedPlaceId) ?? p.places[0] ?? null;
}
