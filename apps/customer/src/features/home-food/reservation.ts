import { useSyncExternalStore } from 'react';

/**
 * The reservation the cart holds: which home kitchen and at what time the reserved plates come. One
 * per cart (the order is one pre-order at that time). Kept beside the cart until checkout reads it.
 */
export interface CartReservation {
  merchantId: string;
  /** ISO instant of the pickup time. */
  at: string;
}

let current: CartReservation | null = null;
const listeners = new Set<() => void>();

export const reservationStore = {
  get: (): CartReservation | null => current,
  set(next: CartReservation | null): void {
    current = next;
    for (const l of listeners) l();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export function useReservation(): CartReservation | null {
  return useSyncExternalStore(reservationStore.subscribe, reservationStore.get, reservationStore.get);
}
