import { RADAR_NEAR_M, type BoardCourier, type BoardOrder, type LiveEvent, type MerchantBoard } from '@driver/contracts';

/**
 * The courier radar (maps program SP7a, r1/r2), free of React Native so it is unit-tested: when he is
 * "about to walk in" and the live patches. Since the counter redesign (o4) the couriers show on their
 * own tickets («عباس وصل للكاونتر»), not on a radar panel.
 */

type RadarEvent = Extract<LiveEvent, { type: 'courier_radar' }>;

/** A courier patch from the live channel, applied to the cached board (no re-read needed). */
export function applyRadar(board: MerchantBoard | undefined, e: RadarEvent): MerchantBoard | undefined {
  if (!board || !board.orders.some((o) => o.id === e.orderId && o.courier.state === 'on_the_way')) return board;
  return {
    ...board,
    orders: board.orders.map((o) => (o.id === e.orderId ? { ...o, courier: { ...o.courier, distanceM: e.distanceM, bearingDeg: e.bearingDeg, etaMinutes: e.etaMinutes } } : o)),
  };
}

/**
 * He is about to walk in: at the counter, or inside `RADAR_NEAR_M`. Without a distance, a minute
 * away (whole minutes round "1" up to 90 s, so the distance decides whenever it is known).
 */
export function arriving(c: BoardCourier): boolean {
  if (c.state === 'arrived') return true;
  if (c.state !== 'on_the_way') return false;
  if (c.distanceM !== null && c.distanceM !== undefined) return c.distanceM <= RADAR_NEAR_M;
  return (c.etaMinutes ?? Infinity) <= 1;
}

/** One courier on one order (a reassigned order is a new courier with a new code). */
const arrivalKey = (o: BoardOrder) => `${o.id}:${o.courier.pickupCode ?? ''}`;

/**
 * Orders whose courier has just started arriving since the last read, and the new "seen" set. The
 * first read (`seen` null) only remembers: a tablet switched on does not chime for couriers already
 * at the counter.
 */
export function newArrivals(seen: ReadonlySet<string> | null, orders: readonly BoardOrder[]): { chime: string[]; seen: Set<string> } {
  const now = new Set(orders.filter((o) => arriving(o.courier)).map(arrivalKey));
  if (!seen) return { chime: [], seen: now };
  const chime = orders.filter((o) => arriving(o.courier) && !seen.has(arrivalKey(o))).map((o) => o.id);
  // Keep keys of couriers still arriving; forget the rest (an order leaves the board when collected).
  return { chime, seen: now };
}
