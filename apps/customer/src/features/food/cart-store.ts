import { useEffect, useSyncExternalStore } from 'react';
import { session } from '@/lib/session';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';
import {
  EMPTY_CART,
  addLine,
  removeLine,
  setQty,
  type AddResult,
  type CartLine,
  type CartMerchant,
  type CartPerson,
  type CartState,
  type NewCartLine,
} from './cart';
import type { PlaceAttempt } from './place-attempt';

/**
 * The cart on this device: a tiny external store (same pattern as `lib/profile.ts`) persisted to
 * local storage so a cart survives a reload or an app restart. `placed` keeps the cart of the order
 * waiting for the kitchen, so a rejection can carry it to another restaurant.
 *
 * Saved people ("لمن؟" → أنا / saved people / new) live here too. TODO(api): when a customer
 * people/profile API lands, keep this as its offline cache.
 */

export type SavedPerson = CartPerson;

/** Someone else receiving the order: their name and phone (E.164), kept on this device only. */
export interface PlacedRecipient {
  name: string;
  phone: string;
}

export interface RemovedLine {
  line: CartLine;
  merchant: CartMerchant;
  person: CartPerson | null;
}

export interface CartStoreState {
  loaded: boolean;
  cart: CartState;
  /**
   * The order waiting for the kitchen and the cart it came from; `recipient` when someone else
   * receives it (joy o12: the kitchen screen offers to send them the tracking link on WhatsApp).
   */
  placed: { orderId: string; cart: CartState; recipient?: PlacedRecipient | null } | null;
  people: SavedPerson[];
  /**
   * The checkout attempt whose answer never came (no duplicate orders): its key is re-sent until the
   * order is placed or refused. Persisted, so it survives a reload or an app kill mid-request.
   */
  pending?: PlaceAttempt | null;
}

const KEY = 'driver.customer.cart';
const INITIAL: CartStoreState = { loaded: false, cart: EMPTY_CART, placed: null, people: [] };

function isCart(x: unknown): x is CartState {
  return !!x && typeof x === 'object' && Array.isArray((x as CartState).lines) && Array.isArray((x as CartState).people);
}

export function createCartStore(store: KeyValueStorage) {
  let state: CartStoreState = INITIAL;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function emit(next: CartStoreState) {
    state = next;
    for (const l of listeners) l();
    const { loaded: _loaded, ...persisted } = next;
    void _loaded;
    void store.setItem(KEY, JSON.stringify(persisted)).catch(() => {});
  }

  let personSeq = 0;

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
        let parsed: Partial<CartStoreState> = {};
        try {
          const raw = await store.getItem(KEY);
          if (raw) parsed = JSON.parse(raw) as Partial<CartStoreState>;
        } catch {
          parsed = {};
        }
        state = {
          loaded: true,
          cart: isCart(parsed.cart) ? parsed.cart : EMPTY_CART,
          placed:
            parsed.placed && typeof parsed.placed.orderId === 'string' && isCart(parsed.placed.cart)
              ? {
                  orderId: parsed.placed.orderId,
                  cart: parsed.placed.cart,
                  recipient: parsed.placed.recipient && typeof parsed.placed.recipient.name === 'string' && typeof parsed.placed.recipient.phone === 'string' ? parsed.placed.recipient : null,
                }
              : null,
          people: Array.isArray(parsed.people) ? parsed.people.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string') : [],
          pending: parsed.pending && typeof parsed.pending.key === 'string' && typeof parsed.pending.signature === 'string' ? { key: parsed.pending.key, signature: parsed.pending.signature, unknownSince: typeof parsed.pending.unknownSince === 'number' ? parsed.pending.unknownSince : null } : null,
        };
        for (const l of listeners) l();
      })();
      return loading;
    },
    /** Adds a line; `other_merchant` when the cart holds another kitchen's food (ask, then `replace`). */
    add(merchant: CartMerchant, line: NewCartLine, opts: { replace?: boolean } = {}): AddResult {
      const person = line.personId !== 'me' ? state.people.find((p) => p.id === line.personId) : undefined;
      const res = addLine(state.cart, merchant, line, { ...opts, ...(person ? { person } : {}) });
      if (res.ok) emit({ ...state, cart: res.cart });
      return res;
    },
    setQty(key: string, qty: number) {
      emit({ ...state, cart: setQty(state.cart, key, qty) });
    },
    /** Removes a line; returns what `restore` needs to undo it. */
    remove(key: string): RemovedLine | null {
      const line = state.cart.lines.find((l) => l.key === key);
      const merchant = state.cart.merchant;
      if (!line || !merchant) return null;
      const person = state.cart.people.find((p) => p.id === line.personId) ?? null;
      emit({ ...state, cart: removeLine(state.cart, key) });
      return { line, merchant, person };
    },
    /** Puts a removed line back (undo), unless the cart moved to another kitchen meanwhile. */
    restore(removed: RemovedLine) {
      const { line, merchant, person } = removed;
      const res = addLine(state.cart, merchant, line, { key: line.key, ...(person ? { person } : {}) });
      if (res.ok) emit({ ...state, cart: res.cart });
    },
    replaceCart(cart: CartState) {
      emit({ ...state, cart });
    },
    clear() {
      emit({ ...state, cart: EMPTY_CART });
    },
    /** The order is placed: the cart moves to `placed` until the kitchen answers. */
    markPlaced(orderId: string, recipient: PlacedRecipient | null = null) {
      emit({ ...state, placed: { orderId, cart: state.cart, recipient }, cart: EMPTY_CART, pending: null });
    },
    /** The checkout attempt in progress or with an unknown outcome (null: none). */
    setPending(attempt: PlaceAttempt | null) {
      emit({ ...state, pending: attempt });
    },
    /** The kitchen accepted (or the person moved on): forget the waiting cart. */
    settlePlaced(orderId: string) {
      if (state.placed?.orderId === orderId) emit({ ...state, placed: null });
    },
    /** Sign-out: nothing of this person's stays on the device. */
    reset() {
      emit({ ...INITIAL, loaded: true });
    },
    addPerson(name: string, phone: string | null): SavedPerson {
      personSeq += 1;
      const person: SavedPerson = { id: `pp_${Date.now().toString(36)}${personSeq}`, name: name.trim(), phone };
      emit({ ...state, people: [...state.people, person] });
      return person;
    },
  };
  return api;
}

export const cartStore = createCartStore(platformStorage);
session.onSignOut(() => cartStore.reset());

export function useCartStore(): CartStoreState {
  useEffect(() => {
    void cartStore.load();
  }, []);
  return useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot, cartStore.getSnapshot);
}

export function useCart(): CartState {
  return useCartStore().cart;
}

/**
 * A slice of the cart that redraws its reader only when the slice changes (perf t1): a menu row reads
 * its own count, so a «+» redraws that row and the cart bar, not the whole menu. `select` must return
 * a plain value (number, string, boolean) or something kept stable between calls.
 */
export function useCartSelect<T>(select: (state: CartStoreState) => T): T {
  useEffect(() => {
    void cartStore.load();
  }, []);
  const get = () => select(cartStore.getSnapshot());
  return useSyncExternalStore(cartStore.subscribe, get, get);
}

/** How many of this dish are in the cart, when the cart is this kitchen's (0 otherwise). */
export function countIn(cart: CartState, merchantId: string, itemId: string): number {
  if (cart.merchant?.id !== merchantId) return 0;
  let n = 0;
  for (const l of cart.lines) if (l.itemId === itemId) n += l.qty;
  return n;
}

export function useItemCount(merchantId: string, itemId: string): number {
  return useCartSelect((s) => countIn(s.cart, merchantId, itemId));
}
