import { describe, expect, it } from 'vitest';
import { floatMode, rideCanCancel } from './ride-actions';

describe('ride actions by phase (J1c f4, L-16)', () => {
  it('cancel until the rider is in the car', () => {
    expect(rideCanCancel('searching')).toBe(true);
    expect(rideCanCancel('to_pickup')).toBe(true);
    expect(rideCanCancel('at_pickup')).toBe(true);
    expect(rideCanCancel('on_the_way')).toBe(false);
    expect(rideCanCancel('arrived')).toBe(false);
    expect(rideCanCancel('cancelled')).toBe(false);
  });
  it('the float shows the plate before pickup and share on the trip', () => {
    expect(floatMode('to_pickup')).toBe('plate');
    expect(floatMode('at_pickup')).toBe('plate');
    expect(floatMode('on_the_way')).toBe('trip');
  });
});
