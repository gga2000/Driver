import { describe, expect, it } from 'vitest';
import type { Order } from '@driver/contracts';
import { LIVE_SEGMENTS, STAGE_LOOK, liveProgress, liveStage, liveStatusKey, liveStep, newerRead, stageEtaKey, stageTitleKey } from './live-card';

describe('the live-order card bar (4 segments, discovery §6)', () => {
  it('a food order fills one segment per step: sent, accepted, cooking, on the way', () => {
    expect(LIVE_SEGMENTS).toBe(4);
    expect(liveStep({ type: 'food', state: 'placed' })).toBe(1);
    expect(liveStep({ type: 'food', state: 'merchant_accepted' })).toBe(2);
    expect(liveStep({ type: 'food', state: 'preparing' })).toBe(3);
    expect(liveStep({ type: 'food', state: 'ready' })).toBe(3);
    expect(liveStep({ type: 'food', state: 'picked_up' })).toBe(4);
  });
  it('a ride: searching, driver coming, on the trip', () => {
    expect(liveStep({ type: 'ride', state: 'placed' })).toBe(1);
    expect(liveStep({ type: 'ride', state: 'matched' })).toBe(2);
    expect(liveStep({ type: 'ride', state: 'picked_up' })).toBe(4);
  });
  it('the status line reads as a trip for rides and as the order state otherwise', () => {
    expect(liveStatusKey({ type: 'ride', state: 'placed' })).toBe('trip.status.offered');
    expect(liveStatusKey({ type: 'ride', state: 'matched' })).toBe('trip.status.en_route_to_pickup');
    expect(liveStatusKey({ type: 'food', state: 'preparing' })).toBe('order.status.preparing');
  });
  it('the courier rides to the end of the current step, and on the way toward the door as the time nears', () => {
    const at = (min: number) => new Date(Date.UTC(2026, 9, 7, 12, min));
    expect(liveProgress({ type: 'food', state: 'preparing', pickedUpAt: null }, at(30), at(0).getTime())).toBe(0.75);
    const onTheWay = { type: 'food', state: 'picked_up', pickedUpAt: at(0) } as const;
    // Picked up at 12:00, due 12:20: at 12:10 he is halfway along the last segment.
    expect(liveProgress(onTheWay, at(20), at(10).getTime())).toBeCloseTo(0.875);
    // Just picked up: a little way along; late: almost there, never at the door before «وصل».
    expect(liveProgress(onTheWay, at(20), at(0).getTime())).toBeCloseTo(0.77);
    expect(liveProgress(onTheWay, at(20), at(40).getTime())).toBeCloseTo(0.98);
    // No estimate (or no pickup time): halfway along.
    expect(liveProgress(onTheWay, null, at(10).getTime())).toBeCloseTo(0.875);
    expect(liveProgress({ type: 'ride', state: 'picked_up', pickedUpAt: null }, at(20), at(10).getTime())).toBeCloseTo(0.875);
  });
  it('of the list and the tracking read, the card follows whichever is further along', () => {
    type Read = Pick<Order, 'type' | 'state'>;
    const list: Read = { type: 'food', state: 'ready' };
    expect(newerRead(list, { type: 'food', state: 'preparing' })).toBe(list);
    const ahead: Read = { type: 'food', state: 'picked_up' };
    expect(newerRead(list, ahead)).toBe(ahead);
    const same: Read = { type: 'food', state: 'ready' };
    expect(newerRead(list, same)).toBe(same);
    expect(newerRead(list, null)).toBe(list);
  });
});

describe('each stage of the live-order card has its own look (Ali, 2026-10-07)', () => {
  it('food: sent, the kitchen said yes, cooking, ready, on the way', () => {
    const stages = (['placed', 'merchant_accepted', 'preparing', 'ready', 'picked_up'] as const).map((state) => liveStage({ type: 'food', state }));
    expect(stages).toEqual(['sent', 'accepted', 'cooking', 'ready', 'onTheWay']);
    expect(new Set(stages.map((s) => STAGE_LOOK[s])).size).toBe(5);
  });
  it('a ride: looking for a driver, the driver coming, on the trip, in the food looks', () => {
    const stages = (['placed', 'matched', 'picked_up'] as const).map((state) => liveStage({ type: 'ride', state }));
    expect(stages).toEqual(['searching', 'driverComing', 'onTrip']);
    expect(stages.map((s) => STAGE_LOOK[s])).toEqual(['sent', 'accepted', 'onTheWay']);
  });
  it('the time is the food arriving, the driver reaching you, or you arriving', () => {
    expect(stageEtaKey('cooking')).toBe('home.stage.eta_food');
    expect(stageEtaKey('driverComing')).toBe('home.stage.eta_pickup');
    expect(stageEtaKey('onTrip')).toBe('home.stage.eta_trip');
    expect(stageTitleKey('onTheWay')).toBe('home.stage.on_the_way');
  });
});
