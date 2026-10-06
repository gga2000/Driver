import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { BoardOrder } from '@driver/contracts';
import { canPlay, chime, onUnlock, setLoop, stopVibration, vibrate } from '@/lib/alert-sound';
import { alarmAction, alarmPlan, snooze as snoozeMap, STAGE_VOLUME, VIBRATION, type AlarmPlan, type RingCandidate } from './ladder';

/**
 * The new-order alarm, app-wide (it rings on any screen — menu, money… — until every new order is
 * answered). The ladder (ladder.ts) decides what to play: a chime every 4 s, every 2 s in the last
 * 30 s, a continuous tone in the last 10 s. "سكّت 30 ثانية" snoozes, never for good. An order whose
 * accept/reject sheet is open stays quiet until the sheet closes. State is device memory only: after a
 * restart an unanswered order rings again, which is what a kitchen wants.
 */

/** How often the ladder is checked. */
export const ALARM_TICK_MS = 250;

let snoozedUntil = new Map<string, number>();
let handling = new Set<string>();
let soundReady = canPlay();
let lastChimeAt = 0;
let finalBuzzing = false;
const EMPTY: AlarmPlan = { ringing: [], snoozed: [], stage: null, mostUrgent: null, snoozeEndsAt: null, closed: [] };
let plan: AlarmPlan = EMPTY;
let planKey = '';
let candidates: RingCandidate[] = [];
/** The store is closed (by hand or out of hours): waiting orders show, nothing rings (m6a). */
let storeClosed = false;

const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
onUnlock(() => {
  soundReady = true;
  emit();
});

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** New orders that should ring (partial accepts wait for the customer, not the kitchen). */
export function ringCandidates(orders: readonly BoardOrder[]): RingCandidate[] {
  return orders.filter((o) => o.column === 'new' && o.partial === null).map((o) => ({ id: o.id, number: o.number, acceptByMs: o.acceptBy ? o.acceptBy.getTime() : null }));
}

function publish(next: AlarmPlan) {
  const key = [next.ringing.join(','), next.snoozed.join(','), next.closed.join(','), next.stage, next.mostUrgent?.id, next.mostUrgent?.msLeft === null || !next.mostUrgent ? '' : Math.ceil(next.mostUrgent.msLeft / 1000), next.snoozeEndsAt === null ? '' : Math.ceil(next.snoozeEndsAt / 1000)].join('|');
  plan = next;
  if (key !== planKey) {
    planKey = key;
    emit();
  }
}

function quiet() {
  setLoop(false);
  if (finalBuzzing) stopVibration();
  finalBuzzing = false;
}

/** One check of the ladder: plays, loops or stays quiet. `serverNow` times the windows; spacing uses the device clock. */
function tick(serverNow: number, soundOn: boolean) {
  const next = alarmPlan(candidates, snoozedUntil, handling, serverNow, storeClosed);
  publish(next);
  const action = alarmAction(next.stage, lastChimeAt, Date.now(), soundOn && soundReady);
  switch (action.kind) {
    case 'silent':
    case 'wait':
      if (action.kind === 'silent' || finalBuzzing) quiet();
      return;
    case 'chime':
      quiet();
      lastChimeAt = Date.now();
      chime(STAGE_VOLUME[action.stage]);
      vibrate(VIBRATION[action.stage]);
      return;
    case 'loop':
      setLoop(true);
      if (!finalBuzzing) vibrate(VIBRATION.final, true);
      finalBuzzing = true;
      lastChimeAt = Date.now();
      return;
  }
}

export const alarm = {
  /** The accept/reject sheet for this order is open: quiet until `release`. */
  handle(id: string) {
    if (handling.has(id)) return;
    handling = new Set([...handling, id]);
    emit();
  },
  release(id: string) {
    if (!handling.has(id)) return;
    const next = new Set(handling);
    next.delete(id);
    handling = next;
    emit();
  },
  /** "سكّت 30 ثانية": the orders ringing now go quiet for 30 s (or until 20 s are left). */
  snooze(now: number) {
    snoozedUntil = snoozeMap(snoozedUntil, plan.ringing, now, candidates.map((c) => c.id));
    quiet();
    publish(alarmPlan(candidates, snoozedUntil, handling, now, storeClosed));
  },
  /** "رجّع الصوت": ends every snooze now. */
  unsnooze(now: number) {
    snoozedUntil = new Map();
    lastChimeAt = 0;
    publish(alarmPlan(candidates, snoozedUntil, handling, now, storeClosed));
  },
  /** A new order arrived on the live channel: ring now, before the board is re-read. */
  ringNow(orderId: string, soundOn: boolean) {
    if (storeClosed || !soundOn || !soundReady || handling.has(orderId) || (snoozedUntil.get(orderId) ?? 0) > Date.now()) return;
    lastChimeAt = Date.now();
    chime(STAGE_VOLUME.calm);
    vibrate(VIBRATION.calm);
  },
  plan: () => plan,
  handling: () => handling,
  subscribe,
};

export function useAlarmPlan(): AlarmPlan {
  return useSyncExternalStore(subscribe, alarm.plan, alarm.plan);
}

/** Orders whose sheet is open (quiet while the cook decides). */
export function useHandling(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, alarm.handling, alarm.handling);
}

/** Whether the browser lets us play sound yet (always true on native). */
export function useSoundReady(): boolean {
  return useSyncExternalStore(subscribe, () => soundReady, () => soundReady);
}

/**
 * Runs the ladder while the app is open on a store (mounted once, in MerchantRuntime). `clock` is the
 * server clock (board offset), so the 90-s windows match the server's auto-reject. `closed`: the
 * store is closed (`alarmQuiet`), so waiting orders are shown without a sound (m6a).
 */
export function useNewOrderAlarm(orders: readonly BoardOrder[] | undefined, soundOn: boolean, clock: () => number, closed = false): AlarmPlan {
  const clockRef = useRef(clock);
  clockRef.current = clock;
  candidates = orders ? ringCandidates(orders) : [];
  storeClosed = closed;
  // Re-armed when the store closes or opens: closing silences at once, opening rings straight away.
  useEffect(() => {
    tick(clockRef.current(), soundOn);
    const id = setInterval(() => tick(clockRef.current(), soundOn), ALARM_TICK_MS);
    return () => {
      clearInterval(id);
      quiet();
    };
  }, [soundOn, closed]);
  return useAlarmPlan();
}
