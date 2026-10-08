import { describe, expect, it } from 'vitest';
import { helpCase, issueKinds } from './issue';

describe('help: which "عندي مشكلة" an order gets', () => {
  it('opens a complaint only inside the dispute window, like orders.openDispute', () => {
    expect(helpCase({ state: 'delivered' })).toBe('dispute');
    expect(helpCase({ state: 'completed' })).toBe('dispute');
    expect(helpCase({ state: 'disputed' })).toBe('disputed');
    expect(helpCase({ state: 'closed' })).toBe('closed');
    expect(helpCase({ state: 'refunded' })).toBe('closed');
    expect(helpCase({ state: 'customer_cancelled' })).toBe('cancelled');
    expect(helpCase({ state: 'preparing' })).toBe('running');
    expect(helpCase({ state: 'matched' })).toBe('running');
  });
  it('offers ride kinds on rides and food kinds otherwise', () => {
    expect(issueKinds('ride').map((k) => k.kind)).toEqual(['ride_fare', 'driver_behaviour', 'unsafe_driving', 'other']);
    expect(issueKinds('food').map((k) => k.kind)).toEqual(['cold_or_late', 'missing_item', 'wrong_item', 'not_delivered', 'other']);
  });
});
