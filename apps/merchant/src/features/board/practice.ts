import { useSyncExternalStore } from 'react';
import type { BoardOrder } from '@driver/contracts';

/**
 * «طلب تجربة» (counter step 6, s2): a practice order for new staff. It rings, prints and goes through
 * the pass like a real one — accept, «صار جاهز», the courier walks in and says his code, «سلّمته» —
 * but it lives only on this device: no request about it ever reaches the server, so no customer, no
 * courier and no money is involved. The transitions are pure (tested); the store below runs them.
 */

export const PRACTICE_PREFIX = 'practice-';
export const PRACTICE_NUMBER = '0000';
/** The real 90-s window, so the ring and the ladder behave as they will on the day. */
export const PRACTICE_ACCEPT_MS = 90_000;
/** After «اقبل»: a courier takes it. After «صار جاهز»: he reaches the counter. After «سلّمته»: it leaves. */
export const PRACTICE_COURIER_MS = 2_500;
export const PRACTICE_ARRIVE_MS = 4_000;
export const PRACTICE_LEAVE_MS = 3_000;

export function isPractice(orderId: string | null | undefined): boolean {
  return !!orderId && orderId.startsWith(PRACTICE_PREFIX);
}

/** A believable Aziziyah ticket with one red line to read first (the lesson's card 1). */
export function practiceOrder(now: number, names: { tikka: string; soup: string; samoon: string; spicy: string; note: string }): BoardOrder {
  const at = new Date(now);
  return {
    id: `${PRACTICE_PREFIX}${now}`,
    number: PRACTICE_NUMBER,
    column: 'new',
    state: 'placed',
    type: 'food',
    placedAt: at,
    offeredAt: at,
    acceptBy: new Date(now + PRACTICE_ACCEPT_MS),
    acceptedAt: null,
    promisedReadyAt: null,
    readyAt: null,
    scheduledFor: null,
    prepMinutes: null,
    paymentMethod: 'cash',
    itemsTotalIqd: 14_000,
    totalIqd: 16_000,
    collectCashIqd: 16_000,
    itemCount: 3,
    groups: [
      {
        key: 'orderer',
        kind: 'orderer',
        label: null,
        note: null,
        itemCount: 3,
        lines: [
          { lineId: 'p1', name: names.tikka, qty: 2, modifiers: [names.samoon, names.spicy], note: null, unitPriceIqd: 5_500, totalIqd: 11_000, availability: 'available' },
          { lineId: 'p2', name: names.soup, qty: 1, modifiers: [], note: null, unitPriceIqd: 3_000, totalIqd: 3_000, availability: 'available' },
        ],
      },
    ],
    note: names.note,
    courierNote: null,
    partial: null,
    courier: { state: 'none', firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null, distanceM: null, bearingDeg: null, plate: null, pickupCode: null },
    late: false,
    catering: false,
    prepExtended: false,
    handedOverAt: null,
    gift: null,
  };
}

export type PracticeStep =
  | { kind: 'accept'; prepMinutes: number }
  | { kind: 'extend' }
  | { kind: 'ready' }
  | { kind: 'courier_coming' }
  | { kind: 'courier_arrived' }
  | { kind: 'hand_over' };

/** The practice courier: the same name, plate and 4-digit code every time, so the trainer can say them. */
export const PRACTICE_COURIER = { firstName: 'حيدر', plate: 'واسط 45678', pickupCode: '6574' } as const;

/** One step of the practice order, as the server would move a real one. Steps out of turn change nothing. */
export function practiceStep(o: BoardOrder, step: PracticeStep, now: number): BoardOrder {
  const at = new Date(now);
  switch (step.kind) {
    case 'accept':
      if (o.column !== 'new') return o;
      return { ...o, column: 'preparing', state: 'preparing', acceptBy: null, acceptedAt: at, prepMinutes: step.prepMinutes, promisedReadyAt: new Date(now + step.prepMinutes * 60_000) };
    case 'extend':
      if (o.column !== 'preparing' || o.prepExtended || !o.promisedReadyAt) return o;
      return { ...o, prepExtended: true, promisedReadyAt: new Date(o.promisedReadyAt.getTime() + 5 * 60_000) };
    case 'ready':
      if (o.column !== 'preparing') return o;
      return { ...o, column: 'ready', state: 'ready', readyAt: at, late: false };
    case 'courier_coming':
      if (o.courier.state !== 'none') return o;
      return { ...o, courier: { ...o.courier, state: 'on_the_way', vehicleClass: 'bike', etaMinutes: 3, distanceM: 900, bearingDeg: 40, ...PRACTICE_COURIER } };
    case 'courier_arrived':
      if (o.column !== 'ready' || o.courier.state === 'arrived') return o;
      return { ...o, courier: { ...o.courier, state: 'arrived', vehicleClass: 'bike', etaMinutes: null, arrivedAt: at, distanceM: 0, bearingDeg: null, ...PRACTICE_COURIER } };
    case 'hand_over':
      if (o.column !== 'ready' || o.courier.state !== 'arrived' || o.handedOverAt) return o;
      return { ...o, handedOverAt: at };
  }
}

// ───────────────────────── the device-local store ─────────────────────────

/** How a practice ended: handed over (the lesson is learned), rejected, or the 90 s ran out. */
export type PracticeEnd = 'done' | 'rejected' | 'timeout' | 'stopped';

interface PracticeState {
  order: BoardOrder | null;
  /** The last ending, until the board has said it (a toast) and cleared it. */
  ended: PracticeEnd | null;
}

let state: PracticeState = { order: null, ended: null };
const timers = new Set<ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const set = (next: PracticeState) => {
  state = next;
  for (const l of listeners) l();
};
const later = (ms: number, fn: () => void) => {
  const id = setTimeout(() => {
    timers.delete(id);
    fn();
  }, ms);
  timers.add(id);
};
const clearTimers = () => {
  for (const id of timers) clearTimeout(id);
  timers.clear();
};
const step = (s: PracticeStep) => {
  if (state.order) set({ ...state, order: practiceStep(state.order, s, Date.now()) });
};

export const practice = {
  start(order: BoardOrder) {
    clearTimers();
    set({ order, ended: null });
    later(Math.max(0, (order.acceptBy?.getTime() ?? Date.now()) - Date.now()), () => {
      if (state.order?.column === 'new') practice.end('timeout');
    });
  },
  end(how: PracticeEnd) {
    clearTimers();
    set({ order: null, ended: state.order ? how : state.ended });
  },
  /** The board said how it ended. */
  clearEnded() {
    if (state.ended) set({ ...state, ended: null });
  },
  /** What the order actions do for a practice order instead of calling the server. */
  run(action: 'accept' | 'reject' | 'ready' | 'extend' | 'handOver', input: { prepMinutes?: number }): Promise<void> {
    const o = state.order;
    if (!o) return Promise.resolve();
    switch (action) {
      case 'accept':
        step({ kind: 'accept', prepMinutes: input.prepMinutes ?? 20 });
        later(PRACTICE_COURIER_MS, () => step({ kind: 'courier_coming' }));
        break;
      case 'reject':
        practice.end('rejected');
        break;
      case 'extend':
        step({ kind: 'extend' });
        break;
      case 'ready':
        step({ kind: 'ready' });
        later(PRACTICE_ARRIVE_MS, () => step({ kind: 'courier_arrived' }));
        break;
      case 'handOver':
        step({ kind: 'hand_over' });
        later(PRACTICE_LEAVE_MS, () => practice.end('done'));
        break;
    }
    return Promise.resolve();
  },
  snapshot: () => state,
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};

export function usePractice(): PracticeState {
  return useSyncExternalStore(practice.subscribe, practice.snapshot, practice.snapshot);
}
