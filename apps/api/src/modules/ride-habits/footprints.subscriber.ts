import { z } from 'zod';
import { DeliveryPoint, type RideFootprint } from '@driver/contracts';
import type { EventsService, PublishedEvent } from '../events/index.js';
import type { RideHabitsService } from './ride-habits.service.js';

/** Subscriber name, and so the dedupe key in `subscriber_deliveries`. */
export const RIDE_FOOTPRINT_SUBSCRIBER = 'ride-habits:footprints';

/** A booked end with its pin (a ride is always booked from and to a pin). */
const End = DeliveryPoint.pick({ zoneKey: true, placeId: true }).extend({ pin: DeliveryPoint.shape.pin.unwrap() });

/** The ride part of `order.placed` (orders adds it for `type: 'ride'`). */
const RidePlaced = z.object({
  type: z.literal('ride'),
  ride: z.object({
    vertical: z.enum(['taxi', 'tuktuk']),
    pickup: End,
    dropoff: End,
    doorPickup: z.boolean().optional(),
  }),
  scheduledFor: z.string().nullable().optional(),
});

/**
 * Step 4 (o4): the footprint a placed ride leaves — its ends, vehicle, door pickup and the time he
 * wanted it (the booked time of a ride for later, else when he asked). Null for anything else.
 */
export function footprintOf(e: Pick<PublishedEvent, 'orderId' | 'aggregateId' | 'occurredAt' | 'payload'>): RideFootprint | null {
  const parsed = RidePlaced.safeParse(e.payload);
  if (!parsed.success) return null;
  const p = parsed.data;
  const scheduledFor = p.scheduledFor ? new Date(p.scheduledFor) : null;
  return {
    orderId: e.orderId ?? e.aggregateId,
    vertical: p.ride.vertical,
    doorPickup: p.ride.doorPickup ?? false,
    pickup: p.ride.pickup,
    dropoff: p.ride.dropoff,
    at: scheduledFor && !Number.isNaN(scheduledFor.getTime()) ? scheduledFor : e.occurredAt,
  };
}

/**
 * `ride-habits:footprints` on `order.placed`: every ride a rider books is kept as a footprint (one per
 * order, so an at-least-once redelivery writes nothing twice). Finished or not is read when the
 * «نفس مشوار البارحة؟» job looks, so a cancelled ride never makes a habit.
 */
export function registerFootprints(events: Pick<EventsService, 'subscribe'>, habits: Pick<RideHabitsService, 'recordRide'>): () => void {
  return events.subscribe(RIDE_FOOTPRINT_SUBSCRIBER, ['order.placed'], async (e) => {
    const f = footprintOf(e);
    if (f) await habits.recordRide(e.actorId, f);
  });
}
