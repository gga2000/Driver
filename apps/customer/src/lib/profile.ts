import { useSyncExternalStore } from 'react';
import { AZIZIYAH_ZONES, type DeliveryPoint, type SavedPlaceView, type SavePlaceInput } from '@driver/contracts';
import { toWesternDigits } from './phone';
import { storage as platformStorage, type KeyValueStorage } from './storage';

/**
 * Device-side profile: display name (cache of the vault name), saved places, the selected
 * deliver-to place, UI locale, whether the post-OTP setup step is still due, and per-device safety
 * preferences.
 *
 * Saved places live on the server (`places.*`); `features/account/sync.ts` mirrors `places.mine`
 * into this store (`syncPlaces`) so home, the deliver-to picker and checkout read one list offline.
 * Places saved on the device before the server had them (`synced` unset) are migrated once on
 * sign-in (`toServerDraft`, idempotent by `clientRef`).
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
  /** Exact pin (server places); device-only places fall back to the zone centroid. */
  pin?: { lat: number; lng: number };
  /** Mirrors a server place. Unset = saved on this device only, awaiting migration. */
  synced?: boolean;
  /** "موقعك مؤكد ✓" */
  confirmed?: boolean;
  /** First gate photo (signed URL, may be relative to the API origin). */
  photoUrl?: string;
  sharedWithHousehold?: boolean;
  /** household = shared with me by a household member (read-only). */
  access?: 'owner' | 'household';
}

export type AppLocale = 'ar-IQ' | 'en';

export interface ProfileState {
  loaded: boolean;
  name: string | null;
  places: SavedPlace[];
  selectedPlaceId: string | null;
  locale: AppLocale;
  setupPending: boolean;
  /** Safety (customer spec §10): share live trips with the emergency contact by default. */
  shareTripsByDefault: boolean;
  /** The welcome screen was seen once (guest browsing starts from it; later launches open home). */
  welcomed: boolean;
  /**
   * Where a guest was going when the phone number was asked ("كمّل الطلب" → `/checkout`, "احجز" →
   * `/rajaa/…`): the guard returns them there after OTP (and setup), then clears it.
   */
  returnTo: string | null;
}

const KEY = 'driver.customer.profile';
const EMPTY: ProfileState = { loaded: false, name: null, places: [], selectedPlaceId: null, locale: 'ar-IQ', setupPending: false, shareTripsByDefault: false, welcomed: false, returnTo: null };

export function zoneName(zoneId: string, locale: AppLocale = 'ar-IQ'): string {
  const z = AZIZIYAH_ZONES.find((x) => x.id === zoneId);
  if (!z) return zoneId;
  // Seed names carry Eastern digits ("شارع ٣٠"); the voice guide wants 0–9 everywhere.
  return locale === 'en' ? z.name_en : toWesternDigits(z.name_ar);
}

export function deliveryPointOf(place: SavedPlace): DeliveryPoint {
  if (place.pin) return { zoneKey: place.zoneId, pin: place.pin };
  const z = AZIZIYAH_ZONES.find((x) => x.id === place.zoneId);
  return z ? { zoneKey: z.id, pin: { lat: z.lat, lng: z.lng } } : { zoneKey: place.zoneId };
}

/** A server place as the device store keeps it. Custom places read as "other" with their name. */
export function fromServerPlace(v: SavedPlaceView): SavedPlace {
  return {
    id: v.id,
    label: v.label === 'custom' ? 'other' : v.label,
    title: v.name,
    zoneId: v.zoneId,
    ...(v.note ? { note: v.note } : {}),
    pin: v.pin,
    synced: true,
    confirmed: v.confirmed,
    ...(v.photos[0] ? { photoUrl: v.photos[0].url } : {}),
    sharedWithHousehold: v.sharedWithHousehold,
    access: v.access,
  };
}

/**
 * A device-only place as a `places.save` input: the zone centroid as its pin (the owner confirms
 * the door later with "موقعي هنا"), family/other become custom places named by their label.
 */
export function toServerDraft(p: SavedPlace, labelName: (label: PlaceLabel) => string): SavePlaceInput {
  const z = AZIZIYAH_ZONES.find((x) => x.id === p.zoneId);
  const pin = p.pin ?? (z ? { lat: z.lat, lng: z.lng } : { lat: 32.905, lng: 45.06 });
  return {
    cityId: 'aziziyah',
    label: p.label === 'home' || p.label === 'work' ? p.label : 'custom',
    name: (p.title ?? labelName(p.label)).slice(0, 60),
    pin,
    ...(p.note ? { note: p.note.slice(0, 300) } : {}),
    clientRef: `device:${p.id}`,
  };
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
          shareTripsByDefault: parsed.shareTripsByDefault === true,
          welcomed: parsed.welcomed === true,
          returnTo: typeof parsed.returnTo === 'string' && parsed.returnTo.startsWith('/') ? parsed.returnTo : null,
        });
      })();
      return loading;
    },
    setName: (name: string) => save({ ...state, name: name.trim() || null }),
    setSetupPending: (setupPending: boolean) => save({ ...state, setupPending }),
    setLocale: (locale: AppLocale) => save({ ...state, locale }),
    setWelcomed: () => (state.welcomed ? Promise.resolve() : save({ ...state, welcomed: true })),
    /** Remember (or clear, with null) where to go after sign-in; only in-app paths are kept. */
    setReturnTo: (returnTo: string | null) => save({ ...state, returnTo: returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null }),
    addPlace(place: Omit<SavedPlace, 'id'>): Promise<SavedPlace> {
      const saved: SavedPlace = { ...place, id: `place_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
      return save({ ...state, places: [...state.places, saved], selectedPlaceId: state.selectedPlaceId ?? saved.id }).then(() => saved);
    },
    removePlace: (id: string) =>
      save({
        ...state,
        places: state.places.filter((p) => p.id !== id),
        selectedPlaceId: state.selectedPlaceId === id ? (state.places.find((p) => p.id !== id)?.id ?? null) : state.selectedPlaceId,
      }),
    selectPlace: (id: string) => save({ ...state, selectedPlaceId: id }),
    setShareTripsByDefault: (shareTripsByDefault: boolean) => save({ ...state, shareTripsByDefault }),
    /**
     * Mirror `places.mine`: server places first, then device-only places still awaiting migration
     * (minus `migrated`, local id → server id). The selection follows a migrated place to its
     * server id and falls back to home, then the first place.
     */
    syncPlaces(server: SavedPlace[], migrated: Record<string, string> = {}) {
      const local = state.places.filter((p) => !p.synced && !(p.id in migrated));
      const places = [...server, ...local];
      const wanted = state.selectedPlaceId ? (migrated[state.selectedPlaceId] ?? state.selectedPlaceId) : null;
      const selectedPlaceId = wanted && places.some((p) => p.id === wanted) ? wanted : (places.find((p) => p.label === 'home' && p.access !== 'household') ?? places[0])?.id ?? null;
      return save({ ...state, places, selectedPlaceId });
    },
    /** Sign-out: forget the person's data on this device, keep the UI language. */
    reset: () => save({ ...EMPTY, loaded: true, locale: state.locale, welcomed: state.welcomed }),
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
