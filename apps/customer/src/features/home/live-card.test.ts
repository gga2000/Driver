import { describe, expect, it } from 'vitest';
import { LIVE_SEGMENTS, liveStatusKey, liveStep } from './live-card';

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
});
