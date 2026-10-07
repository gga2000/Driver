import { useSyncExternalStore } from 'react';
import type { RegularPoint, RegularRemind, RegularTripView, SaveRegularTripInput, TravellingAs } from '@driver/contracts';
import { defaultRemind, morningAllowed } from './logic';

/**
 * The regular-trip editor's draft (joy r5), in memory across the list, a booked ride («خليها رحلة
 * ثابتة») and the editor. `toInput` is what the server is sent; it says null while something is
 * missing, and the editor says what.
 */
export interface RegularDraft {
  id: string | null;
  kind: 'ride' | 'rajaa';
  days: number[];
  timeMin: number;
  remind: RegularRemind;
  paymentMethod: 'cash' | 'wallet';
  favouriteId: string | null;
  active: boolean;
  ride: { rideVertical: 'taxi' | 'tuktuk'; pickup: RegularPoint | null; dropoff: RegularPoint | null; doorPickup: boolean };
  rajaa: { corridorId: string; direction: 'to_aziziyah' | 'from_aziziyah'; garageId: string; travellingAs: TravellingAs };
}

export const DEFAULT_RAJAA: RegularDraft['rajaa'] = { corridorId: 'aziziyah_kut', direction: 'from_aziziyah', garageId: 'mp_garage_bab1', travellingAs: 'rijal' };

export function emptyDraft(kind: 'ride' | 'rajaa'): RegularDraft {
  const timeMin = kind === 'ride' ? 7 * 60 + 30 : 8 * 60;
  return {
    id: null,
    kind,
    days: kind === 'ride' ? [0, 1, 2, 3, 4] : [4],
    timeMin,
    remind: defaultRemind(timeMin),
    paymentMethod: 'cash',
    favouriteId: null,
    active: true,
    ride: { rideVertical: 'taxi', pickup: null, dropoff: null, doorPickup: false },
    rajaa: { ...DEFAULT_RAJAA },
  };
}

/** A saved trip as a draft to edit. */
export function draftOf(trip: RegularTripView): RegularDraft {
  const base = emptyDraft(trip.plan.kind);
  return {
    ...base,
    id: trip.id,
    days: [...trip.days],
    timeMin: trip.timeMin,
    remind: trip.remind,
    paymentMethod: trip.paymentMethod,
    favouriteId: trip.favourite?.id ?? null,
    active: trip.active,
    ride: trip.plan.kind === 'ride' ? { rideVertical: trip.plan.rideVertical, pickup: trip.plan.pickup, dropoff: trip.plan.dropoff, doorPickup: trip.plan.doorPickup } : base.ride,
    rajaa: trip.plan.kind === 'rajaa' ? { corridorId: trip.plan.corridorId, direction: trip.plan.direction, garageId: trip.plan.garageId, travellingAs: trip.plan.travellingAs } : base.rajaa,
  };
}

export type DraftProblem = 'need_from' | 'need_to' | 'same_places' | null;

export function draftProblem(d: RegularDraft): DraftProblem {
  if (d.kind !== 'ride') return null;
  if (!d.ride.pickup) return 'need_from';
  if (!d.ride.dropoff) return 'need_to';
  if (d.ride.pickup.pin.lat === d.ride.dropoff.pin.lat && d.ride.pickup.pin.lng === d.ride.dropoff.pin.lng) return 'same_places';
  return null;
}

/** What `rideHabits.regular.save` is sent; null while the draft can't be saved. */
export function toInput(d: RegularDraft): SaveRegularTripInput | null {
  if (draftProblem(d)) return null;
  const remind = d.remind === 'morning' && !morningAllowed(d.timeMin) ? 'evening' : d.remind;
  const plan =
    d.kind === 'ride'
      ? { kind: 'ride' as const, rideVertical: d.ride.rideVertical, pickup: d.ride.pickup!, dropoff: d.ride.dropoff!, doorPickup: d.ride.doorPickup }
      : { kind: 'rajaa' as const, ...d.rajaa };
  return { ...(d.id ? { id: d.id } : {}), days: d.days, timeMin: d.timeMin, remind, paymentMethod: d.paymentMethod, favouriteId: d.favouriteId, active: d.active, plan };
}

let state: RegularDraft = emptyDraft('ride');
const listeners = new Set<() => void>();
const set = (next: RegularDraft) => {
  state = next;
  for (const l of listeners) l();
};

export const regularDraft = {
  get: () => state,
  start: (kind: 'ride' | 'rajaa', prefill: Partial<RegularDraft> = {}) => set({ ...emptyDraft(kind), ...prefill }),
  edit: (trip: RegularTripView) => set(draftOf(trip)),
  update: (patch: Partial<RegularDraft>) => set({ ...state, ...patch }),
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useRegularDraft(): RegularDraft {
  return useSyncExternalStore(regularDraft.subscribe, regularDraft.get, regularDraft.get);
}
