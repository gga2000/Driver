import { describe, expect, it } from 'vitest';
import { DOMAIN_EVENT_PAYLOADS, decodeDomainEvent, encodeDomainEvent, isDomainEventType } from './domain-events.js';

const at = new Date('2026-10-03T12:00:00Z');

const workedExample = {
  orderId: 'o1',
  tripId: 't1',
  orderType: 'food' as const,
  occurredAt: at,
  customerId: 'c1',
  payment: 'cash' as const,
  merchantId: 'm1',
  courierId: 'k1',
  itemsSubtotalIqd: 15000,
  commissionTier: 'featured' as const,
  serviceFeeIqd: 500,
  deliveryFeeIqd: 1000,
};

describe('domain event contracts', () => {
  it('encode validates, applies defaults and returns the JSON wire form; decode restores dates', () => {
    const wire = encodeDomainEvent('order.cash_collected', {
      kind: 'order',
      order: { ...workedExample, cashCollectedIqd: 16500 },
      tripId: 't1',
      courierId: 'k1',
      amountIqd: 16500,
      expectedIqd: 16500,
      discrepancyIqd: 0,
    });
    expect(wire).toMatchObject({ kind: 'order', order: { occurredAt: '2026-10-03T12:00:00.000Z', pointsRedeemed: 0, participants: [] } });
    const decoded = decodeDomainEvent('order.cash_collected', wire);
    expect(decoded.kind).toBe('order');
    if (decoded.kind === 'order') expect(decoded.order.occurredAt).toEqual(at);
  });

  it('a producer payload that drifts from the contract is refused at encode time', () => {
    // the pre-wiring orders payload: no customer, no beneficiary
    expect(() => encodeDomainEvent('order.cancelled', { from: 'merchant_accepted', to: 'customer_cancelled', by: 'customer', reason: 'x', feeIqd: 500, free: false } as never)).toThrow();
    expect(() =>
      encodeDomainEvent('order.cancelled', {
        from: 'merchant_accepted',
        to: 'customer_cancelled',
        cancelledState: 'customer_cancelled',
        orderId: 'o1',
        occurredAt: at,
        customerId: 'c1',
        by: 'customer',
        reason: 'customer_request',
        free: false,
        feeIqd: 1000,
        beneficiaries: [{ kind: 'merchant', id: 'm1', amountIqd: 500 }],
      }),
    ).toThrow(/add up to the fee/);
  });

  it('extra envelope keys merged in by a consumer do not break decoding', () => {
    const wire = encodeDomainEvent('trip.completed', { from: 'arrived_dropoff', to: 'completed', by: 'driver', reason: 'all_stops_done', orderIds: ['o1'] });
    expect(decodeDomainEvent('trip.completed', { ...wire, actorId: 'k1', occurredAt: at.toISOString(), tripId: 't1' })).toMatchObject({ by: 'driver', orderIds: ['o1'] });
  });

  it('registers every event the ledger settles', () => {
    for (const t of ['order.cash_collected', 'order.closed', 'order.cancelled', 'seat.completed', 'seat.no_show', 'seat.late_meter_settled', 'departure.cancelled', 'subscription.started', 'subscription.renewed', 'subscription.prorated', 'merchant.settlement_requested']) {
      expect(isDomainEventType(t)).toBe(true);
    }
    expect(isDomainEventType('order.placed')).toBe(false);
    expect(Object.keys(DOMAIN_EVENT_PAYLOADS).length).toBeGreaterThan(15);
  });

  it('registers the safety incident events the on-call module reads', () => {
    const opened = encodeDomainEvent('safety.incident_opened', { incidentId: 'si1', kind: 'sos', cityId: 'aziziyah', zoneKey: null, orderId: 'o1', rideId: null, tripId: 't1', createdAt: at });
    expect(opened).toMatchObject({ createdAt: '2026-10-03T12:00:00.000Z' });
    expect(decodeDomainEvent('safety.incident_opened', opened).createdAt).toEqual(at);
    expect(decodeDomainEvent('safety.incident_acked', encodeDomainEvent('safety.incident_acked', { incidentId: 'si1', byPersonId: 'p1' }))).toEqual({ incidentId: 'si1', byPersonId: 'p1' });
    expect(decodeDomainEvent('safety.incident_closed', encodeDomainEvent('safety.incident_closed', { incidentId: 'si1', outcome: 'false_alarm', byPersonId: null }))).toMatchObject({ outcome: 'false_alarm' });
    expect(() => encodeDomainEvent('safety.incident_acked', { incidentId: 'si1' } as never)).toThrow();
  });
});
