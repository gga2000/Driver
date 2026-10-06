import { RADAR_NEAR_M, RADAR_RINGS_M, type BoardCourier, type BoardOrder, type LiveEvent, type MerchantBoard } from '@driver/contracts';

/**
 * The courier radar (maps program SP7a, r1/r2), free of React Native so it is unit-tested: who is
 * coming, when he is "about to walk in", the live patches, and where a dot sits on the rings.
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

/** Couriers coming to this kitchen or waiting at its counter, nearest first (the radar's list). */
export function incoming(orders: readonly BoardOrder[]): BoardOrder[] {
  const rank = (o: BoardOrder) => (o.courier.state === 'arrived' ? -1 : (o.courier.distanceM ?? Number.MAX_SAFE_INTEGER));
  return orders.filter((o) => o.courier.state === 'arrived' || (o.courier.state === 'on_the_way' && o.courier.distanceM !== null && o.courier.distanceM !== undefined)).sort((a, b) => rank(a) - rank(b));
}

const OUTER = RADAR_RINGS_M[RADAR_RINGS_M.length - 1]!;
/**
 * Fraction of the radar's radius for a distance: logarithmic so the last streets get room (250 m is a
 * third of the way out, 3 km the edge); beyond the last ring he sits on the edge.
 */
export function radarRadius(distanceM: number): number {
  const f = Math.log1p(Math.max(0, distanceM) / RADAR_NEAR_M) / Math.log1p(OUTER / RADAR_NEAR_M);
  return Math.min(1, f);
}

/** A dot's offset from the centre, in fractions of the radius (x east, y south — screen axes, north up). */
export function radarPoint(distanceM: number, bearingDeg: number): { x: number; y: number } {
  const r = radarRadius(distanceM);
  const a = (bearingDeg * Math.PI) / 180;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}

/** "820 م" under a kilometre, "1.4 كم" above (one decimal under 10 km). */
export function distanceParts(distanceM: number): { key: 'merchant.radar.metres' | 'merchant.radar.km'; value: string } {
  if (distanceM < 1000) return { key: 'merchant.radar.metres', value: String(Math.max(10, Math.round(distanceM / 10) * 10)) };
  const km = distanceM / 1000;
  return { key: 'merchant.radar.km', value: km < 10 ? km.toFixed(1) : String(Math.round(km)) };
}

/** A courier's dot radius on the radar, px. */
export const RADAR_DOT_R = 7;
/** Ticket number size on the radar, px (about 2/3 of it above the baseline). */
export const RADAR_LABEL_SIZE = 9;
/** Half the width of a 4-digit ticket at that size, px: the label never runs off the side. */
const LABEL_HALF_W = 12;

/**
 * Where a dot's ticket number sits (text baseline, centred): just above the dot, or just below it when
 * the dot is on the top edge (a courier due north at 3 km) and the number would be cut off.
 */
export function radarLabelAt(x: number, y: number, size: number): { x: number; y: number } {
  const above = y - RADAR_DOT_R - 3;
  const top = above - RADAR_LABEL_SIZE * 0.75;
  const ly = top >= 1 ? above : y + RADAR_DOT_R + 3 + RADAR_LABEL_SIZE * 0.75;
  return { x: Math.min(size - LABEL_HALF_W, Math.max(LABEL_HALF_W, x)), y: ly };
}
