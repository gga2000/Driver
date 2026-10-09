import { describe, expect, it } from 'vitest';
import type { BoardOrder } from '@driver/contracts';
import { createMemoryStorage } from '@/lib/storage';
import { PRACTICE_PREFIX } from './practice';

const PRACTICE_ID = `${PRACTICE_PREFIX}1`;
import { autoBusy, busyMinutesNow, createBeatLog, pausedMinutes, pauseView, remakeErrorKey, remakeOffer, remakeOutcome, waitingOrders } from './shop-load';

const NOW = Date.UTC(2026, 9, 8, 15, 0);
const MIN = 60_000;

describe('l4: automatic busy', () => {
  const o = (id: string, state: string, scheduledFor: Date | null = null) => ({ id, state, scheduledFor }) as Pick<BoardOrder, 'id' | 'state' | 'scheduledFor'>;
  it('counts what the server counts: placed, accepted and preparing; scheduled only once due; never the practice', () => {
    const orders = [o('a', 'placed'), o('b', 'merchant_accepted'), o('c', 'preparing'), o('d', 'ready'), o('e', 'placed', new Date(NOW + 30 * MIN)), o('f', 'placed', new Date(NOW - MIN)), o(PRACTICE_ID, 'placed')];
    expect(waitingOrders(orders, NOW)).toBe(4);
  });
  it('switches on at 15 waiting and adds +10 only when the shop’s own busy mode is off', () => {
    expect(autoBusy(14, false)).toEqual({ on: false, waiting: 14, addsMinutes: 0 });
    expect(autoBusy(15, false)).toEqual({ on: true, waiting: 15, addsMinutes: 10 });
    expect(autoBusy(18, true)).toEqual({ on: true, waiting: 18, addsMinutes: 0 });
  });
  it('never adds the minutes twice', () => {
    expect(busyMinutesNow(0, autoBusy(15, false))).toBe(10);
    expect(busyMinutesNow(20, autoBusy(15, true))).toBe(20);
    expect(busyMinutesNow(10, autoBusy(3, true))).toBe(10);
    expect(busyMinutesNow(0, autoBusy(3, false))).toBe(0);
  });
});

describe('h5: paused while the app is away', () => {
  it('a gap over 5 minutes was a pause, counted from the fifth minute', () => {
    expect(pausedMinutes(null, NOW)).toBeNull();
    expect(pausedMinutes(NOW - 4 * MIN, NOW)).toBeNull();
    expect(pausedMinutes(NOW - 5 * MIN, NOW)).toBeNull();
    expect(pausedMinutes(NOW - 5 * MIN - 10_000, NOW)).toBe(1);
    expect(pausedMinutes(NOW - 12 * MIN, NOW)).toBe(7);
  });
  it('offline: soon, then paused; online: back until dismissed', () => {
    expect(pauseView({ now: NOW, online: false, lastOkAt: null, back: null })).toEqual({ kind: 'none' });
    expect(pauseView({ now: NOW, online: false, lastOkAt: NOW - 90_000, back: null })).toEqual({ kind: 'soon', minutesLeft: 4 });
    expect(pauseView({ now: NOW, online: false, lastOkAt: NOW - 8 * MIN, back: null })).toEqual({ kind: 'paused', offMinutes: 8 });
    expect(pauseView({ now: NOW, online: true, lastOkAt: NOW, back: 7 })).toEqual({ kind: 'back', minutes: 7 });
    expect(pauseView({ now: NOW, online: true, lastOkAt: NOW, back: null })).toEqual({ kind: 'none' });
  });
  it('the beat log remembers the last answered heartbeat per store across a restart', async () => {
    const store = createMemoryStorage();
    const first = createBeatLog(store);
    await first.load('khalid');
    await first.ok('khalid', NOW - 12 * MIN);
    expect(first.snapshot()).toEqual({ lastOkAt: NOW - 12 * MIN, back: null });

    // The phone was closed for 12 minutes: the next start hears about a 7-minute pause.
    const again = createBeatLog(store);
    await again.load('khalid');
    await again.ok('khalid', NOW);
    expect(again.snapshot()).toEqual({ lastOkAt: NOW, back: 7 });
    again.dismiss();
    expect(again.snapshot().back).toBeNull();

    // Another store's kept beat says nothing about this one.
    const other = createBeatLog(store);
    await other.load('kareem');
    await other.ok('kareem', NOW + 20 * MIN);
    expect(other.snapshot()).toEqual({ lastOkAt: NOW + 20 * MIN, back: null });
  });
  it('a beat within the 30-s rhythm is never a pause', async () => {
    const log = createBeatLog(createMemoryStorage());
    await log.load('khalid');
    await log.ok('khalid', NOW);
    await log.ok('khalid', NOW + 30_000);
    await log.ok('khalid', NOW + 4 * MIN);
    expect(log.snapshot().back).toBeNull();
  });
});

describe('c6: remake paid', () => {
  const ready = (patch: Partial<BoardOrder> = {}) =>
    ({ id: 'o1', column: 'ready', state: 'ready', readyAt: new Date(NOW - 12 * MIN), handedOverAt: null, courier: { state: 'on_the_way' }, ...patch }) as BoardOrder;
  const on = { pay: true, afterReadyMin: 10 };
  it('shows nothing while the switch is off', () => {
    expect(remakeOffer(ready(), { pay: false, afterReadyMin: 10 }, NOW)).toBeNull();
    expect(remakeOffer(ready(), undefined, NOW)).toBeNull();
  });
  it('from 10 minutes after «جاهز», with no courier at the pass', () => {
    expect(remakeOffer(ready(), on, NOW)).toBe(12);
    expect(remakeOffer(ready({ readyAt: new Date(NOW - 9 * MIN) }), on, NOW)).toBeNull();
    expect(remakeOffer(ready({ readyAt: new Date(NOW - 10 * MIN) }), on, NOW)).toBe(10);
    expect(remakeOffer(ready({ courier: { state: 'searching' } as BoardOrder['courier'] }), on, NOW)).toBe(12);
    expect(remakeOffer(ready({ courier: { state: 'arrived' } as BoardOrder['courier'] }), on, NOW)).toBeNull();
    expect(remakeOffer(ready({ courier: { state: 'picked_up' } as BoardOrder['courier'] }), on, NOW)).toBeNull();
    expect(remakeOffer(ready({ handedOverAt: new Date(NOW - MIN) }), on, NOW)).toBeNull();
    expect(remakeOffer(ready({ column: 'preparing', state: 'preparing' }), on, NOW)).toBeNull();
    expect(remakeOffer(ready({ readyAt: null }), on, NOW)).toBeNull();
    expect(remakeOffer(ready({ id: PRACTICE_ID }), on, NOW)).toBeNull();
  });
  it('says what was paid, or that it was paid before', () => {
    expect(remakeOutcome({ paidIqd: 14_500, alreadyPaid: false })).toEqual({ kind: 'paid', amountIqd: 14_500 });
    expect(remakeOutcome({ paidIqd: 0, alreadyPaid: true })).toEqual({ kind: 'already' });
  });
  it('words its two refusals itself', () => {
    expect(remakeErrorKey('order_state_conflict')).toBe('merchant.remake.err_state');
    expect(remakeErrorKey('money_rule_off')).toBe('merchant.remake.err_off');
    expect(remakeErrorKey('internal')).toBeNull();
    expect(remakeErrorKey(null)).toBeNull();
  });
});
