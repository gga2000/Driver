/**
 * The restaurant map's camera (Ali's idea, 2026-10-09; he picked "A · Lantern tour" on 2026-10-10): the
 * town from above with every restaurant on it; tapping one flies in to a 3D view of its front, «الجاي»
 * flies on to the next. Motion plays once and settles: one flight, then one slow quarter-turn, then still.
 * With reduce motion the camera jumps (the screen fades the map instead).
 */
type LngLat = [number, number];

/** One flight between shops, with a dip in zoom on the way so the town shows between them. */
export const RESTAURANT_FLY_MS = 2800;
export const RESTAURANT_FLY_CURVE = 1.5;
/** After landing, one slow turn round the shop, then the camera is still. */
export const RESTAURANT_SETTLE_MS = 6000;
export const RESTAURANT_SETTLE_DEG = 14;

export interface RestaurantCamera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Looking at a shop's front from across its street, a little to one side so its depth shows. */
export function restaurantFocusCamera(shop: { at: LngLat; facing?: number }): RestaurantCamera {
  return { center: shop.at, zoom: 19.2, pitch: 58, bearing: wrap((shop.facing ?? 180) + 180 + 20) };
}

/** The camera after the settle turn. */
export function restaurantSettledCamera(shop: { at: LngLat; facing?: number }): RestaurantCamera {
  const c = restaurantFocusCamera(shop);
  return { ...c, bearing: wrap(c.bearing + RESTAURANT_SETTLE_DEG) };
}

/** The whole town's restaurants from above, tilted so the buildings stand. */
export function restaurantOverview(shops: readonly { at: LngLat }[]): { bounds: [LngLat, LngLat]; pitch: number; bearing: number; maxZoom: number } | null {
  if (!shops.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const { at } of shops) {
    w = Math.min(w, at[0]);
    e = Math.max(e, at[0]);
    s = Math.min(s, at[1]);
    n = Math.max(n, at[1]);
  }
  return { bounds: [[w, s], [e, n]], pitch: 52, bearing: -18, maxZoom: 17.2 };
}

/** The next (step 1) or previous (step −1) shop in the tour, going round. */
export function restaurantTourStep<T extends { id: string }>(shops: readonly T[], currentId: string | null, step: 1 | -1): T | null {
  if (!shops.length) return null;
  const i = shops.findIndex((s) => s.id === currentId);
  if (i < 0) return shops[0]!;
  return shops[(i + step + shops.length) % shops.length]!;
}
