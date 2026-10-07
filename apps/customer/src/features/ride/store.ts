import { useEffect, useSyncExternalStore } from 'react';
import type { RideCargo } from '@driver/contracts';
import { session } from '@/lib/session';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';
import { pushRecent, type RideVertical, type Spot } from './logic';

/**
 * The ride being booked (in memory, across /ride → /ride/pin → /ride/choose) and two small
 * device records: recent destinations ("آخر المشاوير") and, per placed ride, what the rider chose
 * (vehicle, place names) so the live screen can name "من البيت → حديقة الشاشة" before a driver
 * accepts. Same tiny external-store pattern as `lib/profile.ts`.
 */

export interface RideDraft {
  vertical: RideVertical;
  /** null = the selected deliver-to place (resolved by the screen). */
  pickup: Spot | null;
  dropoff: Spot | null;
  doorPickup: boolean;
  payment: 'cash' | 'wallet';
  note: string;
  /** The rider chose to try a tuktuk to/from an edge zone. */
  allowEdgeTuktuk: boolean;
  /** Ride idea s6 «سايق للعوائل»: the first wave goes to long-verified, top-rated drivers with family cars. */
  familyPreferred: boolean;
  /** Ride idea x5 «عندي غراض»: what he carries this trip (bags, a gas cylinder, something big). */
  rideCargo: RideCargo[];
}

export interface RideMemo {
  vertical: RideVertical;
  from: string;
  to: string;
  at: number;
  /** The rider asked the driver to the door (the 3-minute re-quote keeps the choice). */
  doorPickup?: boolean;
  /** The destination is the saved home (the live map draws the house, else a flag). */
  toHome?: boolean;
  /** The destination as the rider chose it: «تحب تسمّي هالمكان؟» and the ride back (ride ideas a3, a4). */
  dest?: Spot;
}

interface PersistedRide {
  recent: Spot[];
  memos: Record<string, RideMemo>;
}

export interface RideStoreState extends PersistedRide {
  loaded: boolean;
  draft: RideDraft;
}

const KEY = 'driver.customer.ride';
const MAX_MEMOS = 20;
export const EMPTY_DRAFT: RideDraft = { vertical: 'taxi', pickup: null, dropoff: null, doorPickup: false, payment: 'cash', note: '', allowEdgeTuktuk: false, familyPreferred: false, rideCargo: [] };

export function createRideStore(store: KeyValueStorage) {
  let state: RideStoreState = { loaded: false, draft: EMPTY_DRAFT, recent: [], memos: {} };
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const emit = (next: RideStoreState) => {
    state = next;
    for (const l of listeners) l();
  };
  const persist = (next: RideStoreState) => {
    emit(next);
    const body: PersistedRide = { recent: next.recent, memos: next.memos };
    void store.setItem(KEY, JSON.stringify(body)).catch(() => {});
  };

  return {
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
        let parsed: Partial<PersistedRide> = {};
        try {
          const raw = await store.getItem(KEY);
          if (raw) parsed = JSON.parse(raw) as Partial<PersistedRide>;
        } catch {
          parsed = {};
        }
        emit({
          ...state,
          loaded: true,
          recent: Array.isArray(parsed.recent) ? parsed.recent.filter((s) => s && typeof s.zoneId === 'string' && s.pin) : [],
          memos: parsed.memos && typeof parsed.memos === 'object' ? parsed.memos : {},
        });
      })();
      return loading;
    },
    /** A fresh booking from home (keeps nothing of the last one but the payment and family-driver choices). */
    start(vertical: RideVertical) {
      emit({ ...state, draft: { ...EMPTY_DRAFT, vertical, payment: state.draft.payment, familyPreferred: state.draft.familyPreferred } });
    },
    update(patch: Partial<RideDraft>) {
      emit({ ...state, draft: { ...state.draft, ...patch } });
    },
    /** After `orders.place`: remember the destination and what the rider chose for this order. */
    placed(orderId: string, memo: Omit<RideMemo, 'at'>, destination: Spot, at = Date.now()) {
      const memos = Object.entries({ ...state.memos, [orderId]: { ...memo, dest: destination, at } })
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, MAX_MEMOS);
      persist({ ...state, recent: pushRecent(state.recent, destination), memos: Object.fromEntries(memos), draft: { ...state.draft, note: '' } });
    },
    /** A ride that replaced another (J-D7 switch): the same names and choices under the new order. */
    remember(orderId: string, memo: Omit<RideMemo, 'at'>, at = Date.now()) {
      const memos = Object.entries({ ...state.memos, [orderId]: { ...memo, at } })
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, MAX_MEMOS);
      persist({ ...state, memos: Object.fromEntries(memos) });
    },
    reset() {
      persist({ ...state, draft: EMPTY_DRAFT, recent: [], memos: {} });
    },
  };
}

export const rideStore = createRideStore(platformStorage);
// Another person signing in on this device never sees the last one's trips.
session.onSignOut(() => rideStore.reset());

export function useRideStore(): RideStoreState {
  const s = useSyncExternalStore(rideStore.subscribe, rideStore.getSnapshot, rideStore.getSnapshot);
  useEffect(() => {
    void rideStore.load();
  }, []);
  return s;
}

export function useRideMemo(orderId: string): RideMemo | null {
  return useRideStore().memos[orderId] ?? null;
}

/** The latest ride placed on this device (newest memo), with its order id. */
export function useLastRide(): (RideMemo & { orderId: string }) | null {
  const memos = useRideStore().memos;
  let best: (RideMemo & { orderId: string }) | null = null;
  for (const [orderId, m] of Object.entries(memos)) if (!best || m.at > best.at) best = { ...m, orderId };
  return best;
}
