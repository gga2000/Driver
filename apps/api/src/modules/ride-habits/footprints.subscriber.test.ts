import { describe, expect, it } from 'vitest';
import type { EventHandler } from '../events/index.js';
import { footprintOf, registerFootprints, RIDE_FOOTPRINT_SUBSCRIBER } from './footprints.subscriber.js';

const PLACED = new Date('2026-10-07T04:28:00Z');
const PICKUP = { zoneKey: 'centre', pin: { lat: 32.91, lng: 45.06 }, placeId: 'pl_home' };
const DROPOFF = { zoneKey: 'street_30', pin: { lat: 32.92, lng: 45.07 } };

function placed(payload: Record<string, unknown>) {
  return { orderId: 'ord_1', aggregateId: 'ord_1', actorId: 'c1', occurredAt: PLACED, payload };
}

describe('ride footprints (step 4, o4)', () => {
  it('keeps a placed ride: its ends, vehicle, door pickup and the time he asked', () => {
    expect(footprintOf(placed({ type: 'ride', ride: { vertical: 'tuktuk', pickup: PICKUP, dropoff: DROPOFF, quoteId: null, doorPickup: true }, scheduledFor: null }))).toEqual({
      orderId: 'ord_1',
      vertical: 'tuktuk',
      doorPickup: true,
      pickup: PICKUP,
      dropoff: DROPOFF,
      at: PLACED,
    });
  });

  it('a ride booked for later counts at its booked time; food and pinless rides leave none', () => {
    expect(footprintOf(placed({ type: 'ride', ride: { vertical: 'taxi', pickup: PICKUP, dropoff: DROPOFF }, scheduledFor: '2026-10-08T04:30:00.000Z' }))?.at).toEqual(new Date('2026-10-08T04:30:00.000Z'));
    expect(footprintOf(placed({ type: 'food', merchantOrgId: 'm1' }))).toBeNull();
    expect(footprintOf(placed({ type: 'ride', ride: { vertical: 'taxi', pickup: { zoneKey: 'centre' }, dropoff: DROPOFF } }))).toBeNull();
  });

  it('records it for the rider on order.placed', async () => {
    let handler: EventHandler | null = null;
    const recorded: Array<[string, string]> = [];
    registerFootprints(
      {
        subscribe: (name, types, h) => {
          expect([name, types]).toEqual([RIDE_FOOTPRINT_SUBSCRIBER, ['order.placed']]);
          handler = h;
          return () => {};
        },
      },
      { recordRide: async (personId, f) => void recorded.push([personId, f.orderId]) },
    );
    const e = { ...placed({ type: 'ride', ride: { vertical: 'taxi', pickup: PICKUP, dropoff: DROPOFF } }), id: 'ev1', outboxId: 'ob1', type: 'order.placed', recordedAt: PLACED, aggregate: 'order', skewMs: 0, flagged: false, quarantined: false };
    await handler!(e, {} as Parameters<EventHandler>[1]);
    expect(recorded).toEqual([['c1', 'ord_1']]);
  });
});
