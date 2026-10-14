import { z } from 'zod';
import { Order } from './order.js';

// Re-exported from tracking; its own module so habits-io's usuals don't carry the whole tracking file.

/** One dish on a history row: the name as the menu has it (or the line's free text) and how many. */
export const OrderHistoryItem = z.object({
  /** The order line it comes from (reorder matches it back to `order.lines`). */
  lineId: z.string(),
  catalogItemId: z.string().nullable(),
  name: z.string(),
  qty: z.number().int().min(1),
});
export type OrderHistoryItem = z.infer<typeof OrderHistoryItem>;

/**
 * `orders.history` row (audit C-15): the customer's own order with what the list needs to be
 * recognisable at a glance — the restaurant's name and the dishes — without one read per order.
 */
export const OrderHistoryRow = z.object({
  order: Order,
  /** Restaurant / shop name; null for rides, الرجعة seats and orders without a merchant. */
  merchantName: z.string().nullable(),
  /** The live lines (removed ones left out), in order, names resolved. */
  items: z.array(OrderHistoryItem),
  /** Rides, errands, parcels: the zone the trip went to (`aziziyah-zones` key); null otherwise. */
  dropoffZoneKey: z.string().nullable(),
  /** Rides: taxi or tuktuk, from the ride's trip, so the row wears that service's colour (o8); null otherwise. */
  rideVertical: z.enum(['taxi', 'tuktuk']).nullable().optional(),
});
export type OrderHistoryRow = z.infer<typeof OrderHistoryRow>;
