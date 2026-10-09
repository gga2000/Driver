import { useSyncExternalStore } from 'react';
import { MERCHANT_BUSY_RULES, type BoardOrder, type MerchantRemakeResult, type MerchantRemakeRule } from '@driver/contracts';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';
import type { TKey } from '@/lib/i18n';
import { isPractice } from './practice';

/**
 * The server's shop rules (Ali, 2026-10-08; `docs/api/shop-load.md`) as the counter sees them:
 *
 * - h5: a shop whose app sent no heartbeat for 5 minutes takes no new orders (customers see it closed).
 *   The app only pings while it is open, so a phone left in the background pauses the shop too.
 * - l4: from 15 waiting orders customers see the shop busy and every new promise carries +10 min —
 *   never on top of the shop's own busy mode.
 * - c6: a ready order with no courier at the pass for 10 minutes may be remade, Driver paying the first
 *   batch, while `orders.merchant.remakeRule` says so (a money switch).
 *
 * The numbers mirror `SHOP_LOAD_RULES` in the API (`apps/api/src/modules/orders/shop-load.ts`).
 */
export const SHOP_LOAD = {
  offlinePauseAfterMin: 5,
  busyAtWaitingOrders: 15,
  autoBusyMinutes: MERCHANT_BUSY_RULES.extraPrepMinutes,
} as const;

const MIN = 60_000;

// ───────────────────────── l4: automatic busy ─────────────────────────

const WAITING: ReadonlySet<string> = new Set(['placed', 'merchant_accepted', 'preparing']);

/** Orders the kitchen still has to make, as the server counts them (scheduled ones not yet due don't). */
export function waitingOrders(orders: readonly Pick<BoardOrder, 'id' | 'state' | 'scheduledFor'>[], now: number): number {
  return orders.filter((o) => !isPractice(o.id) && WAITING.has(o.state) && (!o.scheduledFor || new Date(o.scheduledFor).getTime() <= now)).length;
}

export interface AutoBusy {
  /** 15 or more orders wait: the storefront says busy. */
  on: boolean;
  waiting: number;
  /** What the automatic busy adds to a new promise: +10, or 0 while the shop's own busy mode is on (never twice). */
  addsMinutes: number;
}

export function autoBusy(waiting: number, manualOn: boolean): AutoBusy {
  const on = waiting >= SHOP_LOAD.busyAtWaitingOrders;
  return { on, waiting, addsMinutes: on && !manualOn ? SHOP_LOAD.autoBusyMinutes : 0 };
}

/** The busy minutes on a promise right now: the shop's own busy mode, else the automatic +10. */
export function busyMinutesNow(manualMinutes: number, auto: AutoBusy): number {
  return manualMinutes > 0 ? manualMinutes : auto.addsMinutes;
}

// ───────────────────────── h5: paused while the app is away ─────────────────────────

/** Whole minutes customers saw the shop closed when the app came back after `prevOkAt` (null: never paused). */
export function pausedMinutes(prevOkAt: number | null, now: number): number | null {
  if (prevOkAt === null) return null;
  const off = now - prevOkAt;
  if (off <= SHOP_LOAD.offlinePauseAfterMin * MIN) return null;
  return Math.max(1, Math.floor((off - SHOP_LOAD.offlinePauseAfterMin * MIN) / MIN));
}

export type PauseView =
  | { kind: 'none' }
  /** Offline, not paused yet: customers see it closed in `minutesLeft`. */
  | { kind: 'soon'; minutesLeft: number }
  /** Offline for 5 minutes or more: customers see the shop closed now. */
  | { kind: 'paused'; offMinutes: number }
  /** Back after a pause: customers saw it closed for about `minutes`. */
  | { kind: 'back'; minutes: number };

/**
 * What the board says about h5. Offline it counts from the last heartbeat the server got (a tablet
 * that never reached it this time has nothing to lose: the plain offline strip). Online, a pause it
 * just came back from shows until the kitchen taps «تمام».
 */
export function pauseView(input: { now: number; online: boolean; lastOkAt: number | null; back: number | null }): PauseView {
  const { now, online, lastOkAt, back } = input;
  if (!online) {
    if (lastOkAt === null) return { kind: 'none' };
    const off = now - lastOkAt;
    const limit = SHOP_LOAD.offlinePauseAfterMin * MIN;
    return off >= limit ? { kind: 'paused', offMinutes: Math.floor(off / MIN) } : { kind: 'soon', minutesLeft: Math.max(1, Math.ceil((limit - off) / MIN)) };
  }
  return back !== null ? { kind: 'back', minutes: back } : { kind: 'none' };
}

interface StoredBeat {
  orgId: string;
  at: number;
}

function parseBeat(raw: string | null): StoredBeat | null {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<StoredBeat>) : null;
    return v && typeof v.orgId === 'string' && typeof v.at === 'number' ? { orgId: v.orgId, at: v.at } : null;
  } catch {
    return null;
  }
}

const BEAT_KEY = 'driver.merchant.beat';

/**
 * The last heartbeat the server answered, per store, kept on the device so a phone that was closed
 * (or a tablet that restarted) knows how long the shop was paused when it comes back.
 */
export function createBeatLog(store: KeyValueStorage) {
  let orgId: string | null = null;
  let lastOkAt: number | null = null;
  let back: number | null = null;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    /** Reads the kept beat for this store (once per store per app start). */
    load(id: string): Promise<void> {
      if (orgId === id && loading) return loading;
      orgId = id;
      lastOkAt = null;
      back = null;
      loading = store
        .getItem(BEAT_KEY)
        .then((raw) => {
          const kept = parseBeat(raw);
          if (orgId === id && kept?.orgId === id && lastOkAt === null) lastOkAt = kept.at;
          emit();
        })
        .catch(() => {});
      return loading;
    },
    /** The server answered a heartbeat: a gap over 5 minutes was a pause the kitchen should hear about. */
    async ok(id: string, now: number): Promise<void> {
      if (orgId !== id) void this.load(id);
      await loading;
      if (orgId !== id) return;
      const gap = pausedMinutes(lastOkAt, now);
      if (gap !== null) back = gap;
      lastOkAt = now;
      emit();
      await store.setItem(BEAT_KEY, JSON.stringify({ orgId: id, at: now } satisfies StoredBeat)).catch(() => {});
    },
    dismiss(): void {
      if (back === null) return;
      back = null;
      emit();
    },
    snapshot: () => ({ lastOkAt, back }),
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

export const beatLog = createBeatLog(platformStorage);

let snap = beatLog.snapshot();
const read = () => {
  const next = beatLog.snapshot();
  if (next.lastOkAt !== snap.lastOkAt || next.back !== snap.back) snap = next;
  return snap;
};

export function useBeatLog(): { lastOkAt: number | null; back: number | null } {
  return useSyncExternalStore(beatLog.subscribe, read, read);
}

// ───────────────────────── c6: remake paid ─────────────────────────

/**
 * «أعدنا تسويه» shows on a ready order only while the rule pays, from `afterReadyMin` after «جاهز»,
 * with no courier at the pass (nor gone with it). Returns the minutes since «جاهز», or null.
 */
export function remakeOffer(o: Pick<BoardOrder, 'id' | 'column' | 'state' | 'readyAt' | 'courier' | 'handedOverAt'>, rule: MerchantRemakeRule | null | undefined, now: number): number | null {
  if (!rule?.pay || isPractice(o.id) || o.column !== 'ready' || o.state !== 'ready' || !o.readyAt || o.handedOverAt) return null;
  if (o.courier.state === 'arrived' || o.courier.state === 'picked_up') return null;
  const since = Math.floor((now - new Date(o.readyAt).getTime()) / MIN);
  return since >= rule.afterReadyMin ? since : null;
}

export type RemakeOutcome = { kind: 'paid'; amountIqd: number } | { kind: 'already' };

export function remakeOutcome(r: Pick<MerchantRemakeResult, 'paidIqd' | 'alreadyPaid'>): RemakeOutcome {
  return r.alreadyPaid ? { kind: 'already' } : { kind: 'paid', amountIqd: r.paidIqd };
}

/** The counter's own words for a refused remake; null = the generic error. */
export function remakeErrorKey(code: string | null): TKey | null {
  if (code === 'order_state_conflict') return 'merchant.remake.err_state';
  if (code === 'money_rule_off') return 'merchant.remake.err_off';
  return null;
}
